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
 * Why at enqueue: an explicit save requested while the changed-on-disk banner shows is the banner's
 * "overwrite" choice. Judged at execution, a save queued behind the refusal that raised the banner
 * would read the banner as permission.
 */
export function isConfirmedDiskOverwrite(
  file: Pick<OpenFile, 'externalMutation'> | undefined,
  trigger: 'autosave' | 'user'
): boolean {
  return trigger === 'user' && file?.externalMutation === 'changed'
}

/** The disk state a save may overwrite: the content this tab's edits are based on. */
export function getSaveDiskPrecondition(
  file: Pick<OpenFile, 'lastKnownDiskSignature' | 'diskOverwriteIntent'>,
  trigger: 'autosave' | 'user',
  overwriteConfirmed: boolean
): FileWriteDiskPrecondition | undefined {
  // Why: "Keep My Edits" already chose to overwrite; until its baseline read lands, a guard would refuse that choice.
  if (!file.lastKnownDiskSignature || file.diskOverwriteIntent || overwriteConfirmed) {
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
