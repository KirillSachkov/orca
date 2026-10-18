import type { AppState } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import type { GitDiffResult } from '../../../../shared/git-diff-compare-types'
import { getDiskBaselineSignature } from '../../../../shared/disk-baseline-signature'

/**
 * Disk baseline from a diff whose modified side is the working file the tab saves to, or null when
 * that side is not the whole working-file text (index/commit sides, binary, render-limited).
 */
export function workingFileDiffDiskSignature(
  diffSource: OpenFile['diffSource'],
  result: GitDiffResult
): string | null {
  if (diffSource !== 'unstaged' || result.kind !== 'text' || result.largeDiffRenderLimit?.limited) {
    return null
  }
  return getDiskBaselineSignature(result.modifiedContent)
}

/** Clean loads re-baseline; a dirty tab keeps the baseline its draft derives from. */
export function stampCleanWorkingFileDiffBaseline(
  state: Pick<AppState, 'openFiles' | 'setLastKnownDiskSignature'>,
  fileId: string,
  diffSource: OpenFile['diffSource'],
  result: GitDiffResult
): void {
  const signature = workingFileDiffDiskSignature(diffSource, result)
  const file = state.openFiles.find((openFile) => openFile.id === fileId)
  if (signature !== null && file && !file.isDirty) {
    state.setLastKnownDiskSignature(fileId, signature)
  }
}
