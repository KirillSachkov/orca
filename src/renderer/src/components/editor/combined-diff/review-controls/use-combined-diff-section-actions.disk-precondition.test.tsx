// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { editor as monacoEditor } from 'monaco-editor'
import type { OpenFile } from '@/store/slices/editor'
import { getDiskBaselineSignature } from '../../../../../../shared/disk-baseline-signature'
import type { DiffSection } from '../../diff-section-types'

const mocks = vi.hoisted(() => ({ writeRuntimeFile: vi.fn(), toastError: vi.fn() }))

vi.mock('@/runtime/runtime-file-mutation-client', () => ({
  writeRuntimeFile: mocks.writeRuntimeFile
}))
vi.mock('@/lib/editor-file-operation-owner', () => ({
  getEditorFileOperationContext: () => ({
    target: { kind: 'local' },
    worktreeId: 'wt-1',
    worktreePath: '/repo'
  })
}))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))

import { useCombinedDiffSectionActions } from './use-combined-diff-section-actions'

function unstagedSection(loadedDisk: string): DiffSection {
  return {
    key: 'file.ts',
    path: 'file.ts',
    status: 'modified',
    area: 'unstaged',
    originalContent: 'head',
    modifiedContent: loadedDisk,
    collapsed: false,
    loading: false,
    dirty: true,
    diffResult: {
      kind: 'text',
      originalContent: 'head',
      modifiedContent: loadedDisk,
      originalIsBinary: false,
      modifiedIsBinary: false
    },
    largeDiffRenderLimit: null
  }
}

function renderSectionActions(section: DiffSection) {
  const setSections = vi.fn()
  const requestSectionReload = vi.fn()
  const { result } = renderHook(() =>
    useCombinedDiffSectionActions({
      activeGroupId: undefined,
      branchCompare: null,
      canOpenWorkspaceFileBrowserForPath: () => false,
      commitCompare: null,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the save path reads only these fields.
      file: { id: 'combined', filePath: '/repo', worktreeId: 'wt-1' } as OpenFile,
      isAllMode: false,
      isBranchMode: false,
      isCommitMode: false,
      sections: [section],
      sectionsRef: { current: [section] },
      setSectionHeights: vi.fn(),
      setSections,
      requestSectionReload
    })
  )
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the save path calls only getValue.
  const editor = { getValue: () => 'mine' } as monacoEditor.IStandaloneCodeEditor
  result.current.modifiedEditorsRef.current.set(0, editor)
  return { result, setSections, requestSectionReload }
}

type RefusalToastOptions = {
  action: { label: string; onClick: () => void }
  cancel: { label: string; onClick: () => void }
}

function refusalToastOptions(): RefusalToastOptions {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the refusal toast always passes both buttons.
  return mocks.toastError.mock.calls[0]?.[1] as RefusalToastOptions
}

describe('combined diff section save precondition', () => {
  afterEach(() => {
    cleanup()
    mocks.writeRuntimeFile.mockReset()
    mocks.toastError.mockReset()
  })

  it('guards an unstaged section save with the working file it loaded', async () => {
    mocks.writeRuntimeFile.mockResolvedValue({ ok: true })
    const { result } = renderSectionActions(unstagedSection('loaded disk'))

    await act(() => result.current.handleSectionSaveRef.current(0))

    expect(mocks.writeRuntimeFile.mock.calls[0]?.[4]).toEqual({
      expectedSignature: getDiskBaselineSignature('loaded disk'),
      allowMissing: true
    })
  })

  it('keeps the section dirty and says why when disk changed since it loaded', async () => {
    mocks.writeRuntimeFile.mockResolvedValue({ ok: false, diskConflict: 'changed' })
    const { result, setSections } = renderSectionActions(unstagedSection('loaded disk'))

    await act(() => result.current.handleSectionSaveRef.current(0))

    expect(setSections).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith(
      'This file changed on disk. Review the change before saving.',
      expect.objectContaining({ action: expect.anything(), cancel: expect.anything() })
    )
  })

  it('lets the user resolve a refused section save by overwriting', async () => {
    mocks.writeRuntimeFile
      .mockResolvedValueOnce({ ok: false, diskConflict: 'changed' })
      .mockResolvedValueOnce({ ok: true })
    const { result } = renderSectionActions(unstagedSection('loaded disk'))
    await act(() => result.current.handleSectionSaveRef.current(0))

    expect(refusalToastOptions().action.label).toBe('Overwrite')
    await act(async () => refusalToastOptions().action.onClick())

    expect(mocks.writeRuntimeFile).toHaveBeenCalledTimes(2)
    expect(mocks.writeRuntimeFile.mock.calls[1]?.[4]).toBeUndefined()
  })

  it('lets the user resolve a refused section save by reloading the section', async () => {
    vi.useFakeTimers()
    try {
      mocks.writeRuntimeFile.mockResolvedValue({ ok: false, diskConflict: 'changed' })
      const { result, setSections, requestSectionReload } = renderSectionActions(
        unstagedSection('loaded disk')
      )
      await act(() => result.current.handleSectionSaveRef.current(0))

      expect(refusalToastOptions().cancel.label).toBe('Reload')
      act(() => refusalToastOptions().cancel.onClick())
      await act(() => vi.runAllTimersAsync())

      expect(setSections).toHaveBeenCalled()
      expect(requestSectionReload).toHaveBeenCalledWith(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
