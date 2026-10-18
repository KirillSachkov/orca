import {
  compareDiskWritePrecondition,
  diskConflictFromReadFailure,
  type FileWriteDiskConflict,
  type FileWriteDiskPrecondition
} from '../../../shared/file-write-disk-precondition'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import { readRuntimeFileContent } from './runtime-file-read-client'
import { getRelativePathInsideWorktree } from './runtime-file-routing'
import type { RuntimeFileOperationArgs } from './runtime-file-client-types'

/**
 * For a host that would strip the precondition: compare from here before the unguarded write.
 * A read failure that doesn't prove the disk state fails the save rather than writing unverified.
 */
export async function checkDiskPreconditionFromClient(
  context: RuntimeFileOperationArgs & { target: RuntimeClientTarget & { kind: 'environment' } },
  filePath: string,
  precondition: FileWriteDiskPrecondition
): Promise<FileWriteDiskConflict | null> {
  let current: { content: string; isBinary: boolean }
  try {
    current = await readRuntimeFileContent({
      target: context.target,
      filePath,
      relativePath: getRelativePathInsideWorktree(context.worktreePath, filePath) ?? undefined,
      worktreeId: context.worktreeId ?? undefined,
      connectionId: context.connectionId,
      expectedExternalSshTargetId: context.expectedExternalSshTargetId
    })
  } catch (error) {
    return diskConflictFromReadFailure(precondition, error)
  }
  return compareDiskWritePrecondition(precondition, current.isBinary ? undefined : current.content)
}
