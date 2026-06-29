import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TpClient } from '../src/tp.js'
import { handleGetTestPlanById } from '../src/handlers/get_test_plan_by_id.js'
import { handleGetTestPlanTestCasesById } from '../src/handlers/get_test_plan_test_cases_by_id.js'
import { handleGetTestPlanTestCasesWithStepsById } from '../src/handlers/get_test_plan_test_cases_with_steps_by_id.js'
import { handleGetTestCaseById } from '../src/handlers/get_test_case_by_id.js'
import { handleUpdateTestCaseById } from '../src/handlers/update_test_case_by_id.js'
import { handleDeleteTestCaseById } from '../src/handlers/delete_test_case_by_id.js'
import { handleAddTestCaseStepById } from '../src/handlers/add_test_case_step_by_id.js'
import { handleUpdateTestCaseStepById } from '../src/handlers/update_test_case_step_by_id.js'
import { handleDeleteTestCaseStepById } from '../src/handlers/delete_test_case_step_by_id.js'

const mockTp = {
  getTestPlan: vi.fn(),
  getTestPlanTestCases: vi.fn(),
  getTestCase: vi.fn(),
  getTestCaseSteps: vi.fn(),
  updateTestCase: vi.fn(),
  deleteTestCase: vi.fn(),
  addTestStep: vi.fn(),
  getTestStep: vi.fn(),
  updateTestStep: vi.fn(),
  deleteTestStep: vi.fn(),
} as unknown as TpClient

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('handleGetTestPlanById', () => {
  it('returns normalized test plan data', async () => {
    vi.mocked(mockTp.getTestPlan).mockResolvedValue({
      Id: 145789,
      Name: 'Regression test plan',
      Description: '<p>Coverage for login</p>',
      EntityState: { Name: 'Open' },
      Project: { Name: 'Payments' },
      LinkedUserStory: { Name: 'User can sign in' },
      LinkedAssignable: { Name: 'Authentication' },
      CreateDate: '2026-01-01T00:00:00Z',
      ModifyDate: '2026-01-02T00:00:00Z',
    } as any)

    const result = await handleGetTestPlanById(mockTp, '145789')
    const parsed = JSON.parse(result.content[0].text)

    expect(parsed).toEqual({
      id: 145789,
      name: 'Regression test plan',
      description: 'Coverage for login',
      entityState: 'Open',
      project: 'Payments',
      linkedUserStory: 'User can sign in',
      linkedAssignable: 'Authentication',
      createDate: '2026-01-01T00:00:00Z',
      modifyDate: '2026-01-02T00:00:00Z',
    })
  })

  it('returns failure message when test plan is not found', async () => {
    vi.mocked(mockTp.getTestPlan).mockResolvedValue(null as any)

    const result = await handleGetTestPlanById(mockTp, '145789')

    expect(result.content[0].text).toContain('Failed to get test plan id: 145789')
  })

  it('calls getTestPlan with the provided id', async () => {
    vi.mocked(mockTp.getTestPlan).mockResolvedValue({ Id: 1, Name: 'Plan' } as any)

    await handleGetTestPlanById(mockTp, '145789')

    expect(mockTp.getTestPlan).toHaveBeenCalledWith('145789')
  })
})

