import { describe, expect, it } from 'vitest'
import { writeRuntimeFile } from './runtime-file-mutation-client'
import {
  FILE_MUTATION_OWNERSHIP_RUNTIME_CAPABILITY,
  MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION,
  RUNTIME_PROTOCOL_VERSION
} from '../../../shared/protocol-version'
import { FILE_WRITE_DISK_PRECONDITION_RUNTIME_CAPABILITY } from '../../../shared/file-write-disk-precondition'
import { getDiskBaselineSignature } from '../../../shared/disk-baseline-signature'
import {
  fsWriteFile,
  installRuntimeFileClientEnvironment,
  runtimeEnvironmentCall,
  runtimeEnvironmentTransportCall,
  type RuntimeRpcRequest
} from './runtime-file-client-test-harness'

installRuntimeFileClientEnvironment()

const remoteContext = {
  target: { kind: 'environment' as const, environmentId: 'env-1' },
  worktreeId: 'wt-1',
  worktreePath: '/remote/repo'
}
const precondition = { expectedSignature: getDiskBaselineSignature('original') }

function rpcOk(result: unknown) {
  return { id: 'rpc', ok: true, result, _meta: { runtimeId: 'remote-runtime' } }
}

function serveHost(options: { enforcesPrecondition: boolean; diskContent?: string }): void {
  runtimeEnvironmentTransportCall.mockImplementation((args: RuntimeRpcRequest) => {
    if (args.method === 'status.get') {
      return Promise.resolve(
        rpcOk({
          runtimeId: 'remote-runtime',
          runtimeProtocolVersion: RUNTIME_PROTOCOL_VERSION,
          minCompatibleRuntimeClientVersion: MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION,
          capabilities: [
            FILE_MUTATION_OWNERSHIP_RUNTIME_CAPABILITY,
            ...(options.enforcesPrecondition
              ? [FILE_WRITE_DISK_PRECONDITION_RUNTIME_CAPABILITY]
              : [])
          ]
        })
      )
    }
    if (args.method === 'files.read') {
      return Promise.resolve(
        options.diskContent === undefined
          ? { id: 'rpc', ok: false, error: { code: 'runtime_error', message: 'ENOENT' } }
          : rpcOk({ content: options.diskContent, truncated: false, byteLength: 0 })
      )
    }
    return runtimeEnvironmentCall(args)
  })
}

function writeCalls(): RuntimeRpcRequest[] {
  return runtimeEnvironmentCall.mock.calls
    .map(([args]) => args)
    .filter((args) => args.method === 'files.write')
}

describe('writeRuntimeFile disk precondition', () => {
  it('sends the precondition to a local writer and returns its refusal', async () => {
    fsWriteFile.mockResolvedValue({ ok: false, diskConflict: 'changed' })

    const result = await writeRuntimeFile(
      { target: { kind: 'local' }, worktreeId: 'wt-1', worktreePath: '/repo' },
      '/repo/file.ts',
      'edited',
      undefined,
      precondition
    )

    expect(result).toEqual({ ok: false, diskConflict: 'changed' })
    expect(fsWriteFile).toHaveBeenCalledWith(
      expect.objectContaining({ diskPrecondition: precondition })
    )
  })

  it('lets a host that enforces the precondition compare at write time', async () => {
    serveHost({ enforcesPrecondition: true })
    runtimeEnvironmentCall.mockResolvedValue(rpcOk({ ok: false, diskConflict: 'missing' }))

    const result = await writeRuntimeFile(
      remoteContext,
      '/remote/repo/file.ts',
      'edited',
      undefined,
      precondition
    )

    expect(result).toEqual({ ok: false, diskConflict: 'missing' })
    expect(writeCalls()).toHaveLength(1)
    expect(writeCalls()[0]?.params).toMatchObject({ diskPrecondition: precondition })
    expect(runtimeEnvironmentTransportCall).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: 'files.read' })
    )
  })

  it('compares from the client before writing through an older host', async () => {
    serveHost({ enforcesPrecondition: false, diskContent: 'original' })
    runtimeEnvironmentCall.mockResolvedValue(rpcOk({ ok: true }))

    const result = await writeRuntimeFile(
      remoteContext,
      '/remote/repo/file.ts',
      'edited',
      undefined,
      precondition
    )

    expect(result).toEqual({ ok: true })
    expect(writeCalls()).toHaveLength(1)
    expect(writeCalls()[0]?.params).not.toHaveProperty('diskPrecondition')
  })

  it('refuses without writing when an older host holds newer disk content', async () => {
    serveHost({ enforcesPrecondition: false, diskContent: 'agent rewrite' })

    const result = await writeRuntimeFile(
      remoteContext,
      '/remote/repo/file.ts',
      'edited',
      undefined,
      precondition
    )

    expect(result).toEqual({ ok: false, diskConflict: 'changed' })
    expect(writeCalls()).toHaveLength(0)
  })

  it('does not autosave through an older host when the disk cannot be read', async () => {
    serveHost({ enforcesPrecondition: false })

    await expect(
      writeRuntimeFile(remoteContext, '/remote/repo/file.ts', 'edited', undefined, precondition)
    ).rejects.toThrow()
    expect(writeCalls()).toHaveLength(0)
  })

  it('lets an explicit save recreate an unreadable file through an older host', async () => {
    serveHost({ enforcesPrecondition: false })
    runtimeEnvironmentCall.mockResolvedValue(rpcOk({ ok: true }))

    const result = await writeRuntimeFile(
      remoteContext,
      '/remote/repo/file.ts',
      'edited',
      undefined,
      {
        ...precondition,
        allowMissing: true
      }
    )

    expect(result).toEqual({ ok: true })
    expect(writeCalls()).toHaveLength(1)
  })
})
