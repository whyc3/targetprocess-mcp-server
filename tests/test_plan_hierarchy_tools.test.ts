import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleCreateNestedTestPlan } from '../src/handlers/create_nested_test_plan.js'
import { handleMoveTestCasesToSubPlan } from '../src/handlers/move_test_cases_to_sub_plan.js'
import { TpClient } from '../src/tp.js'
import type { TpClient as TpClientType } from '../src/tp.js'

const mockTp = {
  createNestedTestPlan: vi.fn(),
  moveTestCasesToSubPlan: vi.fn(),
} as unknown as TpClientType

const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'content-type': 'application/json' },
})

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('nested test plan handlers', () => {
  it('creates a nested test plan beneath the requested parent', async () => {
    vi.mocked(mockTp.createNestedTestPlan).mockResolvedValue({ Id: 356202, Name: 'Payments' } as any)

    const result = await handleCreateNestedTestPlan(mockTp, {
      title: 'Payments',
      parentTestPlanId: '356201',
      description: 'Payment flows',
    })

    expect(JSON.parse(result.content[0].text)).toEqual({ Id: 356202, Name: 'Payments' })
    expect(mockTp.createNestedTestPlan).toHaveBeenCalledWith({
      title: 'Payments',
      parentTestPlanId: '356201',
      description: 'Payment flows',
    })
  })

  it('returns the complete move preflight or execution result', async () => {
    const moveResult = {
      dryRun: true,
      sourceTestPlanId: '356201',
      destinationTestPlanId: '356202',
      requestedTestCaseIds: ['356203'],
      eligibleTestCaseIds: ['356203'],
      missingFromSourceTestCaseIds: [],
      canMove: true,
      movedTestCaseIds: [],
      failedToAssign: [],
      retainedInSourceTestCaseIds: [],
    }
    vi.mocked(mockTp.moveTestCasesToSubPlan).mockResolvedValue(moveResult)

    const result = await handleMoveTestCasesToSubPlan(mockTp, {
      sourceTestPlanId: '356201',
      destinationTestPlanId: '356202',
      testCaseIds: ['356203'],
      dryRun: true,
    })

    expect(JSON.parse(result.content[0].text)).toEqual(moveResult)
  })
})

