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
import { parseExecutionHostId } from '../../../../shared/execution-host'
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

  const handleOpenJiraSettings = useCallback((): void => {
    const runtimeEnvironmentId = getTaskSourceRuntimeSettings(
      smartNameJiraSourceContext
    ).activeRuntimeEnvironmentId
    const targetRuntimeEnvironmentId = runtimeEnvironmentId ?? null
    void setActiveRuntimeEnvironmentPreference(targetRuntimeEnvironmentId).then((selected) => {
      if (!selected) {
        return
      }
      openSettingsTarget({ pane: 'integrations', repoId: null })
      openSettingsPage()
      closeModal()
    })
  }, [
    closeModal,
    openSettingsPage,
    openSettingsTarget,
    setActiveRuntimeEnvironmentPreference,
    smartNameJiraSourceContext
  ])

  const handleOpenLinearSettings = useCallback(
    (sourceContext: TaskSourceContext | null): void => {
      // Why: reconnect lives on the Linear card of the host that ran the failed read.
      const host = parseExecutionHostId(sourceContext?.hostId)
      void setActiveRuntimeEnvironmentPreference(
        host?.kind === 'runtime' ? host.environmentId : null
      ).then((selected) => {
        if (!selected) {
          return
        }
        openSettingsTarget({
          pane: 'integrations',
          repoId: null,
          sectionId: LINEAR_INTEGRATION_SECTION_ID
        })
        openSettingsPage()
        closeModal()
      })
    },
    [closeModal, openSettingsPage, openSettingsTarget, setActiveRuntimeEnvironmentPreference]
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
