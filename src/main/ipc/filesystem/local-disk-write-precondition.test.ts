import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDiskBaselineSignature } from '../../../shared/disk-baseline-signature'
import type { RuntimeStore } from '../../runtime/runtime-store-contract'
import { createLocalFilesystemProvider } from '../../providers/local-filesystem-provider'
import { checkLocalDiskWritePrecondition } from './local-disk-write-precondition'
import type * as LocalRegularFileRead from './local-regular-file-read'

const fileRead = vi.hoisted(() => ({ understateSizeBy: 0 }))
vi.mock('./local-regular-file-read', async (importOriginal) => {
  const actual = await importOriginal<typeof LocalRegularFileRead>()
  return {
    ...actual,
    // Why: reports the size from before a concurrent append, as a stat racing the writer would.
    openLocalRegularFile: async (filePath: string) => {
      const opened = await actual.openLocalRegularFile(filePath)
      opened.stats.size -= fileRead.understateSizeBy
      return opened
    }
  }
})

let base: string

beforeEach(async () => {
  base = await mkdtemp(join(await realpath(tmpdir()), 'orca-disk-write-precondition-'))
})

afterEach(async () => {
  fileRead.understateSizeBy = 0
  await rm(base, { recursive: true, force: true })
})

describe('checkLocalDiskWritePrecondition', () => {
  it('passes when disk still holds the baseline content', async () => {
    const filePath = join(base, 'a.ts')
    const content = 'const café = "☕ 𝄞"\n'
    await writeFile(filePath, content)

    await expect(
      checkLocalDiskWritePrecondition(filePath, {
        expectedSignature: getDiskBaselineSignature(content)
      })
    ).resolves.toBeNull()
  })

  it('reports a same-size external rewrite as changed', async () => {
    const filePath = join(base, 'a.ts')
    await writeFile(filePath, 'agent')

    await expect(
      checkLocalDiskWritePrecondition(filePath, {
        expectedSignature: getDiskBaselineSignature('human')
      })
    ).resolves.toBe('changed')
  })

  it('reports a size the baseline cannot decode to as changed', async () => {
    const filePath = join(base, 'a.ts')
    await writeFile(filePath, 'x'.repeat(100))

    await expect(
      checkLocalDiskWritePrecondition(filePath, {
        expectedSignature: getDiskBaselineSignature('short')
      })
    ).resolves.toBe('changed')
  })

  it('reports a file that grew past the baseline after its size check as changed', async () => {
    const filePath = join(base, 'a.ts')
    await writeFile(filePath, `ab${'x'.repeat(10)}`)
    fileRead.understateSizeBy = 10

    await expect(
      checkLocalDiskWritePrecondition(filePath, {
        expectedSignature: getDiskBaselineSignature('ab')
      })
    ).resolves.toBe('changed')
  })

  it('reports a missing file unless the caller allows recreating it', async () => {
    const filePath = join(base, 'gone.ts')
    const expectedSignature = getDiskBaselineSignature('was here')

    await expect(checkLocalDiskWritePrecondition(filePath, { expectedSignature })).resolves.toBe(
      'missing'
    )
    await expect(
      checkLocalDiskWritePrecondition(filePath, { expectedSignature, allowMissing: true })
    ).resolves.toBeNull()
  })
})

describe('local provider guarded write', () => {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the write path reads nothing from the store; authorization is the injected stub.
  const store = {} as RuntimeStore
  const provider = () =>
    createLocalFilesystemProvider({
      requireStore: () => store,
      resolveAuthorizedPath: vi.fn(async (path: string) => path)
    })

  it('writes when disk matches and refuses without writing when it does not', async () => {
    const filePath = join(base, 'a.ts')
    await writeFile(filePath, 'original')

    await expect(
      provider().writeFileWithDiskPrecondition(filePath, 'edited', {
        expectedSignature: getDiskBaselineSignature('original')
      })
    ).resolves.toEqual({ ok: true })
    expect(await readFile(filePath, 'utf8')).toBe('edited')

    await expect(
      provider().writeFileWithDiskPrecondition(filePath, 'stale', {
        expectedSignature: getDiskBaselineSignature('original')
      })
    ).resolves.toEqual({ ok: false, diskConflict: 'changed' })
    expect(await readFile(filePath, 'utf8')).toBe('edited')
  })

  it('does not resurrect a deleted file without allowMissing', async () => {
    const filePath = join(base, 'gone.ts')

    await expect(
      provider().writeFileWithDiskPrecondition(filePath, 'edited', {
        expectedSignature: getDiskBaselineSignature('original')
      })
    ).resolves.toEqual({ ok: false, diskConflict: 'missing' })
    await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
