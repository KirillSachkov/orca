import { getDiskBaselineSignature } from './disk-baseline-signature'

// Why: an older host strips the precondition and writes blindly, so a client must know before it sends.
export const FILE_WRITE_DISK_PRECONDITION_RUNTIME_CAPABILITY =
  'files.write.disk-precondition.v1' as const

/** Refuse the write unless disk still holds the content this signature was taken over. */
export type FileWriteDiskPrecondition = {
  expectedSignature: string
  /** A missing file is written (recreated) instead of refused. */
  allowMissing?: boolean
}

export type FileWriteDiskConflict = 'changed' | 'missing'

export type FileWriteResult = { ok: true } | { ok: false; diskConflict: FileWriteDiskConflict }

export const FILE_WRITE_OK: FileWriteResult = { ok: true }

/** `current` is the decoded disk text, `null` when missing, `undefined` when not comparable text. */
export function compareDiskWritePrecondition(
  precondition: FileWriteDiskPrecondition,
  current: string | null | undefined
): FileWriteDiskConflict | null {
  if (current === null) {
    return precondition.allowMissing === true ? null : 'missing'
  }
  if (current === undefined) {
    return 'changed'
  }
  return getDiskBaselineSignature(current) === precondition.expectedSignature ? null : 'changed'
}

/** Why: old hosts answer `{ ok: true }` or nothing; only an explicit `ok: false` is a refusal. */
export function parseFileWriteResult(value: unknown): FileWriteResult {
  if (typeof value !== 'object' || value === null || !('ok' in value) || value.ok !== false) {
    return FILE_WRITE_OK
  }
  const diskConflict = 'diskConflict' in value ? value.diskConflict : undefined
  return { ok: false, diskConflict: diskConflict === 'missing' ? 'missing' : 'changed' }
}
