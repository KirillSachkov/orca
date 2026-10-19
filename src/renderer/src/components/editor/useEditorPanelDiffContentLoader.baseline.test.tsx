// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StoreApi } from 'zustand'
import type { AppState } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import { getDiskBaselineSignature } from '../../../../shared/disk-baseline-signature'
import { createEditorStore } from './editor-autosave-controller-test-fixture'
import type { DiffContent } from './editor-panel-content-types'

const mocks = vi.hoisted(() => {
  const store: { current: StoreApi<AppState> | null } = { current: null }
  return { store, getRuntimeGitDiff: vi.fn() }
})

vi.mock('@/store', () => ({
  useAppStore: { getState: () => mocks.store.current?.getState() }
}))
vi.mock('@/lib/connection-context', () => ({ getConnectionIdForFile: () => undefined }))
vi.mock('@/lib/file-owner-runtime-target', () => ({
  requireRuntimeTargetForFileOwner: () => ({ kind: 'local' })
}))
vi.mock('@/runtime/runtime-git-client-context', () => ({ getRuntimeGitScope: () => null }))
vi.mock('@/runtime/runtime-git-diff-client', () => ({
  getRuntimeGitDiff: mocks.getRuntimeGitDiff,
  getRuntimeGitBranchDiff: vi.fn(),
  getRuntimeGitCommitDiff: vi.fn()
}))

import { useEditorPanelDiffContentLoader } from './useEditorPanelDiffContentLoader'

function textDiff(modifiedContent: string): DiffContent {
  return {
    kind: 'text',
    originalContent: 'head',
    modifiedContent,
    originalIsBinary: false,
    modifiedIsBinary: false
  }
}

function setUp(diffSource: OpenFile['diffSource'], mode: 'diff' | 'edit' = 'diff') {
  const store = createEditorStore()
  mocks.store.current = store
  store.getState().openFile({
    filePath: '/repo/file.ts',
    relativePath: 'file.ts',
    worktreeId: 'wt-1',
    language: 'typescript',
    mode,
    ...(mode === 'diff' ? { diffSource } : {})
  })
  const fileId = store.getState().openFiles[0]!.id
  const { result } = renderHook(() =>
    useEditorPanelDiffContentLoader({
      diffReadGenerationCounterRef: { current: 0 },
      diffReadGenerationRef: { current: {} },
      outstandingDiffReadsRef: { current: {} },
      setDiffContents: () => undefined
    })
  )
  const load = async (content: string): Promise<void> => {
    mocks.getRuntimeGitDiff.mockResolvedValueOnce(textDiff(content))
    const file = store.getState().openFiles.find((openFile) => openFile.id === fileId) ?? null
    await act(() => result.current(file, { force: true }))
  }
  const baseline = () =>
    store.getState().openFiles.find((openFile) => openFile.id === fileId)?.lastKnownDiskSignature
  return { store, fileId, load, baseline }
}

describe('editable diff tab disk baseline', () => {
  afterEach(() => {
    cleanup()
    mocks.getRuntimeGitDiff.mockReset()
    mocks.store.current = null
  })

  it('records the working file on first load and refreshes it on a clean external reload', async () => {
    const { load, baseline } = setUp('unstaged')

    await load('first disk content')
    expect(baseline()).toBe(getDiskBaselineSignature('first disk content'))

    await load('agent rewrite')
    expect(baseline()).toBe(getDiskBaselineSignature('agent rewrite'))
  })

  it('keeps the baseline a dirty draft derives from', async () => {
    const { store, fileId, load, baseline } = setUp('unstaged')
    await load('base')
    store.getState().markFileDirty(fileId, true)

    await load('agent rewrite')

    expect(baseline()).toBe(getDiskBaselineSignature('base'))
  })

  it('never takes a baseline from a staged diff, whose modified side is the index', async () => {
    const { load, baseline } = setUp('staged')

    await load('index content')

    expect(baseline()).toBeUndefined()
  })

  it('leaves an edit tab baseline alone when its Changes view reads a missed rewrite', async () => {
    // The edit surface keeps showing its cached content, so only its own file load may baseline it.
    const { store, fileId, load, baseline } = setUp(undefined, 'edit')
    store.getState().setLastKnownDiskSignature(fileId, getDiskBaselineSignature('cached A'))

    await load('agent rewrite B')

    expect(baseline()).toBe(getDiskBaselineSignature('cached A'))
  })
})
