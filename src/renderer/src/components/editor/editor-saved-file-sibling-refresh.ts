import type { OpenFile } from '@/store/slices/editor'
import { mayShareEditorBackingFile } from '@/store/slices/editor/file-ids/editor-file-ids'
import { notifyEditorExternalFileChange } from './editor-autosave'

/**
 * After a save, other clean tabs on the same backing file (an edit tab and its unstaged diff tab)
 * reload, so their content and disk baseline follow the write instead of refusing a later save.
 */
export function refreshCleanSiblingTabsAfterSave(openFiles: OpenFile[], saved: OpenFile): void {
  const siblingIds = new Set(
    openFiles
      .filter(
        (file) => file.id !== saved.id && !file.isDirty && mayShareEditorBackingFile(file, saved)
      )
      .map((file) => file.id)
  )
  if (siblingIds.size === 0) {
    return
  }
  notifyEditorExternalFileChange({
    worktreeId: saved.worktreeId,
    worktreePath: saved.filePath.slice(0, saved.filePath.length - saved.relativePath.length - 1),
    relativePath: saved.relativePath,
    runtimeEnvironmentId: saved.runtimeEnvironmentId ?? null,
    // Why: re-checked at dispatch time, so a sibling dirtied meanwhile keeps its draft.
    indexedOpenFiles: {
      matches: (files) => files.filter((file) => siblingIds.has(file.id) && !file.isDirty)
    }
  })
}
