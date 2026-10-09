import { updateInitialEnv } from '@next/env'
import spawn from 'next/dist/compiled/cross-spawn'
import { existsSync } from 'fs'
import { constants } from 'os'
import { resolve } from 'path'
import { getNpxCommand } from '../lib/helpers/get-npx-command'
import { getProjectDir } from '../lib/get-project-dir'
import type { AgentUpgradePolicy } from '../telemetry/events/agent-upgrade'

type NextUpgradeOptions = {
  revision: string
  verbose: boolean
  agent: boolean | string | undefined
}

async function runUpgradeCommand(directory: string, args: string[]) {
  const [command, ...runnerArgs] = getNpxCommand(directory).split(' ')
  const child = spawn(
    command,
    [...runnerArgs, '@next/upgrade@canary', ...args],
    { cwd: existsSync(directory) ? directory : process.cwd(), stdio: 'inherit' }
  )
  const onInterrupt = () => child.kill('SIGINT')
  const onTerminate = () => child.kill('SIGTERM')
  const onHangup = () => child.kill('SIGHUP')
  process.on('SIGINT', onInterrupt)
  process.on('SIGTERM', onTerminate)
  process.on('SIGHUP', onHangup)
  try {
    process.exitCode = await new Promise<number>((resolveCode, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) =>
        resolveCode(
          code ?? (signal ? 128 + (constants.signals[signal] ?? 1) : 1)
        )
      )
    })
  } finally {
    process.removeListener('SIGINT', onInterrupt)
    process.removeListener('SIGTERM', onTerminate)
    process.removeListener('SIGHUP', onHangup)
  }
}

// Preserve the Next command while bootstrapping only the standalone upgrade tool.
export async function spawnNextUpgrade(
  directory: string | undefined,
  options: NextUpgradeOptions,
  nudgeSource: { id: string; recipient: 'human' | 'agent' } | null
) {
  const baseDir = options.agent
    ? resolve(directory || '.')
    : getProjectDir(directory)
  const args = [baseDir]
  if (options.agent) {
    args.push(
      typeof options.agent === 'string' ? `--agent=${options.agent}` : '--agent'
    )
  } else {
    args.push('--revision', options.revision)
  }
  if (options.verbose) {
    args.push('--verbose')
  }
  if (nudgeSource) {
    args.push(
      '--internal-nudge-id',
      nudgeSource.id,
      '--internal-nudge-recipient',
      nudgeSource.recipient
    )
  }
  await runUpgradeCommand(baseDir, args)
}

export async function reportAgentUpgradeAgentResult(
  runId: string,
  result: string
) {
  await runUpgradeCommand(process.cwd(), [
    'internal',
    'report-agent-upgrade',
    runId,
    result,
  ])
}

export async function runUpgrade(
  directory: string,
  policy: AgentUpgradePolicy,
  nudgeId: string | null
) {
  // The agent's dev/build commands must not repeat the parent's explicit request.
  delete process.env.__NEXT_AGENT_UPGRADE
  updateInitialEnv({ __NEXT_AGENT_UPGRADE: undefined })
  await spawnNextUpgrade(
    directory,
    { revision: 'latest', verbose: false, agent: policy },
    nudgeId ? { id: nudgeId, recipient: 'human' } : null
  )
  return process.exitCode ?? 0
}
