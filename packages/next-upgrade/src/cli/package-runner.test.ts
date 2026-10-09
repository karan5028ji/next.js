import { resolveCodemodVersion } from './package-runner'

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
})
it('resolves codemods independently from the upgrade package version', async () => {
  global.fetch = jest.fn(async () =>
    Response.json({ version: '99.0.0-canary.42' })
  )
  await expect(resolveCodemodVersion()).resolves.toBe('99.0.0-canary.42')
  expect(global.fetch).toHaveBeenCalledWith(
    'https://registry.npmjs.org/@next%2fcodemod/canary',
    expect.objectContaining({
      signal: expect.any(AbortSignal),
      cache: 'no-store',
      redirect: 'error',
    })
  )
})
it.each([null, 'canary', 'v16.4.0'])(
  'rejects an unpinnable codemod version %s',
  async (version) => {
    global.fetch = jest.fn(async () => Response.json({ version }))
    await expect(resolveCodemodVersion()).rejects.toThrow(
      'Could not determine the @next/codemod version.'
    )
  }
)
it('preserves metadata transport failures before generating a command', async () => {
  const error = new TypeError('fetch failed')
  global.fetch = jest.fn(async () => {
    throw error
  })
  await expect(resolveCodemodVersion()).rejects.toBe(error)
})
it('rejects an unsuccessful metadata response', async () => {
  global.fetch = jest.fn(async () => new Response(null, { status: 503 }))
  await expect(resolveCodemodVersion()).rejects.toThrow('HTTP 503')
})
