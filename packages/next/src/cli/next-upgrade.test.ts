import { ChildProcess } from 'child_process'
import spawn from 'next/dist/compiled/cross-spawn'
import { processEnv, resetEnv, updateInitialEnv } from '@next/env'
import {
  reportAgentUpgradeAgentResult,
  runUpgrade,
  spawnNextUpgrade,
} from './next-upgrade'

jest.mock('next/dist/compiled/cross-spawn', () => jest.fn())
jest.mock('../lib/helpers/get-npx-command', () => ({
  getNpxCommand: () => 'pnpm --loglevel=error dlx',
}))
const spawnMock = jest.mocked(spawn)
const originalExitCode = process.exitCode
beforeEach(() => {
  jest.resetAllMocks()
  process.exitCode = undefined
  spawnMock.mockImplementation(() => {
    const child = new ChildProcess()
    child.kill = jest.fn(() => true)
    process.nextTick(() => child.emit('close', 19, null))
    return child
  })
})
afterEach(() => {
  process.exitCode = originalExitCode
})

it('launches only @next/upgrade with the selected runner and nudge attribution', async () => {
  await spawnNextUpgrade(
    process.cwd(),
    { revision: 'latest', verbose: true, agent: 'latest' },
    { id: '<nudge-id>', recipient: 'human' }
  )
  expect(spawnMock).toHaveBeenCalledWith(
    'pnpm',
    [
      '--loglevel=error',
      'dlx',
      '@next/upgrade@canary',
      expect.any(String),
      '--agent=latest',
      '--verbose',
      '--internal-nudge-id',
      '<nudge-id>',
      '--internal-nudge-recipient',
      'human',
    ],
    { cwd: expect.any(String), stdio: 'inherit' }
  )
  expect(process.exitCode).toBe(19)
})
it('forwards legacy result reports without starting an upgrade', async () => {
  await reportAgentUpgradeAgentResult('<run-id>', 'success')
  expect(spawnMock).toHaveBeenCalledWith(
    'pnpm',
    [
      '--loglevel=error',
      'dlx',
      '@next/upgrade@canary',
      'internal',
      'report-agent-upgrade',
      '<run-id>',
      'success',
    ],
    { cwd: process.cwd(), stdio: 'inherit' }
  )
})
it.each(['security', 'latest', 'experimental-future'] as const)(
  'runs an explicitly requested %s upgrade',
  async (policy) => {
    const originalNextVersion = process.env.__NEXT_VERSION
    process.env.__NEXT_AGENT_UPGRADE = policy
    process.env.__NEXT_VERSION = '16.4.0-preview-test'
    processEnv([], process.cwd())
    updateInitialEnv({
      __NEXT_AGENT_UPGRADE: policy,
      __NEXT_VERSION: '16.4.0-preview-test',
    })
    spawnMock.mockImplementationOnce(() => {
      expect(process.env.__NEXT_AGENT_UPGRADE).toBeUndefined()
      // Future upgrade preparation reloads config and resets the environment.
      resetEnv()
      expect(process.env.__NEXT_AGENT_UPGRADE).toBeUndefined()
      expect(process.env.__NEXT_VERSION).toBe('16.4.0-preview-test')
      const child = new ChildProcess()
      child.kill = jest.fn(() => true)
      process.nextTick(() => child.emit('close', 19, null))
      return child
    })
    try {
      await runUpgrade(process.cwd(), policy, null)
      expect(spawnMock).toHaveBeenCalledWith(
        'pnpm',
        [
          '--loglevel=error',
          'dlx',
          '@next/upgrade@canary',
          process.cwd(),
          `--agent=${policy}`,
        ],
        { cwd: process.cwd(), stdio: 'inherit' }
      )
    } finally {
      if (originalNextVersion === undefined) {
        delete process.env.__NEXT_VERSION
      } else {
        process.env.__NEXT_VERSION = originalNextVersion
      }
      updateInitialEnv({ __NEXT_VERSION: originalNextVersion })
    }
  }
)
it('forwards termination and releases its signal listeners', async () => {
  const child = new ChildProcess()
  child.kill = jest.fn(() => true)
  spawnMock.mockImplementation(() => {
    process.nextTick(() => {
      process.listeners('SIGTERM').forEach((listener) => listener('SIGTERM'))
      child.emit('close', null, 'SIGTERM')
    })
    return child
  })
  const count = process.listenerCount('SIGTERM')
  await spawnNextUpgrade(
    process.cwd(),
    { revision: '16.4.0', verbose: false, agent: undefined },
    null
  )
  expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  expect(process.exitCode).toBe(143)
  expect(process.listenerCount('SIGTERM')).toBe(count)
})
