import type { AppState } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import type {
  FileWriteDiskConflict,
  FileWriteDiskPrecondition
} from '../../../../shared/file-write-disk-precondition'
import { markFileChangedOnDisk } from './editor-changed-on-disk-mark'

export const SAVE_REFUSED_CHANGED_ON_DISK_MESSAGE =
  'This file changed on disk. Review the change before saving.'
export const SAVE_REFUSED_DELETED_ON_DISK_MESSAGE = 'This file was deleted on disk.'

/**
 * The disk state a save may overwrite: the content this tab's edits are based on.
 * Why no precondition for an explicit save under the changed-on-disk banner: that save is the
 * banner's "overwrite" choice, and the banner already warned the newer disk content will be lost.
 */
export function getSaveDiskPrecondition(
  file: Pick<OpenFile, 'lastKnownDiskSignature' | 'externalMutation'>,
  trigger: 'autosave' | 'user'
): FileWriteDiskPrecondition | undefined {
  if (!file.lastKnownDiskSignature) {
    return undefined
  }
  if (trigger === 'user' && file.externalMutation === 'changed') {
    return undefined
  }
  // Why: an explicit save may recreate a deleted file (nothing on disk to lose); autosave must not resurrect it.
  return trigger === 'user'
    ? { expectedSignature: file.lastKnownDiskSignature, allowMissing: true }
    : { expectedSignature: file.lastKnownDiskSignature }
}

/** Surfaces a refused save through the existing changed-on-disk banner or deleted tombstone. */
export function applySaveDiskConflict(
  state: Pick<
    AppState,
    'openFiles' | 'setExternalMutation' | 'clearPendingDiskBaselineVerification'
  >,
  fileId: string,
  diskConflict: FileWriteDiskConflict,
  connectionId: string | undefined
): void {
  const file = state.openFiles.find((openFile) => openFile.id === fileId)
  if (!file) {
    return
  }
  // Why: the writer just compared disk to the baseline, which is what the restore scan waits on.
  state.clearPendingDiskBaselineVerification(fileId)
  if (diskConflict === 'missing') {
    // Why edit-only: the watcher tombstones only edit tabs; a diff tab just keeps its draft.
    if (file.mode === 'edit' && file.externalMutation !== 'deleted') {
      state.setExternalMutation(fileId, 'deleted')
    }
    return
  }
  markFileChangedOnDisk(state, file, { connectionId, origin: 'live' })
}