describe('handleGetTestPlanTestCasesById', () => {
  it('returns normalized test cases without steps', async () => {
    vi.mocked(mockTp.getTestPlanTestCases).mockResolvedValue({
      Items: [
        { Id: 1, Name: 'Happy path', Description: '<div>Can complete checkout</div>', TestPlanId: 145789, TestPlanName: 'Root plan' },
        { Id: 2, Name: 'Validation', Description: '<p>Shows required field errors</p>', TestPlanId: 145790, TestPlanName: 'Child plan' },
      ],
    } as any)

    const result = await handleGetTestPlanTestCasesById(mockTp, '145789')
    const parsed = JSON.parse(result.content[0].text)

    expect(parsed).toEqual([
      { id: 1, name: 'Happy path', description: 'Can complete checkout', testPlanId: 145789, testPlanName: 'Root plan' },
      { id: 2, name: 'Validation', description: 'Shows required field errors', testPlanId: 145790, testPlanName: 'Child plan' },
    ])
  })

  it('returns failure message when test cases response is missing', async () => {
    vi.mocked(mockTp.getTestPlanTestCases).mockResolvedValue(null as any)

    const result = await handleGetTestPlanTestCasesById(mockTp, '145789')

    expect(result.content[0].text).toContain('Failed to get test cases for test plan id: 145789')
  })

  it('returns empty-list message when there are no test cases', async () => {
    vi.mocked(mockTp.getTestPlanTestCases).mockResolvedValue({ Items: [] } as any)

    const result = await handleGetTestPlanTestCasesById(mockTp, '145789')

    expect(result.content[0].text).toContain('No test cases found for test plan id: 145789')
  })

  it('calls getTestPlanTestCases with the provided id', async () => {
    vi.mocked(mockTp.getTestPlanTestCases).mockResolvedValue({ Items: [] } as any)

    await handleGetTestPlanTestCasesById(mockTp, '145789')

    expect(mockTp.getTestPlanTestCases).toHaveBeenCalledWith('145789')
  })
})

describe('handleGetTestPlanTestCasesWithStepsById', () => {
  it('returns normalized nested test cases with steps and containing test plan data', async () => {
    vi.mocked(mockTp.getTestPlanTestCases).mockResolvedValue({
      Items: [
        { Id: 304953, Name: 'Nested case', Description: '<div>Nested preconditions</div>', TestPlanId: 304449, TestPlanName: 'Child plan' },
      ],
    } as any)
    vi.mocked(mockTp.getTestCaseSteps).mockResolvedValue({
      Items: [
        { Description: 'Login', Result: 'User is logged in', RunOrder: 1 },
      ],
    } as any)

    const result = await handleGetTestPlanTestCasesWithStepsById(mockTp, '304077')
    const parsed = JSON.parse(result.content[0].text)

    expect(parsed).toEqual([
      {
        testCaseId: 304953,
        testCaseName: 'Nested case',
        testCaseDescription: 'Nested preconditions',
        testPlanId: 304449,
        testPlanName: 'Child plan',
        testCaseSteps: [
          { description: 'Login', result: 'User is logged in', runOrder: 1 },
        ],
      },
    ])
  })
})

describe('handleGetTestCaseById', () => {
  it('returns normalized test case data with steps', async () => {
    vi.mocked(mockTp.getTestCase).mockResolvedValue({
      Id: 987654,
      Name: 'Checkout succeeds',
      Description: '<p>Preconditions: cart has items</p>',
      TestPlans: { Items: [{ ResourceType: 'TestPlan', Id: 111, Name: 'Checkout plan' }] },
    } as any)
    vi.mocked(mockTp.getTestCaseSteps).mockResolvedValue({
      Items: [
        { Description: 'Open cart', Result: 'Cart opens', RunOrder: 1 },
        { Description: 'Submit payment', Result: 'Order is created', RunOrder: 2 },
      ],
    } as any)

    const result = await handleGetTestCaseById(mockTp, '987654')
    const parsed = JSON.parse(result.content[0].text)

    expect(parsed).toEqual({
      id: 987654,
      name: 'Checkout succeeds',
      description: 'Preconditions: cart has items',
      testPlan: 'Checkout plan',
      steps: [
        { description: 'Open cart', result: 'Cart opens', runOrder: 1 },
        { description: 'Submit payment', result: 'Order is created', runOrder: 2 },
      ],
    })
  })

  it('returns failure message when test case is not found', async () => {
    vi.mocked(mockTp.getTestCase).mockResolvedValue(null as any)

    const result = await handleGetTestCaseById(mockTp, '987654')

    expect(result.content[0].text).toContain('Failed to get test case id: 987654')
    expect(mockTp.getTestCaseSteps).not.toHaveBeenCalled()
  })

  it('calls getTestCase and getTestCaseSteps with the expected ids', async () => {
    vi.mocked(mockTp.getTestCase).mockResolvedValue({
      Id: 987654,
      Name: 'Checkout succeeds',
      Description: '',
    } as any)
    vi.mocked(mockTp.getTestCaseSteps).mockResolvedValue({ Items: [] } as any)

    await handleGetTestCaseById(mockTp, '123456')

    expect(mockTp.getTestCase).toHaveBeenCalledWith('123456')
    expect(mockTp.getTestCaseSteps).toHaveBeenCalledWith('987654')
  })
})

