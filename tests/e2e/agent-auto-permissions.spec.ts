import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

test.use({ seedTestRepo: false })

test('agent permission presets persist terminal arguments and new native chat defaults', async ({
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  await orcaPage.getByRole('button', { name: 'Settings', exact: true }).click()
  await orcaPage.getByRole('button', { name: 'Agents', exact: true }).click()
  const permissions = orcaPage.getByRole('radiogroup', { name: 'Agent Permissions', exact: true })

  for (const [label, claude, codex, chat] of [
    ['Auto', '--permission-mode auto', '--approve-for-me', 'auto'],
    ['Manual', '', '', 'ask'],
    [
      'Yolo',
      '--dangerously-skip-permissions',
      '--dangerously-bypass-approvals-and-sandbox',
      'full-access'
    ],
    ['Auto', '--permission-mode auto', '--approve-for-me', 'auto']
  ]) {
    await permissions.getByRole('radio', { name: label, exact: true }).click()
    await expect(permissions.getByRole('radio', { name: label, exact: true })).toBeChecked()
    await expect
      .poll(() =>
        orcaPage.evaluate(async () => {
          const settings = await window.api.settings.get()
          return {
            claude: settings.agentDefaultArgs?.claude,
            teams: settings.agentDefaultArgs?.['claude-agent-teams'],
            codex: settings.agentDefaultArgs?.codex,
            chat: settings.nativeChatPermissionMode
          }
        })
      )
      .toEqual({ claude, teams: claude, codex, chat })
  }

  await orcaPage.reload()
  await waitForSessionReady(orcaPage)
  await orcaPage.getByRole('button', { name: 'Agents', exact: true }).click()
  await expect(permissions.getByRole('radio', { name: 'Auto', exact: true })).toBeChecked()
  await expect(
    orcaPage.getByText('codex', { exact: false }).filter({ hasText: '--approve-for-me' }).first()
  ).toBeVisible()
})
