import { afterEach, describe, expect, it, vi } from 'vitest'
import { TpClient } from '../src/tp.js'

afterEach(() => vi.unstubAllGlobals())
function graph(options: { assignmentFails?: boolean; siblings?: boolean } = {}) {
  const children = new Set(options.siblings === false ? ['11'] : ['11', '12'])
  const plans = new Map([['1', new Set(['11'])]])
  const writes: Array<{ method: string; path: string; body?: any }> = []
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'https://example.test')
    const path = url.pathname.toLowerCase()
    const method = init?.method || 'GET'
    const json = (value: unknown) => new Response(JSON.stringify(value))
    if (method !== 'GET') writes.push({ method, path, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) })
    if (path === '/api/v1/testplans/') return json({ Items: [...children].map(Id => ({ Id: Number(Id), Name: 'Child' })) })
    const plan = path.match(/^\/api\/v1\/testplans\/(\d+)\/$/)
    if (plan && method === 'GET') return json({ Id: Number(plan[1]), Name: 'Plan', Project: { Id: 17 } })
    const cases = path.match(/^\/api\/v1\/testplans\/(\d+)\/testcases\/$/)
    if (cases && method === 'GET') return json({ Items: [...plans].filter(([, ids]) => ids.has(cases[1])).map(([Id]) => ({ Id: Number(Id), Name: 'Case' })) })
    if (cases && method === 'DELETE') { plans.get(url.searchParams.get('childrenIds')!)!.delete(cases[1]); return json({}) }
    const childLink = path.match(/^\/api\/v1\/testplans\/(\d+)\/childtestplans\/$/)
    if (childLink && method === 'DELETE') { children.delete(url.searchParams.get('childrenIds')!); return json({}) }
    const single = path.match(/^\/api\/v1\/testcases\/(\d+)\/$/)
    if (single && method === 'GET') return json({ Id: Number(single[1]), TestPlans: { Items: [...plans.get(single[1])!].map(Id => ({ Id: Number(Id) })) } })
    if (single && method === 'POST') {
      const body = JSON.parse(String(init?.body))
      const destination = String(body.TestPlans.Items[0].Id)
      if (destination === '12' && options.assignmentFails) return new Response('Destination denied', { status: 403 })
      plans.get(single[1])!.add(destination)
      return json({ Id: Number(single[1]) })
    }
    throw new Error('Unexpected request ' + method + ' ' + path)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { client: new TpClient(), plans, children, writes }
}

describe('connected 2.6.10 hierarchy capabilities', () => {
  it('previews sibling moves without any writes', async () => {
    const f = graph()
    const result = await f.client.moveTestCasesBetweenSiblingPlans({ parentTestPlanId: '10', sourceTestPlanId: '11', destinationTestPlanId: '12', testCaseIds: ['1'] })
    expect(result.canMove).toBe(true)
    expect(result.dryRun).toBe(true)
    expect(f.writes).toEqual([])
  })

  it('rejects a destination that is not a direct sibling before unlinking', async () => {
    const f = graph({ siblings: false })
    const result = await f.client.moveTestCasesBetweenSiblingPlans({ parentTestPlanId: '10', sourceTestPlanId: '11', destinationTestPlanId: '12', testCaseIds: ['1'], dryRun: false })
    expect(result.canMove).toBe(false)
    expect(f.writes).toEqual([])
    expect(f.plans.get('1')!.has('11')).toBe(true)
  })

  it('restores and verifies the source after a destination assignment failure', async () => {
    const f = graph({ assignmentFails: true })
    const result = await f.client.moveTestCasesBetweenSiblingPlans({ parentTestPlanId: '10', sourceTestPlanId: '11', destinationTestPlanId: '12', testCaseIds: ['1'], dryRun: false })
    expect(result.movedTestCaseIds).toEqual([])
    expect(result.restoredToSourceTestCaseIds).toEqual(['1'])
    expect([...f.plans.get('1')!]).toEqual(['11'])
    expect(f.writes.map(write => write.method)).toEqual(['DELETE', 'POST', 'POST'])
    expect(f.writes.some(write => write.path === '/api/v1/testcases/1/' && write.method === 'DELETE')).toBe(false)
  })

  it('unlinks only the child-plan association while preserving both plans and cases', async () => {
    const f = graph()
    const result = await f.client.unlinkChildTestPlanFromParent({ parentTestPlanId: '10', childTestPlanId: '11', dryRun: false })
    expect(result.unlinked).toBe(true)
    expect(result.missingDirectTestCaseIdsAfter).toEqual([])
    expect(f.children.has('11')).toBe(false)
    expect([...f.plans.get('1')!]).toEqual(['11'])
    expect(f.writes).toEqual([{ method: 'DELETE', path: '/api/v1/testplans/10/childtestplans/' }])
  })
})
