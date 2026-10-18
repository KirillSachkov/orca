import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { getRepoMapFromState } from '@/store/selectors'
import { getRepoIdFromWorktreeId } from '@/store/slices/worktree-helpers'
import { isAutomaticDeselection } from '@/store/active-worktree-deselection-intent'
import {
  worktreeHostMatchOptions,
  worktreeMatchesHost
} from '@/store/slices/worktrees/listing/worktree-host-ownership'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { getWorktreeVisitTimestamp } from '@/lib/worktree-visit-recency'
import { getDeleteStateForWorktreeHost } from '@/components/sidebar/worktree-delete-state-host-match'
import {
  isRuntimeOwnedSshTargetId,
  parseExecutionHostId,
  type ExecutionHostId
} from '../../../shared/execution-host'
import type { Repo } from '../../../shared/repo-types'
import type { Worktree } from '../../../shared/worktree/types'

type SuccessorState = Pick<
  AppState,
  | 'worktreesByRepo'
  | 'repos'
  | 'deleteStateByWorktreeId'
  | 'lastVisitedAtByWorktreeId'
  | 'activeWorktreeId'
  | 'activeWorkspaceExecutionHostId'
  | 'activeView'
  | 'activePendingCreationId'
>

type RemovedActiveRow = { id: string; hostId: ExecutionHostId | null; repoId: string }

function findListedRow(
  state: Pick<AppState, 'worktreesByRepo' | 'repos'>,
  worktreeId: string,
  hostId: ExecutionHostId | null
): Worktree | undefined {
  const repoId = getRepoIdFromWorktreeId(worktreeId)
  const rows = state.worktreesByRepo[repoId] ?? []
  if (!hostId) {
    return rows.find((row) => row.id === worktreeId)
  }
  const matchOptions = worktreeHostMatchOptions(state, repoId, hostId)
  return rows.find((row) => row.id === worktreeId && worktreeMatchesHost(row, hostId, matchOptions))
}

// Why: a per-workspace-env's runtime-owned SSH target is torn down with its workspace, so a sibling
// hosted on that target would land on a dead runtime and auto-create a terminal that never spawns.
function isHostedOnRuntimeOwnedSshTarget(
  worktree: Pick<Worktree, 'hostId' | 'repoId'>,
  repoById: Map<string, Repo>
): boolean {
  const hostIds = [
    worktree.hostId,
    repoById.get(worktree.repoId)?.executionHostId,
    repoById.get(worktree.repoId)?.connectionId
  ]
  return hostIds.some((value) => {
    if (!value) {
      return false
    }
    // connectionId is a raw target id; executionHostId/hostId are `ssh:<targetId>`.
    if (isRuntimeOwnedSshTargetId(value)) {
      return true
    }
    const parsed = parseExecutionHostId(value)
    return parsed?.kind === 'ssh' && isRuntimeOwnedSshTargetId(parsed.targetId)
  })
}

// Like closing a tab: the most recently visited other workspace of the project, else its main one.
export function pickActiveWorktreeSuccessor(
  state: SuccessorState,
  removed: RemovedActiveRow
): Worktree | null {
  const repoById = getRepoMapFromState(state)
  const siblings = (state.worktreesByRepo[removed.repoId] ?? []).filter(
    (worktree) =>
      !getDeleteStateForWorktreeHost(worktree, state.deleteStateByWorktreeId)?.isDeleting &&
      !isHostedOnRuntimeOwnedSshTarget(worktree, repoById)
  )
  const others = siblings.filter((worktree) => !worktree.isMainWorktree)
  if (others.length > 0) {
    const lastVisited = state.lastVisitedAtByWorktreeId
    return [...others].sort(
      (a, b) =>
        (getWorktreeVisitTimestamp(lastVisited, b) ?? 0) -
        (getWorktreeVisitTimestamp(lastVisited, a) ?? 0)
    )[0]
  }
  return siblings.find((worktree) => worktree.isMainWorktree) ?? null
}

function listedActiveRow(state: SuccessorState): RemovedActiveRow | null {
  const id = state.activeWorktreeId
  const row = id ? findListedRow(state, id, state.activeWorkspaceExecutionHostId) : undefined
  return row && id ? { id, hostId: state.activeWorkspaceExecutionHostId, repoId: row.repoId } : null
}

function isSelectionEmptyTerminalView(state: SuccessorState): boolean {
  return (
    state.activeView === 'terminal' &&
    state.activePendingCreationId === null &&
    state.activeWorktreeId === null
  )
}

/**
 * When the workspace the user is on leaves the list — any delete, a partly failed one, the CLI,
 * `git worktree remove`, another client — focus its successor instead of the empty landing screen.
 *
 * Removal paths clear the selection and drop the row in either order (a process exit can empty the
 * workspace first; startup drops rows before its purge), so this remembers the last listed active
 * row and hands off once the selection is empty and that row is gone.
 */
export function installActiveWorktreeRemovalSuccessor(store = useAppStore): () => void {
  let witness: RemovedActiveRow | null = listedActiveRow(store.getState())
  let generation = 0
  const unsubscribe = store.subscribe((next, prev) => {
    if (
      next.activeWorktreeId === prev.activeWorktreeId &&
      next.activeWorkspaceExecutionHostId === prev.activeWorkspaceExecutionHostId &&
      next.worktreesByRepo === prev.worktreesByRepo &&
      next.activeView === prev.activeView &&
      next.activePendingCreationId === prev.activePendingCreationId
    ) {
      return
    }
    if (next.activeWorktreeId !== null) {
      const listed = listedActiveRow(next)
      // An unlisted pointer to the witness is a row dropped before its selection clears.
      if (listed || witness?.id !== next.activeWorktreeId) {
        witness = listed
      }
      return
    }
    if (!witness) {
      return
    }
    const witnessListed = Boolean(findListedRow(next, witness.id, witness.hostId))
    const userCleared = prev.activeWorktreeId !== null && witnessListed && !isAutomaticDeselection()
    if (userCleared || !isSelectionEmptyTerminalView(next)) {
      witness = null
      return
    }
    if (witnessListed) {
      return
    }
    const removed = witness
    witness = null
    const scheduled = ++generation
    // Why a microtask: let the removal's own synchronous follow-up writes land first, then re-check.
    queueMicrotask(() => {
      const state = store.getState()
      if (
        scheduled !== generation ||
        !isSelectionEmptyTerminalView(state) ||
        findListedRow(state, removed.id, removed.hostId)
      ) {
        return
      }
      const successor = pickActiveWorktreeSuccessor(state, removed)
      if (successor) {
        // Keep successor focus from replacing the removed row's spatial context.
        activateAndRevealWorktree(successor.id, {
          revealInSidebar: false,
          executionHostId: successor.hostId
        })
      }
    })
  })
  return () => {
    generation += 1
    unsubscribe()
  }
}
