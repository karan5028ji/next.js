import { execFileSync } from 'child_process'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const collector = join(
  __dirname,
  '../../../evals/next-upgrade/runner/capture.mjs'
)

it('exports committed, dirty and untracked worktree delivery before grading', () => {
  const temporary = realpathSync(
    mkdtempSync(join(tmpdir(), 'upgrade-capture-'))
  )
  const repository = join(temporary, 'app')
  const worktree = join(temporary, 'delivery')
  const tools = join(temporary, 'tools')
  mkdirSync(repository)
  mkdirSync(tools)
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args],
      { cwd: repository, stdio: 'pipe' }
    )
  try {
    git('init')
    git('config', 'user.name', 'Eval Test')
    git('config', 'user.email', 'eval@example.invalid')
    writeFileSync(join(repository, 'page.txt'), 'baseline')
    git('add', '.')
    git('commit', '-m', 'Create test baseline')
    git('worktree', 'add', '-b', 'delivery', worktree)
    writeFileSync(join(worktree, 'page.txt'), 'committed upgrade')
    execFileSync(
      'git',
      [
        '-c',
        'commit.gpgsign=false',
        '-C',
        worktree,
        'commit',
        '-am',
        'Upgrade test app',
      ],
      { stdio: 'pipe' }
    )
    writeFileSync(join(worktree, 'page.txt'), 'dirty upgrade')
    writeFileSync(join(worktree, 'new.txt'), 'untracked source')
    writeFileSync(join(worktree, '.env.local'), 'TEST_CREDENTIAL=do-not-export')
    mkdirSync(join(worktree, 'node_modules'))
    writeFileSync(join(worktree, 'node_modules/cache.txt'), 'not source')
    execFileSync(process.execPath, [collector, repository, tools])
    const artifact = JSON.parse(
      readFileSync(join(tools, 'artifact.json'), 'utf8')
    )
    // Identify delivery by its Git commit: Windows temporary paths can have
    // different spellings in Git and Node while referring to the same worktree.
    const deliveryHead = git('-C', worktree, 'rev-parse', 'HEAD')
      .toString()
      .trim()
    const baselineHead = git('rev-parse', 'HEAD').toString().trim()
    const delivered = artifact.trees.find((tree) => tree.head === deliveryHead)
    expect(Buffer.from(delivered.files['page.txt'], 'base64').toString()).toBe(
      'dirty upgrade'
    )
    expect(Buffer.from(delivered.files['new.txt'], 'base64').toString()).toBe(
      'untracked source'
    )
    expect(Object.keys(delivered.files).sort()).toEqual(['new.txt', 'page.txt'])
    expect(delivered.head).not.toBe(
      artifact.trees.find((tree) => tree.head === baselineHead).head
    )
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})

it('rejects source symlinks instead of exporting files outside the app', () => {
  const temporary = realpathSync(
    mkdtempSync(join(tmpdir(), 'upgrade-capture-'))
  )
  try {
    execFileSync('git', ['init', temporary], { stdio: 'pipe' })
    execFileSync(
      'git',
      [
        '-C',
        temporary,
        '-c',
        'user.name=Eval Test',
        '-c',
        'user.email=eval@example.invalid',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--allow-empty',
        '-m',
        'Create test baseline',
      ],
      { stdio: 'pipe' }
    )
    symlinkSync('/etc/hosts', join(temporary, 'outside.txt'))
    expect(() =>
      execFileSync(process.execPath, [collector, temporary, temporary], {
        stdio: 'pipe',
      })
    ).toThrow(/Unsupported source symlink/)
    const failure = JSON.parse(
      readFileSync(join(temporary, 'capture-failure.json'), 'utf8')
    )
    expect(failure.kind).toBe('delivery')
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})
