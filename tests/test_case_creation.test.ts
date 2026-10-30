import { afterEach, describe, expect, it, vi } from 'vitest'
import { TpClient } from '../src/tp.js'
import { config } from '../src/config.js'
import { handleAddTestCases } from '../src/handlers/add_test_cases_to_test_plan.js'
import { TpApiError } from '../src/http.js'
import { TestManagement } from '../src/test_management.js'

const originalProject = config.tp.projectId
afterEach(() => { vi.unstubAllGlobals(); config.tp.projectId = originalProject })
const json = (value: unknown) => new Response(JSON.stringify(value))
const input = { name: 'Login', description: 'Preconditions', steps: [{ description: 'Login', result: 'Dashboard' }] }

describe('case creation API', () => {
  it('inherits the destination project rather than the configured project', async () => {
    config.tp.projectId = '99'
    const mocked = vi.fn(async (_url: unknown, init?: RequestInit) => init?.method === 'GET'
      ? json({ Id: 12, Project: { Id: 17 } })
      : json({ Id: 100, Name: 'Login' }))
    vi.stubGlobal('fetch', mocked)
    await new TpClient().createTestCase('Login', '', '12')
    expect(JSON.parse(mocked.mock.calls[1][1]!.body as string)).toEqual({
      Name: 'Login', Description: '', Project: { Id: '17' }, TestPlans: { Items: [{ Id: '12' }] },
    })
  })

  it('rejects conflicting projects before creating anything', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ Id: 12, Project: { Id: 17 } })))
    await expect(new TpClient().createTestCase('Login', '', '12', { projectId: '99' })).rejects.toThrow('differs')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('surfaces the actual API creation error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Project is required', { status: 422 })))
    await expect(new TpClient().createTestCase('Login', '', undefined, { projectId: '17' })).rejects.toThrow('HTTP 422')
  })
})

function client() {
  return {
    createTestCase: vi.fn().mockResolvedValue({ Id: 100, Name: 'Login' }),
    addTestStep: vi.fn().mockResolvedValue({ Id: 200 }),
    getTestCaseSteps: vi.fn().mockResolvedValue({ Items: [{ Id: 200, RunOrder: 1, Description: 'Login', Result: 'Dashboard' }] }),
    getTestCaseTestPlans: vi.fn().mockResolvedValue([{ id: '12', name: 'Plan' }]),
  }
}

describe('batch creation outcomes', () => {
  it('verifies step IDs, order, and destination membership', async () => {
    const tp = client()
    const result = await handleAddTestCases(tp as unknown as TpClient, '12', [input])
    expect(result.isError).toBe(false)
    expect(JSON.parse(result.content[0].text).created[0]).toMatchObject({ id: 100, status: 'complete', stepsAdded: 1 })
    expect(tp.addTestStep).toHaveBeenCalledWith('100', { description: 'Login', result: 'Dashboard', runOrder: 1 })
  })

  it('keeps the case ID and failing step index on partial failure', async () => {
    const tp = client()
    tp.addTestStep.mockRejectedValue(new TpApiError('POST /TestSteps', 422, 'Result required'))
    tp.getTestCaseSteps.mockResolvedValue({ Items: [] })
    const result = await handleAddTestCases(tp as unknown as TpClient, '12', [input])
    const data = JSON.parse(result.content[0].text)
    expect(result.isError).toBe(true); expect(data.created).toEqual([])
    expect(data.partial[0]).toMatchObject({ id: 100, failedSteps: [{ index: 1, error: { httpStatus: 422 } }] })
    expect(tp.createTestCase).toHaveBeenCalledTimes(1)
  })

  it('reports an unverified membership as partial, not complete', async () => {
    const tp = client()
    tp.getTestCaseTestPlans.mockResolvedValue([])
    const result = await handleAddTestCases(tp as unknown as TpClient, '12', [input])
    expect(JSON.parse(result.content[0].text).partial[0].verificationError.message).toContain('membership')
  })

  it('stops the batch after an ambiguous creation timeout', async () => {
    const tp = client()
    tp.createTestCase.mockRejectedValue(new TpApiError('POST /TestCases', 0, 'Timed out; outcome unknown'))
    const result = await handleAddTestCases(tp as unknown as TpClient, '12', [input, { ...input, name: 'Next' }])
    expect(result.isError).toBe(true)
    expect(tp.createTestCase).toHaveBeenCalledTimes(1)
  })

  it('creates a title-only draft through the new single-case tool service', async () => {
    const tp = client()
    tp.getTestCaseSteps.mockResolvedValue({ Items: [] })
    const result = await new TestManagement(tp as unknown as TpClient).createCase({ name: 'Draft', description: '', projectId: '17', steps: [] })
    expect(result.status).toBe('complete')
    expect(tp.addTestStep).not.toHaveBeenCalled()
  })

  it('retries missing steps without duplicating an existing matching step', async () => {
    const tp = client()
    const management = new TestManagement(tp as unknown as TpClient)
    const result = await management.retrySteps('100', [{ index: 1, description: 'Login', result: 'Dashboard' }])
    expect(result.alreadyPresent).toBe(1)
    expect(tp.addTestStep).not.toHaveBeenCalled()
    expect(tp.createTestCase).not.toHaveBeenCalled()
  })
})
