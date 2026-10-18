import {
  compareDiskWritePrecondition,
  FILE_WRITE_DISK_PRECONDITION_RUNTIME_CAPABILITY,
  type FileWriteDiskConflict,
  type FileWriteDiskPrecondition
} from '../../../shared/file-write-disk-precondition'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import { runtimeEnvironmentSupportsCapability } from './runtime-rpc-client'
import { readRuntimeFileContent } from './runtime-file-read-client'
import { getRelativePathInsideWorktree } from './runtime-file-routing'
import type { RuntimeFileOperationArgs } from './runtime-file-client-types'

export function runtimeHostEnforcesDiskPrecondition(
  target: RuntimeClientTarget & { kind: 'environment' }
): Promise<boolean> {
  return runtimeEnvironmentSupportsCapability(
    target.environmentId,
    FILE_WRITE_DISK_PRECONDITION_RUNTIME_CAPABILITY,
    15_000
  )
}

/**
 * For a host that would strip the precondition: compare from here before the unguarded write.
 * Why a read failure throws unless a missing file is allowed: an unverifiable autosave must not write.
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
    if (precondition.allowMissing === true) {
      return null
    }
    throw error
  }
  return compareDiskWritePrecondition(precondition, current.isBinary ? undefined : current.content)
}
