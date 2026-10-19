import { describe, expect, it } from 'vitest'
import { agentLaunchSettingsMutationUpdates } from './agent-launch-settings'
import {
  newChatPermissionModeForSettings,
  normalizeAgentNativeChatPermissionModes
} from './agent-chat-permission-mode'
import { structuredLaunchSeedOptions } from './native-chat-session-option-defaults'
import { AgentLaunchSettingsMutation } from './rpc-contract/agent-launch-settings-params'
import { YOLO_TUI_AGENT_ARGS } from './tui-agent-permissions'

const settings = {
  agentDefaultArgs: { ...YOLO_TUI_AGENT_ARGS },
  nativeChatPermissionMode: 'full-access' as const
}

describe('scoped agent permission defaults', () => {
  it.each(['darwin', 'linux', 'win32'] as const)(
    'changes only Codex terminal and future chats on %s',
    (platform) => {
      const updates = agentLaunchSettingsMutationUpdates(
        settings,
        { type: 'permissions', agent: 'codex', mode: 'auto' },
        platform
      )
      const after = { ...settings, ...updates }
      expect(after.agentDefaultArgs.codex).toBe('--approve-for-me')
      expect(after.agentDefaultArgs.claude).toBe(YOLO_TUI_AGENT_ARGS.claude)
      expect(after.agentDefaultArgs.gemini).toBe(YOLO_TUI_AGENT_ARGS.gemini)
      expect(updates).not.toHaveProperty('nativeChatPermissionMode')
      expect(structuredLaunchSeedOptions(after, 'codex')).toEqual({ permissionMode: 'auto' })
      expect(structuredLaunchSeedOptions(after, 'claude')).toEqual({
        permissionMode: 'full-access'
      })
      expect(structuredLaunchSeedOptions(after, 'omp')).toEqual({ permissionMode: 'full-access' })
    }
  )

  it('uses shipped launch defaults for an agent without a stored arguments key', () => {
    const updates = agentLaunchSettingsMutationUpdates(
      { nativeChatPermissionMode: 'ask' },
      { type: 'permissions', agent: 'codex', mode: 'auto' },
      'linux'
    )
    expect(updates.agentDefaultArgs).toEqual({ codex: '--approve-for-me' })
    expect(updates.agentNativeChatPermissionModes).toEqual({ codex: 'auto' })
  })

  it('can configure Claude independently without adopting a model', () => {
    const first = {
      ...settings,
      ...agentLaunchSettingsMutationUpdates(
        settings,
        { type: 'permissions', agent: 'codex', mode: 'auto' },
        'linux'
      )
    }
    const after = {
      ...first,
      ...agentLaunchSettingsMutationUpdates(
        first,
        { type: 'permissions', agent: 'claude', mode: 'manual' },
        'linux'
      )
    }
    expect(after.agentNativeChatPermissionModes).toEqual({ codex: 'auto', claude: 'ask' })
    expect(structuredLaunchSeedOptions(after, 'claude')).toEqual({ permissionMode: 'ask' })
    expect(structuredLaunchSeedOptions(after, 'codex')).toEqual({ permissionMode: 'auto' })
    expect(after).not.toHaveProperty('nativeChatSessionOptions')
  })

  it.each(['yolo', 'manual'] as const)('bulk %s resets scoped chat overrides', (mode) => {
    const before = { ...settings, agentNativeChatPermissionModes: { codex: 'auto' as const } }
    const after = {
      ...before,
      ...agentLaunchSettingsMutationUpdates(before, { type: 'permissions', mode }, 'linux')
    }
    expect(after.agentNativeChatPermissionModes).toEqual({})
    expect(structuredLaunchSeedOptions(after, 'codex')).toEqual({
      permissionMode: mode === 'yolo' ? 'full-access' : 'ask'
    })
  })

  it('reapplies the same terminal choice to restore its scoped native default', () => {
    const before = {
      agentDefaultArgs: { codex: '--approve-for-me' },
      nativeChatPermissionMode: 'ask' as const
    }
    const updates = agentLaunchSettingsMutationUpdates(
      before,
      { type: 'permissions', agent: 'codex', mode: 'auto' },
      'linux'
    )
    expect(updates.agentDefaultArgs?.codex).toBe('--approve-for-me')
    expect(structuredLaunchSeedOptions({ ...before, ...updates }, 'codex')).toEqual({
      permissionMode: 'auto'
    })
  })

  it('rejects custom arguments without losing options or changing native permissions', () => {
    const before = { ...settings, agentDefaultArgs: { codex: '--model custom --approve-for-me' } }
    expect(() =>
      agentLaunchSettingsMutationUpdates(
        before,
        { type: 'permissions', agent: 'codex', mode: 'manual' },
        'linux'
      )
    ).toThrow('custom launch arguments')
    expect(before.agentDefaultArgs.codex).toBe('--model custom --approve-for-me')
    expect(before.nativeChatPermissionMode).toBe('full-access')
  })

  it('rejects scoped modes for agents without configurable terminal permissions', () => {
    expect(() =>
      agentLaunchSettingsMutationUpdates(
        settings,
        { type: 'permissions', agent: 'pi', mode: 'yolo' },
        'linux'
      )
    ).toThrow('no configurable')
  })

  it('refuses Auto for an agent without a reviewer', () => {
    expect(() =>
      agentLaunchSettingsMutationUpdates(
        settings,
        { type: 'permissions', agent: 'gemini', mode: 'auto' },
        'linux'
      )
    ).toThrow('does not support')
  })

  it('accepts both scoped and legacy permission wire mutations', () => {
    expect(
      AgentLaunchSettingsMutation.parse({ type: 'permissions', agent: 'codex', mode: 'auto' })
    ).toEqual({ type: 'permissions', agent: 'codex', mode: 'auto' })
    expect(AgentLaunchSettingsMutation.parse({ type: 'permissions', mode: 'manual' })).toEqual({
      type: 'permissions',
      mode: 'manual'
    })
  })

  it('normalizes persisted overrides to only offered agent modes', () => {
    expect(
      normalizeAgentNativeChatPermissionModes({
        codex: 'auto',
        claude: 'accept-edits',
        omp: 'auto',
        mystery: 'full-access'
      })
    ).toEqual({ codex: 'auto', claude: 'accept-edits' })
    expect(
      newChatPermissionModeForSettings('codex', {
        nativeChatPermissionMode: 'full-access',
        agentNativeChatPermissionModes: { codex: 'ask' }
      })
    ).toBe('ask')
  })
})
