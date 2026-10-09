import { formatAgentNudge } from './notify'
import type { UpgradeReminder } from '../../shared/check-upgrade'

it.each([
  {
    policy: 'security',
    kind: 'security',
    installedVersion: '16.0.0',
    targetVersion: '16.1.0',
    reference: 'https://github.com/advisories/example',
  },
  {
    policy: 'latest',
    kind: 'latest',
    installedVersion: '17.0.0-canary.1',
    latestVersion: '17.1.0-canary.1',
    names: [],
  },
  {
    policy: 'experimental-future',
    kind: 'experimental-future',
    installedVersion: '16.4.0',
    targetVersion: '16.4.0',
    names: ['Cache Components'],
  },
] satisfies UpgradeReminder[])(
  'formats the $kind reminder without owning the command lifecycle',
  (reminder) => {
    const { message, reference } = formatAgentNudge(reminder, '<nudge-id>')
    expect(message).toContain(
      `next upgrade --agent=${reminder.policy} --internal-nudge-id=<nudge-id>`
    )
    expect(message).toContain(
      'Retry the same command to continue the original task.'
    )
    expect(message).toContain(
      'include this upgrade recommendation even if the retry succeeds'
    )
    if (reminder.kind === 'security') {
      expect(reference).toBe(reminder.reference)
    }
    if (reminder.kind === 'latest') {
      expect(reference).toBe('https://registry.npmjs.org/next/canary')
    }
    if (reminder.kind === 'experimental-future') {
      expect(message).toContain('- Cache Components')
      expect(reference).toBeNull()
    }
  }
)
