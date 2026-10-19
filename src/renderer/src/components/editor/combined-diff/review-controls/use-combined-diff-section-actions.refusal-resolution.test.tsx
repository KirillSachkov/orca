// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { editor as monacoEditor } from 'monaco-editor'
import type { OpenFile } from '@/store/slices/editor'
import type { DiffSection } from '../../diff-section-types'

const mocks = vi.hoisted(() => ({ writeRuntimeFile: vi.fn(), toastError: vi.fn() }))

vi.mock('@/runtime/runtime-file-mutation-client', () => ({
  writeRuntimeFile: mocks.writeRuntimeFile
}))
vi.mock('@/lib/editor-file-operation-owner', () => ({
  getEditorFileOperationContext: () => ({ target: { kind: 'local' } })
}))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))

import { useCombinedDiffSectionActions } from './use-combined-diff-section-actions'

function section(path: string, draft: string): DiffSection {
  return {
    key: path,
    path,
    status: 'modified',
    area: 'unstaged',
    originalContent: 'head',
    modifiedContent: draft,
    collapsed: false,
    loading: false,
    dirty: true,
    diffResult: {
      kind: 'text',
      originalContent: 'head',
      modifiedContent: `${path} on disk`,
      originalIsBinary: false,
      modifiedIsBinary: false
    },
    largeDiffRenderLimit: null
  }
}

function editorShowing(value: string): monacoEditor.IStandaloneCodeEditor {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the save path calls only getValue.
  return { getValue: () => value } as monacoEditor.IStandaloneCodeEditor
}

function renderActions(initial: DiffSection[]) {
  const sectionsRef = { current: initial }
  const hook = renderHook(
    ({ sections }: { sections: DiffSection[] }) =>
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
        sections,
        sectionsRef,
        setSectionHeights: vi.fn(),
        setSections: vi.fn(),
        requestSectionReload: vi.fn()
      }),
    { initialProps: { sections: initial } }
  )
  const showSections = (next: DiffSection[]): void => {
    sectionsRef.current = next
    hook.rerender({ sections: next })
  }
  return { hook, showSections }
}

function clickOverwrite(): void {
  const options: unknown = mocks.toastError.mock.calls[0]?.[1]
  if (typeof options === 'object' && options && 'action' in options) {
    const action: unknown = options.action
    if (typeof action === 'object' && action && 'onClick' in action) {
      const onClick: unknown = action.onClick
      if (typeof onClick === 'function') {
        onClick()
      }
    }
  }
}

describe('resolving a refused section save after the section list changed', () => {
  afterEach(() => {
    cleanup()
    mocks.writeRuntimeFile.mockReset()
    mocks.toastError.mockReset()
  })

  it.each([
    ['a section was inserted before it', (a: DiffSection) => [section('new.ts', 'new draft'), a]],
    ['the section before it was staged away', (a: DiffSection) => [a]]
  ])('overwrites only the refused file when %s', async (_label, reorder) => {
    mocks.writeRuntimeFile
      .mockResolvedValueOnce({ ok: false, diskConflict: 'changed' })
      .mockResolvedValue({ ok: true })
    const other = section('other.ts', 'other draft')
    const refused = section('a.ts', 'a draft')
    const { hook, showSections } = renderActions([other, refused])
    hook.result.current.modifiedEditorsRef.current.set(0, editorShowing('other draft'))
    hook.result.current.modifiedEditorsRef.current.set(1, editorShowing('a draft'))
    await act(() => hook.result.current.handleSectionSaveRef.current(1))

    showSections(reorder(refused))
    await act(async () => clickOverwrite())

    await vi.waitFor(() => expect(mocks.writeRuntimeFile).toHaveBeenCalledTimes(2))
    expect(mocks.writeRuntimeFile.mock.calls[1]?.slice(1, 3)).toEqual(['/repo/a.ts', 'a draft'])
  })

  it('writes nothing when the refused section is gone', async () => {
    mocks.writeRuntimeFile.mockResolvedValue({ ok: false, diskConflict: 'changed' })
    const refused = section('a.ts', 'a draft')
    const { hook, showSections } = renderActions([refused])
    hook.result.current.modifiedEditorsRef.current.set(0, editorShowing('a draft'))
    await act(() => hook.result.current.handleSectionSaveRef.current(0))

    showSections([section('b.ts', 'b draft')])
    await act(async () => clickOverwrite())

    expect(mocks.writeRuntimeFile).toHaveBeenCalledTimes(1)
  })
})
