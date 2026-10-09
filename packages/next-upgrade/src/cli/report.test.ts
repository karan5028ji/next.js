import { loadAgentUpgradeConfig } from '../next/config'
import { createTelemetry } from '../next/telemetry'
import { reportAgentUpgradeAgentResult } from './report'
jest.mock('../next/config', () => ({ loadAgentUpgradeConfig: jest.fn() }))
jest.mock('../next/telemetry', () => ({
  ...jest.requireActual('../next/telemetry'),
  createTelemetry: jest.fn(),
}))
const runId = 'acfdca44-4753-4022-9cc5-afdc19d6f56e'
it('reports the bounded result through the app transport and flushes', async () => {
  const record = jest.fn()
  const flush = jest.fn(async () => [])
  jest.mocked(loadAgentUpgradeConfig).mockResolvedValue({
    distDir: 'output',
    cacheComponents: undefined,
    experimental: undefined,
  })
  jest.mocked(createTelemetry).mockReturnValue({ record, flush })
  await reportAgentUpgradeAgentResult(runId, 'success')
  expect(record).toHaveBeenCalledWith({
    eventName: 'NEXT_AGENT_UPGRADE_AGENT_RESULT',
    payload: { schemaVersion: 1, runId, result: 'success' },
  })
  expect(flush).toHaveBeenCalledTimes(1)
})
it.each([
  ['invalid', 'success'],
  [runId, 'details'],
])('rejects unbounded report input %s %s', async (id, result) => {
  jest.clearAllMocks()
  await expect(reportAgentUpgradeAgentResult(id, result)).rejects.toThrow(
    'Expected an upgrade run UUID'
  )
  expect(createTelemetry).toHaveBeenCalledTimes(0)
})
