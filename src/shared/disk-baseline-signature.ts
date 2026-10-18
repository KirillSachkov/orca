// Why: the disk baseline guards against silently overwriting external writes
// (issue #7265), where a hash collision means a missed conflict — so it gets
// two independent FNV lanes plus the length instead of a single 32-bit lane.
export function getDiskBaselineSignature(content: string): string {
  let hashA = 2166136261
  let hashB = 84696351
  for (let i = 0; i < content.length; i += 1) {
    const code = content.charCodeAt(i)
    hashA ^= code
    hashA = Math.imul(hashA, 16777619)
    hashB = Math.imul(hashB ^ code, 1099511627)
  }
  return `${(hashA >>> 0).toString(16)}-${(hashB >>> 0).toString(16)}-${content.length.toString(16)}`
}

/** UTF-16 length a disk baseline signature was taken over, or null when it is not one. */
export function diskBaselineSignatureLength(signature: string): number | null {
  const match = /^[0-9a-f]{1,8}-[0-9a-f]{1,8}-([0-9a-f]{1,13})$/.exec(signature)
  if (!match) {
    return null
  }
  const length = Number.parseInt(match[1], 16)
  return Number.isSafeInteger(length) ? length : null
}

/** Why sound: every UTF-8-decoded unit, U+FFFD for a malformed run included, consumes 1–3 bytes. */
export function utf8ByteSizeCanDecodeToLength(byteSize: number, utf16Length: number): boolean {
  return byteSize >= utf16Length && byteSize <= utf16Length * 3
}
