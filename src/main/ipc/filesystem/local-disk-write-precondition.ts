import {
  diskBaselineSignatureLength,
  utf8ByteSizeCanDecodeToLength
} from '../../../shared/disk-baseline-signature'
import {
  compareDiskWritePrecondition,
  type FileWriteDiskConflict,
  type FileWriteDiskPrecondition
} from '../../../shared/file-write-disk-precondition'
import { isENOENT } from '../filesystem-path-containment'
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
