import {
  diskBaselineSignatureLength,
  utf8ByteSizeCanDecodeToLength
} from '../../../shared/disk-baseline-signature'
import {
  compareDiskWritePrecondition,
  FILE_WRITE_OK,
  type FileWriteDiskConflict,
  type FileWriteDiskPrecondition,
  type FileWriteResult
} from '../../../shared/file-write-disk-precondition'
import { isENOENT } from '../filesystem-path-containment'
import { writeFile } from 'node:fs/promises'
import { runKeyedSerializedOperation } from '../../cli/keyed-promise-queue'
import { serializedParentDirectoryKey } from '../../destination-serialized-local-rename'
import {
  FileTooLargeError,
  openLocalRegularFile,
  readLocalFileBounded
} from './local-regular-file-read'

/** Reads the file the writer is about to replace and reports why it no longer matches the baseline. */
export async function checkLocalDiskWritePrecondition(
  filePath: string,
  precondition: FileWriteDiskPrecondition
): Promise<FileWriteDiskConflict | null> {
  let opened: Awaited<ReturnType<typeof openLocalRegularFile>>
  try {
    opened = await openLocalRegularFile(filePath)
  } catch (error) {
    if (isENOENT(error)) {
      return compareDiskWritePrecondition(precondition, null)
    }
    throw error
  }
  const { handle, stats } = opened
  try {
    const expectedLength = diskBaselineSignatureLength(precondition.expectedSignature)
    // Why: the signature pins the decoded length, so a size it can't decode to skips reading a huge file.
    if (expectedLength === null || !utf8ByteSizeCanDecodeToLength(stats.size, expectedLength)) {
      return 'changed'
    }
    let buffer: Buffer
    try {
      buffer = await readLocalFileBounded(handle, expectedLength * 3, stats.size)
    } catch (error) {
      // Why: grown past what the baseline could decode from since the size check, so it changed.
      if (error instanceof FileTooLargeError) {
        return 'changed'
      }
      throw error
    }
    return compareDiskWritePrecondition(precondition, buffer.toString('utf8'))
  } finally {
    await handle.close()
  }
}

// Why parent scope: it covers case-insensitive and Unicode aliases of one file without guessing collation.
const editorWritesByParent = new Map<string, Promise<void>>()

/**
 * Compare→write for editor saves, serialized per directory across this process's IPC and runtime
 * writers so two clients holding one baseline can't both pass. A write by another process between
 * the compare and the write is not prevented; the window is one read long.
 */
export async function writeLocalTextFileWithDiskPrecondition(
  filePath: string,
  content: string,
  precondition: FileWriteDiskPrecondition | undefined
): Promise<FileWriteResult> {
  return runKeyedSerializedOperation(
    editorWritesByParent,
    await serializedParentDirectoryKey(filePath),
    async (): Promise<FileWriteResult> => {
      const diskConflict = precondition
        ? await checkLocalDiskWritePrecondition(filePath, precondition)
        : null
      if (diskConflict) {
        return { ok: false, diskConflict }
      }
      await writeFile(filePath, content, 'utf-8')
      return FILE_WRITE_OK
    }
  )
}
