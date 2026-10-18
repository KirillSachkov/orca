import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as AgentStatusModule from '@/lib/agent-status'
import { installActiveWorktreeRemovalSuccessor } from '@/lib/active-worktree-removal-successor'
import { createTestStore, makeWorktree, seedStore } from './store-test-helpers'
import { createStoreCascadesMockApi } from './store-cascades-test-harness'

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() }
}))
vi.mock('@/components/terminal-pane/pty-dispatcher', () => ({
  restorePtyDataHandlersAfterFailedShutdown: vi.fn(),
  unregisterPtyDataHandlers: vi.fn(() => [])
}))
vi.mock('@/lib/agent-status', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentStatusModule>()
  return { ...actual, detectAgentStatusFromTitle: vi.fn().mockReturnValue(null) }
})
vi.mock('@/lib/worktree-activation', () => ({ activateAndRevealWorktree: vi.fn() }))

import { activateAndRevealWorktree } from '@/lib/worktree-activation'

const mockApi = createStoreCascadesMockApi()
let dispose: (() => void) | null = null

afterEach(() => {
  dispose?.()
  dispose = null
})

describe('deleting the active workspace', () => {
  it('hands off to a sibling when the workspace showed only a browser tab', async () => {
    mockApi.worktrees.remove.mockResolvedValue(undefined)
    const store = createTestStore()
    const active = makeWorktree({
      id: 'repo1::/path/active',
      repoId: 'repo1',
      path: '/path/active'
    })
    const sibling = makeWorktree({
      id: 'repo1::/path/sibling',
      repoId: 'repo1',
      path: '/path/sibling'
    })
    seedStore(store, {
      worktreesByRepo: { repo1: [active, sibling] },
      activeWorktreeId: active.id,
      activeView: 'terminal'
    })
    store.getState().createBrowserTab(active.id, 'https://example.com')
    dispose = installActiveWorktreeRemovalSuccessor(store)

    const result = await store.getState().removeWorktree({ id: active.id, executionHostId: null })
    await Promise.resolve()

    // Closing the last browser tab during teardown must not clear the selection before the row goes.
    expect(result).toEqual({ ok: true })
    expect(activateAndRevealWorktree).toHaveBeenCalledOnce()
    expect(vi.mocked(activateAndRevealWorktree).mock.calls[0][0]).toBe(sibling.id)
  })
})
