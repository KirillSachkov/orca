import type { AppState } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import type {
  FileWriteDiskConflict,
  FileWriteDiskPrecondition
} from '../../../../shared/file-write-disk-precondition'
import { markFileChangedOnDisk } from './editor-changed-on-disk-mark'
import {
  noteObservedDiskVersion,
  settleEditorModelAfterOtherSurfaceSave,
  settleEditorModelAfterSave,
  type EditorSaveBaseline
} from './editor-model-disk-baseline'
import { getWrittenContentDiskSignature } from '../../../../shared/disk-baseline-signature'

export const SAVE_REFUSED_CHANGED_ON_DISK_MESSAGE =
  'This file changed on disk. Review the change before saving.'
export const SAVE_REFUSED_DELETED_ON_DISK_MESSAGE = 'This file was deleted on disk.'

/**
 * Only the editor's own save, requested while its changed-on-disk banner shows, is the banner's
 * "overwrite" choice; programmatic saves (mobile, save-before-delete, rename) never saw it.
 * Why at enqueue: judged at execution, a save queued behind the refusal that raised the banner
 * would read the banner as permission.
 */
export function isConfirmedDiskOverwrite(
  file: Pick<OpenFile, 'externalMutation'> | undefined,
  confirmDiskOverwrite: boolean
): boolean {
  return confirmDiskOverwrite && file?.externalMutation === 'changed'
}

/** The disk state a save may overwrite, from the base resolved with its text (see resolveEditorSaveBaseline). */
export function getSaveDiskPrecondition(
  expectedSignature: string | undefined,
  trigger: 'autosave' | 'user',
  overwriteConfirmed: boolean,
  /** The version the conflict is with, when known: an overwrite replaces only that version. */
  observedSignature?: string
): FileWriteDiskPrecondition | undefined {
  if (overwriteConfirmed) {
    return observedSignature === undefined
      ? undefined
      : { expectedSignature: observedSignature, allowMissing: true }
  }
  if (expectedSignature === undefined) {
    return undefined
  }
  // Why: an explicit save may recreate a deleted file (nothing on disk to lose); autosave must not resurrect it.
  return trigger === 'user' ? { expectedSignature, allowMissing: true } : { expectedSignature }
}

/**
 * After a write landed: the tab is now based on what it wrote. Why only if the store's record is
 * the one the save began from: a reload during a slow remote reply recorded newer disk.
 */
export function adoptWrittenDiskVersion(
  state: Pick<AppState, 'openFiles' | 'setLastKnownDiskSignature'>,
  savedFile: Pick<OpenFile, 'id' | 'lastKnownDiskSignature'>,
  saveBaseline: EditorSaveBaseline,
  writtenContent: string
): void {
  const writtenSignature = getWrittenContentDiskSignature(writtenContent)
  noteObservedDiskVersion(savedFile.id, undefined)
  const liveFile = state.openFiles.find((openFile) => openFile.id === savedFile.id)
  if (liveFile?.lastKnownDiskSignature === savedFile.lastKnownDiskSignature) {
    state.setLastKnownDiskSignature(savedFile.id, writtenSignature)
  }
  if (saveBaseline.fromModel) {
    settleEditorModelAfterSave(savedFile.id, saveBaseline.modelGeneration, writtenSignature)
  } else {
    // Why: another surface (rich markdown, CSV, notebook) changed disk under the retained model.
    settleEditorModelAfterOtherSurfaceSave(
      savedFile.id,
      saveBaseline.modelGeneration,
      writtenContent,
      writtenSignature
    )
  }
}

/** Surfaces a refused save through the existing changed-on-disk banner or deleted tombstone. */
export function applySaveDiskConflict(
  state: Pick<
    AppState,
    'openFiles' | 'setExternalMutation' | 'clearPendingDiskBaselineVerification'
  >,
  fileId: string,
  diskConflict: FileWriteDiskConflict,
  connectionId: string | undefined,
  currentSignature?: string
): void {
  const file = state.openFiles.find((openFile) => openFile.id === fileId)
  if (!file) {
    return
  }
  // Why: the writer just compared disk to the baseline, which is what the restore scan waits on.
  state.clearPendingDiskBaselineVerification(fileId)
  if (diskConflict === 'missing') {
    // Why edit-only: the watcher tombstones only edit tabs; a diff tab just keeps its draft. A
    // 'renamed' marker already explains the absence more precisely.
    if (file.mode === 'edit' && file.externalMutation === undefined) {
      state.setExternalMutation(fileId, 'deleted')
    }
    return
  }
  noteObservedDiskVersion(fileId, currentSignature)
  markFileChangedOnDisk(state, file, { connectionId, origin: 'live', saveRefused: true })
}
