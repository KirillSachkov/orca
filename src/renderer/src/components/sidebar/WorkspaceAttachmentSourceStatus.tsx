import type React from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { getJiraSourceStatusMessage } from '../new-workspace/jira-source-status-message'
import type { WorkItemSourceSearch } from '../new-workspace/use-work-item-source-search'

export function WorkspaceAttachmentSourceStatus({
  controller,
  taskUrlProvider,
  resolved,
  error,
  onRetry
}: {
  controller: WorkItemSourceSearch
  taskUrlProvider: 'linear' | 'jira' | null
  resolved: boolean
  error: string | null
  onRetry: () => void
}): React.JSX.Element {
  const linearReadError =
    (controller.mode === 'linear' || controller.mode === 'smart') && controller.linearReadError
      ? translate(
          'auto.components.new.workspace.SmartWorkspaceNameField.linearCredentialUnreadable',
          'Orca can’t read your saved Linear login. Reconnect Linear in Settings to search issues.'
        )
      : null
  let message: string | null =
    error ??
    linearReadError ??
    translate('workspace.links.inlineSearchHint', 'Select a result to attach it.')
  let retry: (() => void) | null = null
  if (!error && taskUrlProvider === 'jira') {
    if (controller.jiraSource.intent) {
      message = getJiraSourceStatusMessage(controller.jiraSource)
      if (controller.jiraSource.errorKind) {
        retry = controller.jiraSource.retry
      }
    } else {
      message = translate(
        'workspace.links.jiraModeRequired',
        'Select Smart or Jira to load this issue.'
      )
      retry = () => controller.setMode('jira')
    }
  } else if (!error && taskUrlProvider === 'linear' && !resolved) {
    if (!controller.linearUrlIntentOwnsInput) {
      message = translate(
        'workspace.links.linearModeRequired',
        'Select Smart or Linear to load this issue.'
      )
      retry = () => controller.setMode('linear')
    } else if (!controller.linearStatusChecked) {
      message = translate('workspace.links.loadingLinear', 'Loading Linear issue…')
    } else if (!controller.linearStatus.connected) {
      message = translate(
        'workspace.links.linearConnectRequired',
        'Connect Linear in Settings to link this issue.'
      )
      retry = onRetry
    } else if (linearReadError) {
      // Why: Retry re-reads after the user approves Keychain access.
      message = linearReadError
      retry = onRetry
    } else if (controller.unresolvedLinearUrlIntent || controller.linearLoading) {
      message = translate('workspace.links.loadingLinear', 'Loading Linear issue…')
    } else {
      message = translate(
        'workspace.links.linearReadFailed',
        'Couldn’t load this Linear issue. Check the URL and connected workspace.'
      )
      retry = onRetry
    }
  }
  // Why: an empty result list already shows the Linear read error; keep the row (and its
  // action) so the sibling Reference type button doesn't shift.
  if (!error && message === linearReadError && controller.searchResultRows.length === 0) {
    message = null
  }
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"
    >
      {message ? <span>{message}</span> : null}
      {retry ? (
        <Button
          type="button"
          variant="link"
          size="xs"
          disabled={controller.disabled}
          onClick={retry}
        >
          {translate('workspace.links.retrySource', 'Retry')}
        </Button>
      ) : null}
    </div>
  )
}
