import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { claimNudgeRetry } from './retry-receipt'

let directory: string
const allowed = new Set<string>()
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'next-upgrade-receipt-'))
  allowed.clear()
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})
const claim = () =>
  claimNudgeRetry(
    { directory, distDir: '.next', command: 'dev' },
    '16.0.0',
    'security',
    allowed
  )
const cache = () => join(directory, '.next/cache/next-agentic-upgrade-retries')
it('atomically consumes one receipt and keeps session permission explicit', async () => {
  const first = await claim()
  expect(first.allowed).toBe(false)
  const results = await Promise.all([claim(), claim()])
  expect(results.map((result) => result.allowed).sort()).toEqual([false, true])
  allowed.add(first.identity)
  await expect(claim()).resolves.toEqual({
    identity: first.identity,
    allowed: true,
  })
  expect(
    (await readdir(cache())).filter((file) => file.endsWith('.claim'))
  ).toEqual([])
})
it.each(['expired', 'invalid'] as const)(
  'replaces an %s receipt without granting permission',
  async (state) => {
    const { identity } = await claim()
    const file = join(cache(), `${identity}.json`)
    await writeFile(
      file,
      state === 'expired'
        ? JSON.stringify({ issuedAt: Date.now() - 5 * 60 * 1000 })
        : 'invalid'
    )
    expect((await claim()).allowed).toBe(false)
    expect(typeof JSON.parse(await readFile(file, 'utf8')).issuedAt).toBe(
      'number'
    )
    expect((await claim()).allowed).toBe(true)
  }
)
it('preserves storage failures instead of granting a retry', async () => {
  await mkdir(join(directory, '.next'))
  await writeFile(join(directory, '.next/cache'), 'not a directory')
  await expect(claim()).rejects.toThrow()
})