describe('TpClient test plan hierarchy operations', () => {
  it('creates a child plan in the parent plan project', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const decodedUrl = decodeURIComponent(url)
      if (decodedUrl.includes('/testPlans/356201/')) {
        return jsonResponse({ Id: 356201, Project: { Id: 123 } })
      }
      if (decodedUrl.includes('/testPlans/?')) {
        expect(init?.method).toBe('POST')
        expect(init?.body).toBe(JSON.stringify({
          Name: 'Payments',
          Project: { Id: 123 },
          ParentTestPlans: [{ Id: '356201' }],
          Description: 'Payment flows',
        }))
        return jsonResponse({ Id: 356202, Name: 'Payments' })
      }
      throw new Error(`Unexpected URL: ${decodedUrl}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const tp = new TpClient()
    const created = await tp.createNestedTestPlan({
      title: 'Payments',
      parentTestPlanId: '356201',
      description: 'Payment flows',
    })

    expect(created).toEqual({ Id: 356202, Name: 'Payments' })
  })

  it('dry-runs only after validating direct membership and nested destination', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const decodedUrl = decodeURIComponent(url)
      expect(init?.method).toBe('GET')
      if (decodedUrl.includes('/testPlans/356201/testcases/')) {
        return jsonResponse({ Next: '', Items: [{ Id: 356203, Name: 'Card checkout' }] })
      }
      if (decodedUrl.includes('/testPlans/?') && decodedUrl.includes('ParentTestPlans.Id eq 356201')) {
        return jsonResponse({ Next: '', Items: [{ Id: 356202, Name: 'Payments' }] })
      }
      throw new Error(`Unexpected URL: ${decodedUrl}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const tp = new TpClient()
    const result = await tp.moveTestCasesToSubPlan({
      sourceTestPlanId: '356201',
      destinationTestPlanId: '356202',
      testCaseIds: ['356203'],
    })

    expect(result).toMatchObject({
      dryRun: true,
      canMove: true,
      eligibleTestCaseIds: ['356203'],
      movedTestCaseIds: [],
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('assigns the destination before removing only the source-plan link', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const decodedUrl = decodeURIComponent(url)
      if (decodedUrl.includes('/testPlans/356201/testcases/')) {
        return jsonResponse({ Next: '', Items: [{ Id: 356203, Name: 'Card checkout' }] })
      }
      if (decodedUrl.includes('/testPlans/?') && decodedUrl.includes('ParentTestPlans.Id eq 356201')) {
        return jsonResponse({ Next: '', Items: [{ Id: 356202, Name: 'Payments' }] })
      }
      if (decodedUrl.includes('/testCases/356203/')) {
        expect(init?.method).toBe('POST')
        expect(init?.body).toBe(JSON.stringify({ TestPlans: { Items: [{ Id: '356202' }] } }))
        return jsonResponse({ Id: 356203 })
      }
      if (decodedUrl.includes('/testPlans/356201/testCases/')) {
        expect(init?.method).toBe('DELETE')
        expect(decodedUrl).toContain('childrenIds=356203')
        return jsonResponse({})
      }
      throw new Error(`Unexpected URL: ${decodedUrl}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const tp = new TpClient()
    const result = await tp.moveTestCasesToSubPlan({
      sourceTestPlanId: '356201',
      destinationTestPlanId: '356202',
      testCaseIds: ['356203'],
      dryRun: false,
    })

    expect(result).toMatchObject({
      dryRun: false,
      canMove: true,
      movedTestCaseIds: ['356203'],
      retainedInSourceTestCaseIds: [],
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('does not mutate when a requested test case is not directly in the source plan', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const decodedUrl = decodeURIComponent(url)
      if (decodedUrl.includes('/testPlans/356201/testcases/')) {
        return jsonResponse({ Next: '', Items: [{ Id: 356203, Name: 'Card checkout' }] })
      }
      throw new Error(`Unexpected URL: ${decodedUrl}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const tp = new TpClient()
    const result = await tp.moveTestCasesToSubPlan({
      sourceTestPlanId: '356201',
      destinationTestPlanId: '356202',
      testCaseIds: ['356204'],
      dryRun: false,
    })

    expect(result).toMatchObject({
      canMove: false,
      missingFromSourceTestCaseIds: ['356204'],
      movedTestCaseIds: [],
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps both plan links when the source unlink fails', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const decodedUrl = decodeURIComponent(url)
      if (decodedUrl.includes('/testPlans/356201/testcases/')) {
        return jsonResponse({ Next: '', Items: [{ Id: 356203, Name: 'Card checkout' }] })
      }
      if (decodedUrl.includes('/testPlans/?') && decodedUrl.includes('ParentTestPlans.Id eq 356201')) {
        return jsonResponse({ Next: '', Items: [{ Id: 356202, Name: 'Payments' }] })
      }
      if (decodedUrl.includes('/testCases/356203/')) {
        return jsonResponse({ Id: 356203 })
      }
      if (decodedUrl.includes('/testPlans/356201/testCases/')) {
        return new Response('Source link could not be removed', { status: 500 })
      }
      throw new Error(`Unexpected URL: ${decodedUrl}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const tp = new TpClient()
    const result = await tp.moveTestCasesToSubPlan({
      sourceTestPlanId: '356201',
      destinationTestPlanId: '356202',
      testCaseIds: ['356203'],
      dryRun: false,
    })

    expect(result).toMatchObject({
      movedTestCaseIds: [],
      retainedInSourceTestCaseIds: ['356203'],
    })
    expect(result.reason).toContain('no test cases were deleted')
  })
})
