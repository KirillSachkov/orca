import { describe, expect, it } from 'vitest'
import { createEditorStore } from '@/components/editor/editor-autosave-controller-test-fixture'
import { getDiskBaselineSignature } from '../../../../../../shared/disk-baseline-signature'

const FILE_ID = '/repo/file.ts'

function storeWithTab() {
  const store = createEditorStore()
  store.getState().openFile({
    filePath: FILE_ID,
    relativePath: 'file.ts',
    worktreeId: 'wt-1',
    language: 'typescript',
    mode: 'edit'
  })
  store.getState().setLastKnownDiskSignature(FILE_ID, getDiskBaselineSignature('A'))
  const tab = () => store.getState().openFiles.find((file) => file.id === FILE_ID)
  return { store, tab }
}

describe('commitCleanDiskContent', () => {
  it('never moves a dirty tab or touches its draft', () => {
    const { store, tab } = storeWithTab()
    store.getState().setEditorDraft(FILE_ID, 'edited')
    store.getState().markFileDirty(FILE_ID, true)

    store.getState().commitCleanDiskContent(FILE_ID, 'B')

    expect(tab()?.lastKnownDiskSignature).toBe(getDiskBaselineSignature('A'))
    expect(store.getState().editorDrafts[FILE_ID]).toBe('edited')
  })

  it('drops a clean retained draft that differs from the loaded text in the same update', () => {
    const { store, tab } = storeWithTab()
    store.getState().setEditorDraft(FILE_ID, 'A')
    const updates: number[] = []
    const unsubscribe = store.subscribe(() => updates.push(updates.length))

    store.getState().commitCleanDiskContent(FILE_ID, 'B')
    unsubscribe()

    expect(updates).toHaveLength(1)
    expect(tab()?.lastKnownDiskSignature).toBe(getDiskBaselineSignature('B'))
    expect(store.getState().editorDrafts[FILE_ID]).toBeUndefined()
  })

  it('changes nothing when the tab already shows and baselines the loaded text', () => {
    const { store } = storeWithTab()
    store.getState().setEditorDraft(FILE_ID, 'A')
    const before = store.getState()

    store.getState().commitCleanDiskContent(FILE_ID, 'A')

    expect(store.getState()).toBe(before)
  })
})
