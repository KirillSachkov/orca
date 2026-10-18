// Why: sequences where a save or "Keep My Edits" must leave a baseline the next guarded save accepts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoreApi } from 'zustand'
import type { AppState } from '@/store'
import { requestEditorFileSave, requestEditorSaveQuiesce } from './editor-autosave'
import { attachEditorAutosaveController } from './editor-autosave-controller'
import { __clearSelfWriteRegistryForTests } from './editor-self-write-registry'
import {
  createEditorStore,
  createFakeEditorDisk,
  stubEditorWindowWithDisk,
  type FakeEditorDisk
} from './editor-autosave-controller-test-fixture'
import { getDiskBaselineSignature } from './diff-content-signature'
import { keepTabEditsOverExternalChange } from './ExternalFileChangeBanner'
import type * as RuntimeFileReadClient from '@/runtime/runtime-file-read-client'

const mocks = vi.hoisted(() => {
  const store: { current: StoreApi<AppState> | null } = { current: null }
  return { getConnectionIdForFile: vi.fn(), readRuntimeFileContent: vi.fn(), store }
})

vi.mock('@/lib/connection-context', () => ({
  getConnectionIdForFile: mocks.getConnectionIdForFile
}))
vi.mock('@/store', () => ({
  useAppStore: { getState: () => mocks.store.current?.getState() }
}))
vi.mock('@/runtime/runtime-file-read-client', async (importOriginal) => ({
  ...(await importOriginal<typeof RuntimeFileReadClient>()),
  readRuntimeFileContent: mocks.readRuntimeFileContent
}))

const FILE_ID = '/repo/file.ts'

function setUp(diskContent: string, baseline: string, draft: string) {
  const disk = stubEditorWindowWithDisk(createFakeEditorDisk({ [FILE_ID]: diskContent }))
  const store = createEditorStore()
  mocks.store.current = store
  store.getState().openFile({
    filePath: FILE_ID,
    relativePath: 'file.ts',
    worktreeId: 'wt-1',
    language: 'typescript',
    mode: 'edit'
  })
  store.getState().setLastKnownDiskSignature(FILE_ID, getDiskBaselineSignature(baseline))
  store.getState().setEditorDraft(FILE_ID, draft)
  store.getState().markFileDirty(FILE_ID, true)
  return { disk, store }
}

function edit(store: StoreApi<AppState>, draft: string): void {
  store.getState().setEditorDraft(FILE_ID, draft)
  store.getState().markFileDirty(FILE_ID, true)
}

/** Holds the next write until released; disk matches the baseline in these sequences, so it lands. */
function deferWrites(disk: FakeEditorDisk): () => void {
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  disk.fs.writeFile.mockImplementationOnce(
    async ({ filePath, content }: { filePath: string; content: string }) => {
      await gate
      disk.files.set(filePath, content)
      return { ok: true }
    }
  )
  return release
}

function liveFile(store: StoreApi<AppState>) {
  return store.getState().openFiles.find((file) => file.id === FILE_ID)
}

describe('editor save baseline flow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.getConnectionIdForFile.mockReset()
    mocks.getConnectionIdForFile.mockReturnValue(undefined)
    mocks.readRuntimeFileContent.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    __clearSelfWriteRegistryForTests()
    mocks.store.current = null
  })

  it('rebaselines a save that a quiesce superseded mid-write, so the next save is accepted', async () => {
    const { disk, store } = setUp('original', 'original', 'first')
    store.setState({ settings: null })
    const cleanup = attachEditorAutosaveController(store)
    try {
      const releaseWrite = deferWrites(disk)
      const save = requestEditorFileSave({ fileId: FILE_ID })
      await vi.waitFor(() => expect(disk.fs.writeFile).toHaveBeenCalledTimes(1))
      const quiesce = requestEditorSaveQuiesce({ fileId: FILE_ID })
      releaseWrite()
      await Promise.all([save, quiesce])
      expect(disk.files.get(FILE_ID)).toBe('first')

      edit(store, 'second')
      await requestEditorFileSave({ fileId: FILE_ID })

      expect(disk.files.get(FILE_ID)).toBe('second')
      expect(liveFile(store)?.externalMutation).toBeUndefined()
    } finally {
      cleanup()
    }
  })

  it('baselines what disk holds after writing a lone surrogate', async () => {
    const { disk, store } = setUp('original', 'original', 'broken \uD800 pair')
    store.setState({ settings: null })
    const cleanup = attachEditorAutosaveController(store)
    try {
      await requestEditorFileSave({ fileId: FILE_ID })
      expect(disk.files.get(FILE_ID)).toBe('broken � pair')

      edit(store, 'fixed')
      await requestEditorFileSave({ fileId: FILE_ID })

      expect(disk.files.get(FILE_ID)).toBe('fixed')
    } finally {
      cleanup()
    }
  })

  it('holds autosave after Keep My Edits until the new baseline lands, then saves', async () => {
    const { disk, store } = setUp('agent rewrite', 'original', 'mine')
    store.getState().setExternalMutation(FILE_ID, 'changed')
    let finishRead: (value: { content: string; isBinary: boolean }) => void = () => undefined
    mocks.readRuntimeFileContent.mockReturnValue(
      new Promise((resolve) => {
        finishRead = resolve
      })
    )
    const cleanup = attachEditorAutosaveController(store)
    try {
      keepTabEditsOverExternalChange(liveFile(store)!)
      await vi.advanceTimersByTimeAsync(1500)
      expect(disk.fs.writeFile).not.toHaveBeenCalled()
      expect(liveFile(store)?.externalMutation).toBeUndefined()

      finishRead({ content: 'agent rewrite', isBinary: false })
      await vi.advanceTimersByTimeAsync(1500)

      expect(disk.files.get(FILE_ID)).toBe('mine')
      expect(liveFile(store)?.diskOverwriteIntent).toBeUndefined()
      expect(liveFile(store)?.externalMutation).toBeUndefined()
    } finally {
      cleanup()
    }
  })

  it('lets an explicit save right after Keep My Edits overwrite before the read lands', async () => {
    const { disk, store } = setUp('agent rewrite', 'original', 'mine')
    store.setState({ settings: null })
    store.getState().setExternalMutation(FILE_ID, 'changed')
    mocks.readRuntimeFileContent.mockReturnValue(new Promise(() => undefined))
    const cleanup = attachEditorAutosaveController(store)
    try {
      keepTabEditsOverExternalChange(liveFile(store)!)
      await requestEditorFileSave({ fileId: FILE_ID })

      expect(disk.files.get(FILE_ID)).toBe('mine')
      expect(liveFile(store)?.lastKnownDiskSignature).toBe(getDiskBaselineSignature('mine'))
    } finally {
      cleanup()
    }
  })

  it('treats Keep My Edits as overwrite intent when the baseline read fails', async () => {
    const { disk, store } = setUp('agent rewrite', 'original', 'mine')
    store.getState().setExternalMutation(FILE_ID, 'changed')
    mocks.readRuntimeFileContent.mockRejectedValue(new Error('transport down'))
    const cleanup = attachEditorAutosaveController(store)
    try {
      keepTabEditsOverExternalChange(liveFile(store)!)
      await vi.advanceTimersByTimeAsync(1500)

      expect(disk.files.get(FILE_ID)).toBe('mine')
      expect(liveFile(store)?.externalMutation).toBeUndefined()
      expect(liveFile(store)?.diskOverwriteIntent).toBeUndefined()
    } finally {
      cleanup()
    }
  })
})