describe('handleUpdateTestCaseById', () => {
  it('updates test case metadata', async () => {
    vi.mocked(mockTp.updateTestCase).mockResolvedValue({ Id: 987654, Name: 'Updated case' } as any)

    const result = await handleUpdateTestCaseById(mockTp, {
      id: '987654',
      name: 'Updated case',
      description: '<p>Updated description</p>',
    })
    const parsed = JSON.parse(result.content[0].text)

    expect(parsed.Id).toBe(987654)
    expect(mockTp.updateTestCase).toHaveBeenCalledWith({
      id: '987654',
      name: 'Updated case',
      description: '<p>Updated description</p>',
    })
  })

  it('returns no-op message when no fields were provided', async () => {
    const result = await handleUpdateTestCaseById(mockTp, { id: '987654' })

    expect(result.content[0].text).toContain('Nothing to update for test case id: 987654')
    expect(mockTp.updateTestCase).not.toHaveBeenCalled()
  })

  it('returns failure message when update fails', async () => {
    vi.mocked(mockTp.updateTestCase).mockResolvedValue(null as any)

    const result = await handleUpdateTestCaseById(mockTp, { id: '987654', name: 'Updated case' })

    expect(result.content[0].text).toContain('Failed to update test case id: 987654')
  })
})

describe('handleDeleteTestCaseById', () => {
  it('returns deleted confirmation on success', async () => {
    vi.mocked(mockTp.deleteTestCase).mockResolvedValue({
      ok: true,
      data: { Id: 987654 },
    } as any)

    const result = await handleDeleteTestCaseById(mockTp, '987654')
    const parsed = JSON.parse(result.content[0].text)

    expect(parsed.deleted).toBe(true)
    expect(parsed.testCaseId).toBe(987654)
    expect(mockTp.deleteTestCase).toHaveBeenCalledWith('987654')
  })

  it('surfaces HTTP status and response body on failure', async () => {
    vi.mocked(mockTp.deleteTestCase).mockResolvedValue({
      ok: false,
      status: 404,
      body: '{"Status":"NotFound","Message":"TestCase 987654 not found"}',
    } as any)

    const result = await handleDeleteTestCaseById(mockTp, '987654')

    expect(result.content[0].text).toContain('Failed to delete test case id: 987654')
    expect(result.content[0].text).toContain('HTTP status: 404')
    expect(result.content[0].text).toContain('TestCase 987654 not found')
  })
})

describe('handleAddTestCaseStepById', () => {
  it('adds a step to a test case', async () => {
    vi.mocked(mockTp.addTestStep).mockResolvedValue({ Id: 4321, Description: 'Click save', Result: 'Changes persist' } as any)

    const result = await handleAddTestCaseStepById(mockTp, {
      testCaseId: '987654',
      description: 'Click save',
      result: 'Changes persist',
    })
    const parsed = JSON.parse(result.content[0].text)

    expect(parsed.Id).toBe(4321)
    expect(mockTp.addTestStep).toHaveBeenCalledWith('987654', {
      description: 'Click save',
      result: 'Changes persist',
    })
  })

  it('returns failure message when add step fails', async () => {
    vi.mocked(mockTp.addTestStep).mockResolvedValue(null as any)

    const result = await handleAddTestCaseStepById(mockTp, {
      testCaseId: '987654',
      description: 'Click save',
      result: 'Changes persist',
    })

    expect(result.content[0].text).toContain('Failed to add test step to test case id: 987654')
  })
})

