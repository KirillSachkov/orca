import { describe, expect, it } from 'vitest'
import {
  diskBaselineSignatureLength,
  getDiskBaselineSignature,
  utf8ByteSizeCanDecodeToLength
} from './disk-baseline-signature'
import { compareDiskWritePrecondition, parseFileWriteResult } from './file-write-disk-precondition'

describe('disk write precondition', () => {
  it('compares decoded disk text against the baseline signature', () => {
    const precondition = { expectedSignature: getDiskBaselineSignature('base') }
    expect(compareDiskWritePrecondition(precondition, 'base')).toBeNull()
    expect(compareDiskWritePrecondition(precondition, 'newer')).toBe('changed')
    expect(compareDiskWritePrecondition(precondition, undefined)).toBe('changed')
    expect(compareDiskWritePrecondition(precondition, null)).toBe('missing')
    expect(compareDiskWritePrecondition({ ...precondition, allowMissing: true }, null)).toBeNull()
  })

  it('treats anything but an explicit refusal from a host as a completed write', () => {
    expect(parseFileWriteResult(undefined)).toEqual({ ok: true })
    expect(parseFileWriteResult({ ok: true })).toEqual({ ok: true })
    expect(parseFileWriteResult({ ok: false, diskConflict: 'missing' })).toEqual({
      ok: false,
      diskConflict: 'missing'
    })
    expect(parseFileWriteResult({ ok: false })).toEqual({ ok: false, diskConflict: 'changed' })
  })

  it('bounds the UTF-8 size a baseline can decode from', () => {
    const content = 'a€𝄞'
    const length = diskBaselineSignatureLength(getDiskBaselineSignature(content))
    expect(length).toBe(content.length)
    expect(utf8ByteSizeCanDecodeToLength(Buffer.byteLength(content), length ?? -1)).toBe(true)
    expect(utf8ByteSizeCanDecodeToLength(content.length - 1, content.length)).toBe(false)
    expect(utf8ByteSizeCanDecodeToLength(content.length * 3 + 1, content.length)).toBe(false)
    expect(diskBaselineSignatureLength('not-a-signature')).toBeNull()
  })
})
