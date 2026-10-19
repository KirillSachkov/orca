import type { ComposerModel } from './composer-model'

type ComposerNavigationActionsInput = Pick<
  ComposerModel,
  | 'closeModal'
  | 'creating'
  | 'folderPathStatusBlocksCreate'
  | 'folderTargetRequiresConnection'
  | 'openSettingsPage'
  | 'openSettingsTarget'
  | 'selectedProjectGroup'
  | 'setActiveRuntimeEnvironmentPreference'
  | 'smartNameJiraSourceContext'
  | 'sourceIntentBlocksCreate'
>

import { useCallback } from 'react'
import { LINEAR_INTEGRATION_SECTION_ID } from '@/components/settings/task-provider-integration-section-ids'
import {
  getTaskSourceRuntimeSettings,
  type TaskSourceContext
} from '../../../../shared/task-source-context'

export function useComposerNavigationActions(input: ComposerNavigationActionsInput) {
  const {
    closeModal,
    creating,
    folderPathStatusBlocksCreate,
    folderTargetRequiresConnection,
    openSettingsPage,
    openSettingsTarget,
    selectedProjectGroup,
    setActiveRuntimeEnvironmentPreference,
    smartNameJiraSourceContext,
    sourceIntentBlocksCreate
  } = input

  const handleOpenAgentSettings = useCallback((): void => {
    openSettingsTarget({ pane: 'agents', repoId: null })
    openSettingsPage()
    closeModal()
  }, [closeModal, openSettingsPage, openSettingsTarget])

  // Why: reconnect lives on the integration card of the host that owns the source.
  const openIntegrationsOnSourceHost = useCallback(
    (sourceContext: TaskSourceContext | null | undefined, sectionId?: string): void => {
      const runtimeEnvironmentId =
        getTaskSourceRuntimeSettings(sourceContext).activeRuntimeEnvironmentId ?? null
      void setActiveRuntimeEnvironmentPreference(runtimeEnvironmentId).then((selected) => {
        if (!selected) {
          return
        }
        openSettingsTarget({
          pane: 'integrations',
          repoId: null,
          ...(sectionId ? { sectionId } : {})
        })
        openSettingsPage()
        closeModal()
      })
    },
    [closeModal, openSettingsPage, openSettingsTarget, setActiveRuntimeEnvironmentPreference]
  )

  const handleOpenJiraSettings = useCallback(
    (): void => openIntegrationsOnSourceHost(smartNameJiraSourceContext),
    [openIntegrationsOnSourceHost, smartNameJiraSourceContext]
  )

  const handleOpenLinearSettings = useCallback(
    (sourceContext: TaskSourceContext | null): void =>
      openIntegrationsOnSourceHost(sourceContext, LINEAR_INTEGRATION_SECTION_ID),
    [openIntegrationsOnSourceHost]
  )

  const folderCreateDisabled =
    creating ||
    sourceIntentBlocksCreate ||
    !selectedProjectGroup?.parentPath ||
    folderPathStatusBlocksCreate ||
    folderTargetRequiresConnection

  return {
    handleOpenAgentSettings,
    handleOpenJiraSettings,
    handleOpenLinearSettings,
    folderCreateDisabled
  }
}