describe('handleUpdateTestCaseStepById', () => {
  it('merges missing fields from existing step before update', async () => {
    vi.mocked(mockTp.getTestStep).mockResolvedValue({
      Id: 4321,
      Description: 'Current action',
      Result: 'Current result',
    } as any)
    vi.mocked(mockTp.updateTestStep).mockResolvedValue({ Id: 4321, Description: 'Updated action', Result: 'Current result' } as any)

    const result = await handleUpdateTestCaseStepById(mockTp, {
      id: '4321',
      description: 'Updated action',
    })
    const parsed = JSON.parse(result.content[0].text)

    expect(parsed.Id).toBe(4321)
    expect(mockTp.getTestStep).toHaveBeenCalledWith('4321')
    expect(mockTp.updateTestStep).toHaveBeenCalledWith({
      id: '4321',
      description: 'Updated action',
      result: 'Current result',
    })
  })

  it('returns no-op message when no fields were provided', async () => {
    const result = await handleUpdateTestCaseStepById(mockTp, { id: '4321' })

    expect(result.content[0].text).toContain('Nothing to update for test step id: 4321')
    expect(mockTp.getTestStep).not.toHaveBeenCalled()
  })

  it('returns failure message when existing step cannot be loaded', async () => {
    vi.mocked(mockTp.getTestStep).mockResolvedValue(null as any)

    const result = await handleUpdateTestCaseStepById(mockTp, { id: '4321', result: 'Updated result' })

    expect(result.content[0].text).toContain('Failed to get test step id: 4321')
    expect(mockTp.updateTestStep).not.toHaveBeenCalled()
  })

  it('returns failure message when update fails', async () => {
    vi.mocked(mockTp.getTestStep).mockResolvedValue({
      Id: 4321,
      Description: 'Current action',
      Result: 'Current result',
    } as any)
    vi.mocked(mockTp.updateTestStep).mockResolvedValue(null as any)

    const result = await handleUpdateTestCaseStepById(mockTp, { id: '4321', result: 'Updated result' })

    expect(result.content[0].text).toContain('Failed to update test step id: 4321')
  })
})

describe('handleDeleteTestCaseStepById', () => {
  it('returns deleted confirmation on success', async () => {
    vi.mocked(mockTp.deleteTestStep).mockResolvedValue({
      ok: true,
      data: { Id: 4321 },
    } as any)

    const result = await handleDeleteTestCaseStepById(mockTp, '4321')
    const parsed = JSON.parse(result.content[0].text)

    expect(parsed.deleted).toBe(true)
    expect(parsed.testStepId).toBe(4321)
    expect(mockTp.deleteTestStep).toHaveBeenCalledWith('4321')
  })

  it('surfaces HTTP status and response body on failure', async () => {
    vi.mocked(mockTp.deleteTestStep).mockResolvedValue({
      ok: false,
      status: 404,
      body: '{"Status":"NotFound","Message":"TestStep 4321 not found"}',
    } as any)

    const result = await handleDeleteTestCaseStepById(mockTp, '4321')

    expect(result.content[0].text).toContain('Failed to delete test step id: 4321')
    expect(result.content[0].text).toContain('HTTP status: 404')
    expect(result.content[0].text).toContain('TestStep 4321 not found')
  })
})

