import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleUnlinkChildTestPlanFromParent } from '../src/handlers/unlink_child_test_plan_from_parent.js'
import { handleMoveTestCasesBetweenSiblingPlans } from '../src/handlers/move_test_cases_between_sibling_plans.js'
import { TpClient } from '../src/tp.js'

const parentId = '356201'
const smokeId = '365519'
const siblingId = '365520'
const caseId = '365521'

const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'content-type': 'application/json' },
})

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllGlobals())

describe('test plan reorganization handlers', () => {
  it('returns the complete unlink preflight result', async () => {
    const result = { dryRun: true, parentTestPlanId: parentId, childTestPlanId: smokeId, canUnlink: true, unlinked: false }
    const tp = { unlinkChildTestPlanFromParent: vi.fn().mockResolvedValue(result) } as unknown as TpClient
    const response = await handleUnlinkChildTestPlanFromParent(tp, { parentTestPlanId: parentId, childTestPlanId: smokeId })
    expect(JSON.parse(response.content[0].text)).toEqual(result)
    expect(tp.unlinkChildTestPlanFromParent).toHaveBeenCalledWith({ parentTestPlanId: parentId, childTestPlanId: smokeId })
  })

  it('returns the complete sibling move result', async () => {
    const result = { dryRun: true, parentTestPlanId: parentId, sourceTestPlanId: smokeId, destinationTestPlanId: siblingId, canMove: true }
    const tp = { moveTestCasesBetweenSiblingPlans: vi.fn().mockResolvedValue(result) } as unknown as TpClient
    const response = await handleMoveTestCasesBetweenSiblingPlans(tp, {
      parentTestPlanId: parentId, sourceTestPlanId: smokeId, destinationTestPlanId: siblingId, testCaseIds: [caseId],
    })
    expect(JSON.parse(response.content[0].text)).toEqual(result)
  })
})

