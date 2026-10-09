#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn, execFileSync } = require('node:child_process')
const { config } = require('dotenv')
require('tsx/cjs')
const { Snapshot, APIError } = require('@vercel/sandbox')
const { packPackage } = require('../lib/pack')
const { prepareVerifier } = require('./verifier/verify.ts')
const {
  buildStableCandidate,
  prepareToolchain,
  cleanupOwned,
  hash,
  redact,
  preflight,
} = require('./run')
const root = path.resolve(__dirname, '../..')

// A snapshot key describes only trusted tooling. Candidate packages, prompts,
// agent credentials and delivered source never enter this cross-run cache.
function snapshotKey() {
  const digest = crypto.createHash('sha256')
  for (const file of [
    'pnpm-lock.yaml',
    'evals/next-upgrade/run.js',
    'evals/next-upgrade/verifier/verify.ts',
    'evals/lib/setup.ts',
    'patches/@vercel__agent-eval@2.2.1.patch',
    'evals/next-upgrade/batch.js',
  ]) {
    digest.update(file).update(fs.readFileSync(path.join(root, file)))
  }
  return digest.digest('hex')
}

async function reusableSnapshot(id) {
  if (!id) {
    return null
  }
  let snapshot
  try {
    snapshot = await Snapshot.get({ snapshotId: id })
  } catch (error) {
    if (!(error instanceof APIError) || error.response.status !== 404) {
      throw error
    }
    console.log(`Cached snapshot ${id} is missing; preparing a replacement`)
    return null
  }
  if (
    snapshot.status !== 'created' ||
    !snapshot.expiresAt ||
    snapshot.expiresAt.getTime() < Date.now() + 3600000
  ) {
    console.log(
      `Cached snapshot ${id} is unavailable or near expiry; preparing a replacement`
    )
    return null
  }
  return snapshot
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--cache-key') {
    console.log(`${new Date().toISOString().slice(0, 10)}-${snapshotKey()}`)
    return
  }
  const available = fs.readdirSync(path.join(__dirname, 'cases')).sort()
  const dry = args.includes('--dry')
  const selected = args.filter((arg) => arg !== '--dry')
  const cases = selected.length ? selected : available
  if (
    new Set(cases).size !== cases.length ||
    cases.some((name) => !available.includes(name))
  ) {
    throw new Error(`Select unique cases: ${available.join(', ')}`)
  }
  if (dry) {
    console.log(
      JSON.stringify(
        cases.flatMap((name) =>
          ['codex', 'claude'].map((agent) => ({ case: name, agent }))
        ),
        null,
        2
      )
    )
    return
  }
  config({ path: path.join(root, '.env.local'), override: false })
  config({ path: path.join(root, '.env'), override: false })
  preflight()
  if (process.env.NEXT_UPGRADE_EVAL_EXPERIMENT) {
    throw new Error(
      'Batch runs both agents; unset NEXT_UPGRADE_EVAL_EXPERIMENT'
    )
  }
  const id = `batch-${new Date().toISOString().replaceAll(':', '-')}-${crypto.randomBytes(3).toString('hex')}`
  const work = path.join(__dirname, '.work', id)
  const output = path.join(__dirname, 'results', id)
  fs.mkdirSync(work, { recursive: true })
  fs.mkdirSync(output, { recursive: true })
  const started = Date.now()
  const children = new Set()
  let cancelled = false
  const cancel = () => {
    cancelled = true
    for (const child of children) {
      child.kill('SIGTERM')
    }
  }
  process.on('SIGINT', cancel)
  process.on('SIGTERM', cancel)
  const owned = []
  const trials = []
  try {
    // Prepare immutable packages once, then hand each case its own copy. Stable
    // identity is compiled in an isolated checkout, never relabelled afterwards.
    const packages = path.join(work, 'packages')
    fs.mkdirSync(packages)
    packPackage(
      path.join(root, 'packages/next'),
      path.join(packages, 'next.tgz')
    )
    packPackage(
      path.join(root, 'packages/next-codemod'),
      path.join(packages, 'codemod.tgz')
    )
    const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim()
    const inputs = {
      sourceRevision,
      'next.tgz': hash(path.join(packages, 'next.tgz')),
      'codemod.tgz': hash(path.join(packages, 'codemod.tgz')),
    }
    fs.writeFileSync(
      path.join(packages, 'packages.json'),
      JSON.stringify(inputs, null, 2)
    )
    let stable = null
    if (cases.some((name) => name.endsWith('-nudge'))) {
      const directory = path.join(work, 'stable')
      fs.mkdirSync(directory)
      stable = path.join(directory, 'next.tgz')
      const provenance = buildStableCandidate(work, stable)
      fs.writeFileSync(
        path.join(directory, 'stable-provenance.json'),
        JSON.stringify(provenance, null, 2)
      )
      inputs.stable = provenance
    }
    fs.writeFileSync(
      path.join(output, 'inputs.json'),
      JSON.stringify(inputs, null, 2)
    )

    // A daily cache entry only references expiring remote snapshots. Treat
    // authentication/service errors as failures, not as ordinary cache misses.
    const cacheFile = process.env.NEXT_UPGRADE_EVAL_SNAPSHOT_CACHE
    const key = snapshotKey()
    const cached =
      cacheFile && fs.existsSync(cacheFile)
        ? JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
        : null
    const snapshots = {}
    const restored = {}
    const prepared = await Promise.allSettled(
      [
        ['toolchain', () => prepareToolchain(output)],
        ['verifier', () => prepareVerifier()],
      ].map(async ([name, prepare]) => {
        const previous =
          cached?.key === key ? await reusableSnapshot(cached[name]) : null
        restored[name] = Boolean(previous)
        const snapshot = previous ?? (await prepare())
        snapshots[name] = snapshot.snapshotId
        if (!previous) {
          owned.push(() => snapshot.delete())
        }
      })
    )
    const errors = prepared
      .filter((item) => item.status === 'rejected')
      .map((item) => item.reason)
    if (errors.length) {
      throw new global.AggregateError(
        errors,
        'Batch snapshot preparation failed'
      )
    }
    if (cacheFile) {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true })
      fs.writeFileSync(
        cacheFile,
        JSON.stringify({ key, ...snapshots }, null, 2)
      )
      // The cache owns these snapshots until their one-day TTL. A trial must
      // never delete a snapshot that another workflow can still be using.
      owned.length = 0
    }
    const preparationMs = Date.now() - started
    fs.writeFileSync(
      path.join(output, 'infrastructure.json'),
      JSON.stringify(
        { snapshots, restored, preparationMs, cacheExpiresWithinHours: 24 },
        null,
        2
      )
    )
    if (cancelled) {
      throw new Error('Batch cancelled during preparation')
    }

    // Six native processes each prepare one fixture for two independent agent
    // forks. A failed case does not cancel the remaining evidence collection.
    const completed = await Promise.allSettled(
      cases.map(async (name) => {
        const runId = `${id}.${name}`
        const log = fs.openSync(path.join(output, `${name}.log`), 'w')
        const caseStarted = Date.now()
        const env = {
          ...process.env,
          NEXT_UPGRADE_EVAL_RUN_ID: runId,
          NEXT_UPGRADE_EVAL_PACKAGES: packages,
          AGENT_EVAL_SANDBOX_SNAPSHOT_ID: snapshots.toolchain,
          NEXT_UPGRADE_EVAL_VERIFIER_SNAPSHOT_ID: snapshots.verifier,
        }
        delete env.NEXT_UPGRADE_EVAL_STABLE_TARBALL
        if (name.endsWith('-nudge')) {
          env.NEXT_UPGRADE_EVAL_STABLE_TARBALL = stable
        }
        let exitCode
        try {
          exitCode = await new Promise((resolve, reject) => {
            const child = spawn(
              process.execPath,
              [path.join(__dirname, 'run.js'), name],
              { cwd: root, env, stdio: ['ignore', log, log] }
            )
            children.add(child)
            child.once('error', reject)
            child.once('close', (code) => {
              children.delete(child)
              resolve(code ?? 130)
            })
          })
        } finally {
          fs.closeSync(log)
        }
        for (const agent of ['codex', 'claude']) {
          const file = path.join(
            __dirname,
            'results',
            runId,
            'evidence',
            agent,
            'verdict.json'
          )
          const verdict = fs.existsSync(file)
            ? JSON.parse(fs.readFileSync(file, 'utf8'))
            : {
                status: 'invalid',
                reason: 'Missing authoritative verdict; inspect case log',
              }
          trials.push({
            case: name,
            agent,
            runId,
            exitCode,
            durationMs: Date.now() - caseStarted,
            ...verdict,
          })
        }
        console.log(
          `${name}: ${trials
            .filter((trial) => trial.case === name)
            .map((trial) => `${trial.agent}=${trial.status}`)
            .join(', ')}`
        )
      })
    )
    for (let index = 0; index < completed.length; index++) {
      if (completed[index].status === 'rejected') {
        for (const agent of ['codex', 'claude']) {
          trials.push({
            case: cases[index],
            agent,
            status: 'invalid',
            reason: redact(String(completed[index].reason)),
          })
        }
      }
    }
    trials.sort((a, b) =>
      `${a.case}/${a.agent}`.localeCompare(`${b.case}/${b.agent}`)
    )
    const summary = {
      sourceRevision,
      preparationMs,
      totalMs: Date.now() - started,
      cancelled,
      trials,
    }
    fs.writeFileSync(
      path.join(output, 'summary.json'),
      redact(JSON.stringify(summary, null, 2))
    )
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `## Upgrade evals\n\nPreparation: ${Math.round(preparationMs / 1000)}s; total: ${Math.round(summary.totalMs / 1000)}s.\n\n| Case | Agent | Result | Case duration |\n| --- | --- | --- | --- |\n` +
          trials
            .map(
              (trial) =>
                `| ${trial.case} | ${trial.agent} | ${trial.status} | ${Math.round((trial.durationMs ?? 0) / 1000)}s |`
            )
            .join('\n') +
          '\n'
      )
    }
    process.exitCode =
      cancelled ||
      trials.some((trial) => trial.status !== 'passed' || trial.exitCode !== 0)
        ? 1
        : 0
  } catch (error) {
    fs.writeFileSync(
      path.join(output, 'batch-error.json'),
      redact(
        JSON.stringify(
          {
            error: String(error),
            causes:
              error instanceof global.AggregateError
                ? error.errors.map(String)
                : [],
          },
          null,
          2
        )
      )
    )
    throw error
  } finally {
    let retained = true
    try {
      await cleanupOwned([
        () => {
          const log = path.join(work, 'stable-build.log')
          if (fs.existsSync(log)) {
            try {
              fs.copyFileSync(log, path.join(output, 'stable-build.log'))
            } catch (error) {
              retained = false
              throw error
            }
          }
        },
        ...owned,
      ])
    } finally {
      if (retained) {
        fs.rmSync(work, { recursive: true, force: true })
      }
      process.off('SIGINT', cancel)
      process.off('SIGTERM', cancel)
    }
    console.log(`Retained batch: ${output}`)
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(redact(String(error)))
    if (error instanceof global.AggregateError) {
      for (const cause of error.errors) {
        console.error(redact(String(cause)))
      }
    }
    process.exitCode = 1
  })
}
module.exports = { main, snapshotKey, reusableSnapshot }
