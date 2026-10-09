import { execFileSync } from 'child_process'
import { mkdir, mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { getUpgradeDismissal, getUpgradePreferences } from './preferences'

let mockPreferencesDirectory: string
jest.mock('conf', () => {
  const ActualConf = jest.requireActual('conf')
  return class extends ActualConf {
    constructor(options: object) {
      super({ ...options, cwd: mockPreferencesDirectory })
    }
  }
})
let directory: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'upgrade-preferences-'))
  mockPreferencesDirectory = join(directory, 'preferences')
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

it.each(['.', 'apps/web'])(
  'shares %s dismissals across worktrees without affecting other apps or repositories',
  async (appPath) => {
    const repository = join(directory, 'project.name')
    const worktree = join(directory, 'other-checkout')
    const git = (args: string[]) =>
      execFileSync(
        'git',
        ['-c', `core.hooksPath=${join(directory, 'no-hooks')}`, ...args],
        { cwd: directory, stdio: 'pipe' }
      )
    git(['init', repository])
    git([
      '-C',
      repository,
      '-c',
      'user.name=Next.js test',
      '-c',
      'user.email=nextjs@example.com',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--allow-empty',
      '-m',
      'Initialize test repository',
    ])
    git(['-C', repository, 'worktree', 'add', '--detach', worktree])
    const app = join(repository, appPath)
    const siblingApp = join(worktree, appPath)
    await mkdir(app, { recursive: true })
    await mkdir(siblingApp, { recursive: true })
    const { key, preferences } = await getUpgradePreferences(app)
    preferences.set(`${key}.security`, '16.4.0:experimental-future')
    expect(key).toMatch(
      new RegExp(
        `^agent-upgrade.${appPath === '.' ? 'project%2Ename' : 'web'}.[a-f0-9]{64}$`
      )
    )
    await expect(
      getUpgradeDismissal(siblingApp, '16.4.0', 'experimental-future')
    ).resolves.toBe('security')
    await expect(
      getUpgradeDismissal(siblingApp, '16.4.1', 'experimental-future')
    ).resolves.toBe(null)
    await expect(
      getUpgradeDismissal(siblingApp, '16.4.0', 'security')
    ).resolves.toBe(null)
    const otherApp = join(worktree, 'other/web')
    await mkdir(otherApp, { recursive: true })
    const otherRepository = join(directory, 'unrelated/project.name')
    git(['init', otherRepository])
    const unrelatedApp = join(otherRepository, appPath)
    await mkdir(unrelatedApp, { recursive: true })
    for (const other of [otherApp, unrelatedApp]) {
      await expect(
        getUpgradeDismissal(other, '16.4.0', 'experimental-future')
      ).resolves.toBe(null)
    }
  }
)
