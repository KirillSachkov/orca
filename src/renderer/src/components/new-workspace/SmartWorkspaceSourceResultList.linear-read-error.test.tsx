// @vitest-environment happy-dom

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { credentialDecryptionMessage } from '../../../../shared/integration-credential-errors'
import type { LinearIssue } from '../../../../shared/linear/issue-types'
import type { LinearConnectionStatus } from '../../../../shared/linear/workspace-types'
import type { Repo } from '../../../../shared/repo-types'
import { Command } from '@/components/ui/command'
import {
  referenceLinearIssue,
  referenceRepo
} from '../sidebar/workspace-reference-fixtures.test-support'
import { SmartWorkspaceSourceResultList } from './SmartWorkspaceSourceResultList'
import { useWorkItemSourceSearch } from './use-work-item-source-search'

const mocks = vi.hoisted(() => {
  // Host-wide status carries no error: the composer must show the read's own failure.
  const linearStatus: LinearConnectionStatus = {
    connected: true,
    viewer: null,
    selectedWorkspaceId: 'workspace-1'
  }
  return {
    state: {
      checkLinearConnection: vi.fn(),
      linearStatus,
      linearStatusChecked: true,
      settings: null,
      preflightStatus: null,
      preflightStatusChecked: true,
      preflightStatusContextKey: 'test',
      refreshPreflightStatus: vi.fn(),
      searchLinearIssues: vi.fn<(query: string) => Promise<LinearIssue[]>>()
    }
  }
})
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state)
}))
vi.mock('@/lib/local-preflight-context', () => ({
  getLocalPreflightContext: () => ({}),
  localPreflightContextKey: () => 'test'
}))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('./use-jira-source-connection', () => ({
  useJiraSourceConnection: () => ({ status: null, loaded: false })
}))
vi.mock('./use-jira-url-source', () => ({ useJiraUrlSource: () => ({ intent: false }) }))
vi.mock('../use-jira-project-inventory', () => ({
  useJiraProjectInventory: () => ({ projects: [], connected: true, error: null, loading: false })
}))

const repo: Repo = { ...referenceRepo, executionHostId: 'runtime:env-1' }
// Stable identity: search effects depend on the repos array.
const repos = [repo]

function LinearPicker({
  value,
  onOpenLinearSettings
}: {
  value: string
  onOpenLinearSettings: React.ComponentProps<
    typeof SmartWorkspaceSourceResultList
  >['onOpenLinearSettings']
}): React.JSX.Element {
  const controller = useWorkItemSourceSearch({
    repos,
    selectedRepo: repo,
    repoId: repo.id,
    value,
    branchesEnabled: false,
    repoBackedSourcesDisabled: true
  })
  return (
    <Command>
      <button type="button" onClick={() => controller.setMode('linear')}>
        Linear tab
      </button>
      <SmartWorkspaceSourceResultList
        model={controller}
        onSelect={() => {}}
        onOpenLinearSettings={onOpenLinearSettings}
      />
    </Command>
  )
}

describe('composer Linear read errors', () => {
  afterEach(cleanup)

  it('shows the read credential error with Settings, and the next successful search clears it', async () => {
    const message = credentialDecryptionMessage('Linear')
    mocks.state.searchLinearIssues.mockImplementation(async (query) => {
      if (query === 'broken') {
        throw new Error(message)
      }
      return [referenceLinearIssue()]
    })
    const onOpenLinearSettings = vi.fn()
    const { rerender } = render(
      <LinearPicker value="broken" onOpenLinearSettings={onOpenLinearSettings} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Linear tab' }))

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain(message))
    fireEvent.click(screen.getByRole('option', { name: /Settings/ }))
    expect(onOpenLinearSettings).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'linear', hostId: 'runtime:env-1' })
    )

    // The status refresh after the failure re-runs the same read; the error must stay up.
    mocks.state.linearStatus = { ...mocks.state.linearStatus, credentialError: message }
    rerender(<LinearPicker value="broken" onOpenLinearSettings={onOpenLinearSettings} />)
    expect(screen.getByText(message)).toBeTruthy()
    await waitFor(() => expect(mocks.state.searchLinearIssues).toHaveBeenCalledTimes(2))
    expect(screen.getByText(message)).toBeTruthy()

    rerender(<LinearPicker value="launch" onOpenLinearSettings={onOpenLinearSettings} />)
    await waitFor(() => expect(screen.getByText(/Task/)).toBeTruthy())
    expect(screen.queryByText(message)).toBeNull()
  })
})