describe('TpClient.getTestPlanTestCases', () => {
  const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

  it('returns test cases from nested child test plans', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const decodedUrl = decodeURIComponent(url)

      if (decodedUrl.includes('/testPlans/304077/testcases/')) {
        return jsonResponse({ Next: '', Items: [] })
      }

      if (decodedUrl.includes('/testPlans/304449/testcases/')) {
        return jsonResponse({
          Next: '',
          Items: [{ Id: 304953, Name: 'Nested case', Description: '<p>Nested</p>' }],
        })
      }

      if (decodedUrl.includes('/testPlans/304950/testcases/')) {
        return jsonResponse({
          Next: '',
          Items: [{ Id: 304954, Name: 'Grandchild case', Description: '<p>Grandchild</p>' }],
        })
      }

      if (decodedUrl.includes('/testPlans/?') && decodedUrl.includes('ParentTestPlans.Id eq 304077')) {
        return jsonResponse({ Next: '', Items: [{ Id: 304449, Name: 'Child plan' }] })
      }

      if (decodedUrl.includes('/testPlans/?') && decodedUrl.includes('ParentTestPlans.Id eq 304449')) {
        return jsonResponse({ Next: '', Items: [{ Id: 304950, Name: 'Grandchild plan' }] })
      }

      if (decodedUrl.includes('/testPlans/?') && decodedUrl.includes('ParentTestPlans.Id eq 304950')) {
        return jsonResponse({ Next: '', Items: [] })
      }

      if (decodedUrl.includes('/testPlans/304077/')) {
        return jsonResponse({ Id: 304077, Name: 'Root plan' })
      }

      throw new Error(`Unexpected URL: ${decodedUrl}`)
    }))

    const tp = new TpClient()
    const response = await tp.getTestPlanTestCases<{ Items: Array<{ Id: number, TestPlanId?: number, TestPlanName?: string }> }>('304077')

    expect(response.Items).toEqual([
      { Id: 304953, Name: 'Nested case', Description: '<p>Nested</p>', TestPlanId: 304449, TestPlanName: 'Child plan' },
      { Id: 304954, Name: 'Grandchild case', Description: '<p>Grandchild</p>', TestPlanId: 304950, TestPlanName: 'Grandchild plan' },
    ])
  })

  it('deduplicates test cases and does not loop on repeated child plans', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const decodedUrl = decodeURIComponent(url)

      if (decodedUrl.includes('/testPlans/304077/testcases/')) {
        return jsonResponse({
          Next: '',
          Items: [{ Id: 304953, Name: 'Root copy', Description: '' }],
        })
      }

      if (decodedUrl.includes('/testPlans/304449/testcases/')) {
        return jsonResponse({
          Next: '',
          Items: [{ Id: 304953, Name: 'Child copy', Description: '' }],
        })
      }

      if (decodedUrl.includes('/testPlans/?') && decodedUrl.includes('ParentTestPlans.Id eq 304077')) {
        return jsonResponse({ Next: '', Items: [{ Id: 304449, Name: 'Child plan' }] })
      }

      if (decodedUrl.includes('/testPlans/?') && decodedUrl.includes('ParentTestPlans.Id eq 304449')) {
        return jsonResponse({ Next: '', Items: [{ Id: 304077, Name: 'Root plan' }] })
      }

      if (decodedUrl.includes('/testPlans/304077/')) {
        return jsonResponse({ Id: 304077, Name: 'Root plan' })
      }

      throw new Error(`Unexpected URL: ${decodedUrl}`)
    }))

    const tp = new TpClient()
    const response = await tp.getTestPlanTestCases<{ Items: Array<{ Id: number, Name: string }> }>('304077')

    expect(response.Items).toEqual([
      { Id: 304953, Name: 'Root copy', Description: '', TestPlanId: 304077, TestPlanName: 'Root plan' },
    ])
  })
})

describe('TpClient test case and test step mutation helpers', () => {
  it('uses the expected HTTP method and body for updateTestCase', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({ Id: 987654 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const tp = new TpClient()
    await tp.updateTestCase({ id: '987654', name: 'Updated case', description: '<p>Updated description</p>' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(decodeURIComponent(url)).toContain('/testCases/?format=json&access_token=')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify({ Id: '987654', Name: 'Updated case', Description: '<p>Updated description</p>' }))
  })

  it('uses the expected HTTP method and path for deleteTestCase', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({ Id: 987654 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const tp = new TpClient()
    await tp.deleteTestCase('987654')

    const [url, init] = fetchMock.mock.calls[0]
    expect(decodeURIComponent(url)).toContain('/testCases/987654/?format=json&access_token=')
    expect(init?.method).toBe('DELETE')
  })

  it('uses the expected HTTP method and body for updateTestStep', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({ Id: 4321 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const tp = new TpClient()
    await tp.updateTestStep({ id: '4321', description: 'Updated action', result: 'Updated result' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(decodeURIComponent(url)).toContain('/testSteps/?format=json&access_token=')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify({ Id: '4321', Description: 'Updated action', Result: 'Updated result' }))
  })

  it('loads a single step from the testSteps endpoint', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({ Id: 4321 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const tp = new TpClient()
    await tp.getTestStep('4321')

    const [url, init] = fetchMock.mock.calls[0]
    expect(decodeURIComponent(url)).toContain('/testSteps/4321/?format=json&access_token=')
    expect(init?.method).toBe('GET')
  })

  it('uses the expected HTTP method and path for deleteTestStep', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({ Id: 4321 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const tp = new TpClient()
    await tp.deleteTestStep('4321')

    const [url, init] = fetchMock.mock.calls[0]
    expect(decodeURIComponent(url)).toContain('/testSteps/4321/?format=json&access_token=')
    expect(init?.method).toBe('DELETE')
  })
})
