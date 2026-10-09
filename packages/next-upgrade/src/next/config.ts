import * as nodeModule from 'module'
import { requireFromProject } from './project'

export type UpgradeAppConfig = {
  distDir: string | undefined
  cacheComponents: boolean | undefined
  experimental: { agentUpgrade: unknown } | undefined
}

// Resolve configuration and environment state from the same installed Next graph.
// Loading this adapter alone does not load Next, so standalone help stays independent.
function configModules(directory: string) {
  const appRequire = requireFromProject(directory)
  const configPath = appRequire.resolve('next/dist/server/config')
  const nextRequire = Reflect.apply(
    Reflect.get(nodeModule, 'createRequire'),
    null,
    [configPath]
  ) as NodeRequire
  const config = nextRequire(configPath) as {
    default: (
      phase: string,
      directory: string,
      options: { rawConfig: true } | { silent: true }
    ) => Promise<unknown>
  }
  const shared = nextRequire('./config-shared') as {
    normalizeConfig: (
      phase: string,
      config: unknown
    ) => Promise<UpgradeAppConfig>
  }
  const env = nextRequire('@next/env') as {
    resetEnv: () => void
  }
  return {
    loadConfig: config.default,
    normalizeConfig: shared.normalizeConfig,
    env,
  }
}

export async function loadAgentUpgradeConfig(directory: string) {
  const { loadConfig, normalizeConfig } = configModules(directory)
  const phase = 'phase-production-build'
  const raw = await loadConfig(phase, directory, { rawConfig: true })
  const config = (raw as { default: unknown }).default || raw
  return normalizeConfig(phase, config)
}

export async function loadFutureConfig(directory: string) {
  const { loadConfig, env } = configModules(directory)
  // PHASE_INFO avoids a build while retaining Next's normal defaults and config hooks.
  return (await loadConfig('phase-info', directory, { silent: true }).finally(
    env.resetEnv
  )) as UpgradeAppConfig
}
