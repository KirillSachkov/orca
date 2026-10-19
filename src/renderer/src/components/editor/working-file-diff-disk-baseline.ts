import type { AppState } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import type { GitDiffResult } from '../../../../shared/git-diff-compare-types'
import {
  getDiskBaselineSignature,
  getWrittenContentDiskSignature
} from '../../../../shared/disk-baseline-signature'
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

/** Clean loads re-baseline through the store's one choke point; a dirty tab keeps its baseline. */
export function stampCleanWorkingFileDiffBaseline(
  state: Pick<AppState, 'openFiles' | 'commitCleanDiskContent'>,
  fileId: string,
  result: GitDiffResult
): void {
  const file = state.openFiles.find((openFile) => openFile.id === fileId)
  if (file && workingFileDiffDiskSignature(file, result) !== null && result.kind === 'text') {
    state.commitCleanDiskContent(fileId, result.modifiedContent)
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
  // Why written-content: after a section save the loaded side is the string written, not re-read.
  return {
    expectedSignature: getWrittenContentDiskSignature(loaded.modifiedContent),
    allowMissing: true
  }
}