describe('TpClient.unlinkChildTestPlanFromParent', () => {
  function stubPlans(options: { linked?: boolean, failDelete?: boolean, ignoreDelete?: boolean, loseCase?: boolean } = {}) {
    let linked = options.linked ?? true
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const request = new URL(url)
      const path = request.pathname
      if (path.endsWith(`/testPlans/${parentId}/ChildTestPlans/`)) {
        expect(init?.method).toBe('DELETE')
        expect(request.searchParams.get('childrenIds')).toBe(smokeId)
        expect(request.searchParams.has('format')).toBe(false)
        if (options.failDelete) return new Response('Cannot unlink', { status: 403 })
        if (!options.ignoreDelete) linked = false
        return new Response(null, { status: 204 })
      }
      expect(init?.method).toBe('GET')
      if (path.endsWith(`/testPlans/${parentId}/`)) return jsonResponse({ Id: Number(parentId) })
      if (path.endsWith(`/testPlans/${smokeId}/`)) return jsonResponse({ Id: Number(smokeId) })
      if (path.endsWith('/testPlans/')) {
        expect(request.searchParams.get('where')).toBe(`ParentTestPlans.Id eq ${parentId}`)
        return jsonResponse({ Next: '', Items: linked ? [{ Id: Number(smokeId), Name: 'Smoke' }] : [] })
      }
      if (path.endsWith(`/testPlans/${smokeId}/testcases/`)) {
        return jsonResponse({ Next: '', Items: linked || !options.loseCase ? [{ Id: Number(caseId) }] : [] })
      }
      throw new Error(`Unexpected request: ${request}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('dry-runs a direct link without modifying either plan or its cases', async () => {
    const fetchMock = stubPlans()
    const result = await new TpClient().unlinkChildTestPlanFromParent({ parentTestPlanId: parentId, childTestPlanId: smokeId })
    expect(result).toMatchObject({ dryRun: true, canUnlink: true, unlinked: false, directTestCaseCountBefore: 1 })
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
  })

  it('deletes only the specified parent-child association and verifies the plans and cases remain', async () => {
    const fetchMock = stubPlans()
    const result = await new TpClient().unlinkChildTestPlanFromParent({
      parentTestPlanId: parentId, childTestPlanId: smokeId, dryRun: false,
    })
    expect(result).toMatchObject({ canUnlink: true, unlinked: true, missingDirectTestCaseIdsAfter: [] })
    const deletes = fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')
    expect(deletes).toHaveLength(1)
    expect(new URL(deletes[0][0]).pathname).toMatch(new RegExp(`/api/v1/testPlans/${parentId}/ChildTestPlans/$`))
  })

  it('does not mutate when the child is not directly under this parent', async () => {
    const fetchMock = stubPlans({ linked: false })
    const result = await new TpClient().unlinkChildTestPlanFromParent({
      parentTestPlanId: parentId, childTestPlanId: smokeId, dryRun: false,
    })
    expect(result).toMatchObject({ canUnlink: false, unlinked: false })
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
  })

  it('reports TP refusal without claiming that the plan was unlinked', async () => {
    stubPlans({ failDelete: true })
    const result = await new TpClient().unlinkChildTestPlanFromParent({
      parentTestPlanId: parentId, childTestPlanId: smokeId, dryRun: false,
    })
    expect(result).toMatchObject({ canUnlink: true, unlinked: false, httpStatus: 403, responseBody: 'Cannot unlink' })
  })

  it('does not claim success if direct test cases disappear after an acknowledged unlink', async () => {
    stubPlans({ loseCase: true })
    const result = await new TpClient().unlinkChildTestPlanFromParent({
      parentTestPlanId: parentId, childTestPlanId: smokeId, dryRun: false,
    })
    expect(result).toMatchObject({ unlinked: false, missingDirectTestCaseIdsAfter: [caseId] })
  })

  it('does not claim success if Targetprocess acknowledges deletion but retains the hierarchy link', async () => {
    stubPlans({ ignoreDelete: true })
    const result = await new TpClient().unlinkChildTestPlanFromParent({
      parentTestPlanId: parentId, childTestPlanId: smokeId, dryRun: false,
    })
    expect(result).toMatchObject({ canUnlink: true, unlinked: false })
    expect(result.reason).toContain('could not be verified')
  })
})

describe('TpClient.moveTestCasesBetweenSiblingPlans', () => {
  function stubSiblingPlans(options: {
    sameParent?: boolean
    alreadyAtDestination?: boolean
    failUnlink?: boolean
    failDestination?: boolean
    failRestore?: boolean
  } = {}) {
    const planLinks = new Set([smokeId, '399999', ...(options.alreadyAtDestination ? [siblingId] : [])])
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const request = new URL(url)
      const path = request.pathname
      if (path.endsWith(`/testPlans/${smokeId}/testCases/`)) {
        expect(init?.method).toBe('DELETE')
        expect(request.searchParams.get('childrenIds')).toBe(caseId)
        if (options.failUnlink) return new Response('Cannot unlink case', { status: 500 })
        planLinks.delete(smokeId)
        return jsonResponse({})
      }
      if (path.endsWith(`/testCases/${caseId}/`) && init?.method === 'POST') {
        const assignedId = JSON.parse(String(init.body)).TestPlans.Items[0].Id
        if (assignedId === siblingId && options.failDestination) return new Response('Cannot assign case', { status: 500 })
        if (assignedId === smokeId && options.failRestore) return new Response('Cannot restore case', { status: 500 })
        planLinks.add(assignedId)
        return jsonResponse({ Id: Number(caseId) })
      }
      expect(init?.method).toBe('GET')
      if (path.endsWith(`/testPlans/${parentId}/`)) return jsonResponse({ Id: Number(parentId) })
      if (path.endsWith('/testPlans/')) {
        expect(request.searchParams.get('where')).toBe(`ParentTestPlans.Id eq ${parentId}`)
        return jsonResponse({ Next: '', Items: options.sameParent === false
          ? [{ Id: Number(smokeId) }]
          : [{ Id: Number(smokeId) }, { Id: Number(siblingId) }] })
      }
      if (path.endsWith(`/testPlans/${smokeId}/testcases/`)) {
        return jsonResponse({ Next: '', Items: planLinks.has(smokeId) ? [{ Id: Number(caseId) }] : [] })
      }
      if (path.endsWith(`/testPlans/${siblingId}/testcases/`)) {
        return jsonResponse({ Next: '', Items: planLinks.has(siblingId) ? [{ Id: Number(caseId) }] : [] })
      }
      if (path.endsWith(`/testCases/${caseId}/`)) {
        return jsonResponse({ Id: Number(caseId), TestPlans: { Items: [...planLinks].map((id) => ({ Id: Number(id) })) } })
      }
      throw new Error(`Unexpected request: ${request}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    return { fetchMock, planLinks }
  }

  const params = { parentTestPlanId: parentId, sourceTestPlanId: smokeId, destinationTestPlanId: siblingId, testCaseIds: [caseId] }

  it('dry-runs only after checking direct sibling and case memberships', async () => {
    const { fetchMock, planLinks } = stubSiblingPlans()
    const result = await new TpClient().moveTestCasesBetweenSiblingPlans(params)
    expect(result).toMatchObject({ dryRun: true, canMove: true, movedTestCaseIds: [], alreadyInDestinationTestCaseIds: [] })
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
    expect(planLinks.has(smokeId)).toBe(true)
  })

  it('moves the same case ID into a direct sibling while keeping unrelated memberships', async () => {
    const { fetchMock, planLinks } = stubSiblingPlans()
    const result = await new TpClient().moveTestCasesBetweenSiblingPlans({ ...params, dryRun: false })
    expect(result).toMatchObject({ movedTestCaseIds: [caseId], unprocessedTestCaseIds: [], unverifiedMoveTestCaseIds: [] })
    expect([...planLinks].sort()).toEqual([siblingId, '399999'])
    const writes = fetchMock.mock.calls.filter(([, init]) => init?.method !== 'GET')
    expect(writes.map(([, init]) => init?.method)).toEqual(['DELETE', 'POST'])
    expect(new URL(writes[0][0]).pathname).toMatch(new RegExp(`/api/v1/testPlans/${smokeId}/testCases/$`))
    expect(new URL(writes[1][0]).pathname).toMatch(new RegExp(`/api/v1/testCases/${caseId}/$`))
  })

  it('refuses moves between plans without the specified shared direct parent', async () => {
    const { fetchMock } = stubSiblingPlans({ sameParent: false })
    const result = await new TpClient().moveTestCasesBetweenSiblingPlans({ ...params, dryRun: false })
    expect(result).toMatchObject({ canMove: false, movedTestCaseIds: [] })
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
  })

  it('refuses already-linked destination cases before making changes', async () => {
    const { fetchMock } = stubSiblingPlans({ alreadyAtDestination: true })
    const result = await new TpClient().moveTestCasesBetweenSiblingPlans({ ...params, dryRun: false })
    expect(result).toMatchObject({ canMove: false, alreadyInDestinationTestCaseIds: [caseId] })
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
  })

  it('does not assign the destination when removing the source link fails', async () => {
    const { fetchMock, planLinks } = stubSiblingPlans({ failUnlink: true })
    const result = await new TpClient().moveTestCasesBetweenSiblingPlans({ ...params, dryRun: false })
    expect(result).toMatchObject({ movedTestCaseIds: [], retainedInSourceTestCaseIds: [caseId] })
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
    expect(planLinks.has(smokeId)).toBe(true)
  })

  it('restores and verifies the source when destination assignment fails', async () => {
    const { planLinks } = stubSiblingPlans({ failDestination: true })
    const result = await new TpClient().moveTestCasesBetweenSiblingPlans({ ...params, dryRun: false })
    expect(result).toMatchObject({
      movedTestCaseIds: [], failedToAssign: [{ id: caseId, reason: `Could not assign to test plan ${siblingId}.` }],
      restoredToSourceTestCaseIds: [caseId], unassignedWithoutDestinationTestCaseIds: [],
    })
    expect([...planLinks].sort()).toEqual([smokeId, '399999'])
  })

  it('reports failed restoration instead of claiming that the case is safe', async () => {
    stubSiblingPlans({ failDestination: true, failRestore: true })
    const result = await new TpClient().moveTestCasesBetweenSiblingPlans({ ...params, dryRun: false })
    expect(result).toMatchObject({ movedTestCaseIds: [], unassignedWithoutDestinationTestCaseIds: [caseId] })
  })

  it('stops after a failed case and reports cases not yet attempted', async () => {
    const secondCaseId = '365522'
    const thirdCaseId = '365523'
    const source = new Set([caseId, secondCaseId, thirdCaseId])
    const destination = new Set<string>()
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const request = new URL(url)
      const path = request.pathname
      const testCaseId = path.match(/\/testCases\/(\d+)\/$/)?.[1]
      if (path.endsWith(`/testPlans/${smokeId}/testCases/`)) {
        source.delete(request.searchParams.get('childrenIds')!)
        return jsonResponse({})
      }
      if (testCaseId && init?.method === 'POST') {
        const assignedId = JSON.parse(String(init.body)).TestPlans.Items[0].Id
        if (testCaseId === secondCaseId && assignedId === siblingId) return new Response('Failed', { status: 500 })
        if (assignedId === siblingId) destination.add(testCaseId)
        if (assignedId === smokeId) source.add(testCaseId)
        return jsonResponse({ Id: Number(testCaseId) })
      }
      if (path.endsWith(`/testPlans/${parentId}/`)) return jsonResponse({ Id: Number(parentId) })
      if (path.endsWith('/testPlans/')) return jsonResponse({ Next: '', Items: [{ Id: Number(smokeId) }, { Id: Number(siblingId) }] })
      if (path.endsWith(`/testPlans/${smokeId}/testcases/`)) {
        return jsonResponse({ Next: '', Items: [...source].map((id) => ({ Id: Number(id) })) })
      }
      if (path.endsWith(`/testPlans/${siblingId}/testcases/`)) {
        return jsonResponse({ Next: '', Items: [...destination].map((id) => ({ Id: Number(id) })) })
      }
      if (testCaseId && init?.method === 'GET') {
        return jsonResponse({ TestPlans: { Items: [
          ...(source.has(testCaseId) ? [{ Id: Number(smokeId) }] : []),
          ...(destination.has(testCaseId) ? [{ Id: Number(siblingId) }] : []),
        ] } })
      }
      throw new Error(`Unexpected request: ${request}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await new TpClient().moveTestCasesBetweenSiblingPlans({
      ...params, testCaseIds: [caseId, secondCaseId, thirdCaseId], dryRun: false,
    })
    expect(result).toMatchObject({
      movedTestCaseIds: [caseId], restoredToSourceTestCaseIds: [secondCaseId],
      unprocessedTestCaseIds: [thirdCaseId],
    })
    expect(source.has(secondCaseId) && source.has(thirdCaseId)).toBe(true)
    expect(destination.has(caseId)).toBe(true)
    const sourceListReads = fetchMock.mock.calls.filter(([url, init]) =>
      init?.method === 'GET' && new URL(url).pathname.endsWith(`/testPlans/${smokeId}/testcases/`))
    expect(sourceListReads).toHaveLength(1)
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes(`/testCases/${thirdCaseId}/`))).toBe(false)
  })
})
