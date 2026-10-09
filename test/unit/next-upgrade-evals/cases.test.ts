import { execFileSync } from 'child_process'
import { join } from 'path'

describe('candidate upgrade evidence', () => {
  it('requires the requested policy and successful command completion', () => {
    const program = `
      require('tsx/cjs')
      const { verifyRun } = require('./evals/next-upgrade/verifier/verify.ts')
      const trials = [
        { args: ['upgrade', '--agent=security'], code: 0, expected: true },
        { args: ['upgrade', '--agent'], code: 0, expected: true },
        { args: ['upgrade', '--agent', 'latest'], code: 0, expected: false },
        { args: ['upgrade', '--agent=security', '--help'], code: 0, expected: false },
        { args: ['upgrade', '--agent=security', '--agent=latest'], code: 0, expected: false },
        { args: ['upgrade', '--agent=security'], code: 1, expected: false },
        { args: ['upgrade', '--agent=security'], code: null, expected: false },
      ]
      ;(async () => {
        for (const trial of trials) {
          const invocation = { args: trial.args, version: '16.5.0-canary.3', executable: '/tmp/next-upgrade-eval/next/node_modules/next/dist/bin/next' }
          const completion = { args: trial.args, version: invocation.version, exitCode: trial.code }
          const artifact = { trees: [], capturedAt: '', evidence: {
            'invocations.jsonl': JSON.stringify(invocation),
            'commands.jsonl': JSON.stringify(completion),
          } }
          const verdict = await verifyRun('security-same-major', { kind: 'direct', policy: 'security' }, artifact, { result: {} }, '/tmp/unused')
          if (verdict.checks['candidate-cli'].passed !== trial.expected) {
            throw new Error(JSON.stringify(trial))
          }
        }
      })().catch(error => { console.error(error); process.exitCode = 1 })
    `
    expect(
      execFileSync(process.execPath, ['-e', program], {
        cwd: join(__dirname, '../../..'),
        encoding: 'utf8',
      }).trim()
    ).toBe('')
  })
})

describe('fixed judge execution boundary', () => {
  const {
    completedJudge,
  } = require('../../../evals/next-upgrade/verifier/judge/EVAL')

  it('accepts a completed semantic failure while rejecting runner and parser failures', () => {
    const verdict = { pass: false, reason: 'Final response omitted the notice' }
    expect(completedJudge({ ok: true, agentExitCode: 0 }, verdict)).toEqual(
      verdict
    )
    expect(() =>
      completedJudge({ ok: false, agentExitCode: 1 }, verdict)
    ).toThrow()
    expect(() => completedJudge({ ok: true, agentExitCode: 0 }, null)).toThrow()
  })
})

describe('prepared candidate and cleanup ownership', () => {
  const {
    validatePreparedCandidate,
    cleanupOwned,
  } = require('../../../evals/next-upgrade/run.js')

  it('rejects stale source or package provenance before remote execution', () => {
    const expected = {
      sourceRevision: 'current',
      originalVersion: '16.5.0-canary.3',
      nextSha256: 'package',
    }
    const provenance = {
      ...expected,
      declaredVersion: '16.5.0',
      compiledVersion: 'Next.js v16.5.0',
    }
    expect(() => validatePreparedCandidate(provenance, expected)).not.toThrow()
    expect(() =>
      validatePreparedCandidate(
        { ...provenance, sourceRevision: 'old' },
        expected
      )
    ).toThrow()
    expect(() =>
      validatePreparedCandidate(
        { ...provenance, nextSha256: 'other' },
        expected
      )
    ).toThrow()
  })

  it('attempts every owned cleanup and reports failures together', async () => {
    const calls: string[] = []
    await expect(
      cleanupOwned([
        async () => {
          calls.push('toolchain')
          throw new Error('delete failed')
        },
        async () => {
          calls.push('verifier')
        },
        async () => {
          calls.push('temporary')
        },
      ])
    ).rejects.toThrow('cleanup')
    expect(calls).toEqual(['toolchain', 'verifier', 'temporary'])
  })
})
