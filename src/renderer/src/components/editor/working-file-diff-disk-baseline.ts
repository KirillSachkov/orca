import type { AppState } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import type { GitDiffResult } from '../../../../shared/git-diff-compare-types'
import { getDiskBaselineSignature } from '../../../../shared/disk-baseline-signature'
import type { FileWriteDiskPrecondition } from '../../../../shared/file-write-disk-precondition'
import type { DiffSection } from './diff-section-types'

/**
 * Disk baseline for an unstaged diff TAB, whose editable modified side is the working file it saves
 * to; null for anything else. An edit tab's Changes view never qualifies: its editor keeps showing
 * the file loader's content, so a baseline from the diff read could vouch for text it doesn't hold.
 */
export function workingFileDiffDiskSignature(
  file: Pick<OpenFile, 'mode' | 'diffSource'>,
  result: GitDiffResult
): string | null {
  if (
    file.mode !== 'diff' ||
    file.diffSource !== 'unstaged' ||
    result.kind !== 'text' ||
    result.largeDiffRenderLimit?.limited
  ) {
    return null
  }
  return getDiskBaselineSignature(result.modifiedContent)
}

/** Clean loads re-baseline; a dirty tab keeps the baseline its draft derives from. */
export function stampCleanWorkingFileDiffBaseline(
  state: Pick<AppState, 'openFiles' | 'setLastKnownDiskSignature'>,
  fileId: string,
  result: GitDiffResult
): void {
  const file = state.openFiles.find((openFile) => openFile.id === fileId)
  const signature = file ? workingFileDiffDiskSignature(file, result) : null
  if (signature !== null && file && !file.isDirty) {
    state.setLastKnownDiskSignature(fileId, signature)
  }
}

/** Guard for saving an editable (unstaged) combined-diff section: the working file it loaded. */
export function combinedDiffSectionDiskPrecondition(
  section: Pick<DiffSection, 'area' | 'diffResult'>
): FileWriteDiskPrecondition | undefined {
  const loaded = section.diffResult
  if (
    section.area !== 'unstaged' ||
    loaded?.kind !== 'text' ||
    loaded.largeDiffRenderLimit?.limited
  ) {
    return undefined
  }
  // Why allowMissing: a section save is an explicit user action, so recreating a deleted file is intended.
  return { expectedSignature: getDiskBaselineSignature(loaded.modifiedContent), allowMissing: true }
}
