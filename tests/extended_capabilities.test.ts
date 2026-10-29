import { afterEach, describe, expect, it, vi } from 'vitest'
import { TpClient } from '../src/tp.js'
import { TpHttp, TpApiError } from '../src/http.js'
import { Insights, timestamp, type HistoryOptions } from '../src/insights.js'
import { equivalentMarkup } from '../src/capability_helpers.js'
import { TestManagement } from '../src/test_management.js'

const metadata = (...names: string[]) => ({ Properties: names.map(Name => ({ Name, Type: 'String', CanGet: true, CanSet: true })) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('complete directory pagination', () => {
  it('follows the exact server Next link including its page size/cursor', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ Items: [{ Id: 1 }], Next: '/api/v1/Users?skip=25&take=25&cursor=next&more=2' }))).mockResolvedValueOnce(new Response(JSON.stringify({ Items: [{ Id: 2 }], Next: '' })))
    vi.stubGlobal('fetch', fetchMock)
    const tp = new TpClient()
    vi.spyOn(tp, 'api').mockResolvedValueOnce({ Items: [{ Id: 1 }], Next: '/api/v1/Users?skip=25&take=25&cursor=next' })
    const page = await tp.getUsers<any>()
    expect(page.Complete).toBe(true)
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('cursor')).toBe('next')
    expect(page.Items).toHaveLength(3)
  })
  it('refuses cross-origin paging before sending credentials', async () => {
    vi.stubGlobal('fetch', vi.fn())
    await expect(new TpHttp({ url: 'https://tenant.test', token: 'secret' }).request('GET', 'https://evil.test/api/v1/Users')).rejects.toThrow('Untrusted')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('detects pagination loops instead of reporting a complete directory', async () => {
    const tp = new TpClient()
    vi.spyOn(tp, 'api').mockResolvedValue({ Items: [{ Id: 1 }], Next: '/api/v1/Users?skip=1' })
    vi.spyOn(tp, 'apiPage').mockResolvedValue({ Items: [{ Id: 1 }], Next: '/api/v1/Users?skip=1' })
    await expect(tp.getProjects()).rejects.toThrow('incomplete')
  })
  it('keeps permission errors distinct from an empty directory', async () => {
    const tp = { api: vi.fn().mockRejectedValue(new TpApiError('GET Processes', 403, 'denied')) } as unknown as TpClient
    await expect(new Insights(tp).directory('Processes', { all: true })).rejects.toMatchObject({ status: 403 })
  })
  it('reports a genuinely empty directory as complete', async () => {
    const tp = { api: vi.fn().mockResolvedValue(metadata('Id', 'Name')), apiAll: vi.fn().mockResolvedValue([]) } as unknown as TpClient
    expect(await new Insights(tp).directory('Processes', { all: true })).toMatchObject({ items: [], complete: true, returned: 0 })
  })
})
describe('historical transitions', () => {
  const options: HistoryOptions = { entityTypes: ['Bug'], from: '2026-10-26T00:00:00Z', to: '2026-10-27T00:00:00Z', take: 20, skip: 0, direction: 'asc' }
  function historyFixture(tags = false) {
    const rows = [{ Id: 2, Name: 'Historical title', Date: '2026-10-26T09:00:00Z', CurrentBug: { Id: 50 }, EntityState: { Id: 11, Name: 'Done' }, PreviousHistoryRecord: { Id: 1 }, Modifier: { Id: 4, FullName: 'Tester' }, Project: { Id: 7 }, Tags: 'QA,Discarded' }]
    const apiAll = vi.fn().mockResolvedValue(rows)
    const tp = {
      api: vi.fn(async (_method, path) => path[1] === 'meta' ? metadata('Id', 'Name', 'Date', 'DateTo', 'Modification', 'CurrentBug', 'PreviousHistoryRecord', 'Modifier', 'Project', 'Team', tags ? 'Tags' : 'EntityState', tags ? 'IsChangedTags' : 'IsChangedEntityState') : path.length === 1 ? { Items: await apiAll(), Next: '' } : { Id: 1, EntityState: { Id: 10, Name: 'Open' }, Tags: 'QA' }),
      apiAll,
    }
    return { tp, service: new Insights(tp as unknown as TpClient) }
  }
  it('reads the actual predecessor outside the requested date window', async () => {
    const { tp, service } = historyFixture()
    const result = await service.history({ ...options, entityIds: ['50'], projectId: '7', stateName: 'Done' }, 'status')
    expect(result.events[0]).toMatchObject({ entityId: 50, title: 'Historical title', previous: { Name: 'Open' }, next: { Name: 'Done' }, actor: { Id: 4 }, timestamp: '2026-10-26T09:00:00.000Z', scope: 'EntityState' })
    expect(tp.api).toHaveBeenCalledWith('GET', ['BugHistories', '1'])
    expect(tp.api.mock.calls.find(call => call[1].length === 1)?.[3].where).toContain('CurrentBug.Id eq 50')
    expect(tp.api.mock.calls.find(call => call[1].length === 1)?.[3].where).not.toContain('ModifyDate')
  })
  it('does not invent tag history from current card tags', async () => {
    const { tp, service } = historyFixture()
    const result = await service.history(options, 'tags')
    expect(result).toMatchObject({ events: [], complete: false })
    expect(tp.apiAll).not.toHaveBeenCalled()
    expect(result.limitations[0].reason).toContain('does not expose tag changes')
  })
  it('can compare tag snapshots if a tenant actually exposes historical tags', async () => {
    const { service } = historyFixture(true)
    const result = await service.history(options, 'tags')
    expect(result.events[0]).toMatchObject({ added: ['Discarded'], removed: [] })
  })
  it('does not present entity creation as a transition', async () => {
    const { tp, service } = historyFixture()
    tp.apiAll.mockResolvedValue([{ Date: '2026-10-26T01:00:00Z', Modification: 'Add', CurrentBug: { Id: 50 }, EntityState: { Name: 'Open' } }])
    expect((await service.history(options, 'status')).events).toEqual([])
  })
  it('requires a verified offset for timezone-less API dates', () => {
    expect(() => timestamp('2026-10-26T09:00:00')).toThrow('timezone')
    expect(timestamp('2026-10-26T09:00:00', '+02:00')).toBe('2026-10-26T07:00:00.000Z')
    expect(timestamp('/Date(0+0000)/')).toBe('1970-01-01T00:00:00.000Z')
  })
})
describe('role workload semantics', () => {
  it('distinguishes missing, unavailable and zero estimates, and does not assign ownership as QA', async () => {
    const tp = { api: vi.fn().mockResolvedValue({ Id: 9, Name: 'QA' }), apiAll: vi.fn().mockResolvedValue([{ Id: 1 }, { Id: 2 }, { Id: 3 }, { Id: 4 }]) } as unknown as TpClient
    const service = new Insights(tp)
    vi.mocked(tp.api).mockImplementation(async (_method, path) => path[1] === 'meta' ? metadata('TeamIteration', 'Iteration') : { Id: 9, Name: 'QA' })
    vi.spyOn(service, 'details').mockImplementation(async (_res, id) => ({ Id: Number(id), Name: id, Owner: { Id: 999 }, Units: 'hours', TeamIteration: { Id: 80 }, Assignments: { availability: 'available', items: [{ GeneralUser: { Id: 7 }, Role: { Id: 9 } }, ...(id === '4' ? [{ GeneralUser: { Id: 8 }, Role: { Id: 9 } }] : [])] }, RoleEfforts: id === '3' ? { availability: 'unavailable' } : { availability: 'available', items: id === '2' ? [] : [{ Role: { Id: 9 }, Effort: id === '1' ? 0 : 8 }] } }))
    const result = await service.workload({ roleId: '9', entityTypes: ['UserStories'], testerId: '7' })
    expect(result.cards.map(c => c.qaEstimate.state)).toEqual(['set', 'unset', 'unavailable', 'set'])
    expect(result.cards[0].qaEstimate.value).toBe(0)
    expect(result.totals[0]).toMatchObject({ exclusiveEstimate: 0, sharedUnallocatedEstimate: 8, missing: [2], unavailable: [3] })
    expect(result.totals.some(t => t.tester?.Id === 999)).toBe(false)
  })
})
describe('mutation verification', () => {
  it('accepts HTML entity equivalence while preserving structure, whitespace, links and actual text', () => {
    expect(equivalentMarkup('<p>A & B</p>', '<p>A &amp; B</p>')).toBe(true)
    expect(equivalentMarkup('<p>x</p>', '<strong>x</strong>')).toBe(false)
    expect(equivalentMarkup('<a href="/x">x</a>', '<a href="/y">x</a>')).toBe(false)
    expect(equivalentMarkup('a b', 'ab')).toBe(false)
    expect(equivalentMarkup('&amp;lt;', '&lt;')).toBe(false)
  })
  it('uses valid API v1 ordering and preserves plan filtering', async () => {
    const tp = { api: vi.fn().mockResolvedValue({ Items: [] }) } as unknown as TpClient
    await new TestManagement(tp).listRuns({ testPlanId: '370981', take: 1 })
    expect(tp.api).toHaveBeenCalledWith('GET', ['TestPlanRuns'], undefined, expect.objectContaining({ where: 'TestPlan.Id eq 370981', orderByDesc: 'CreateDate', take: 1 }))
  })
  it('accepts encoded run-description readback and retains ID after failed verification', async () => {
    const tp = { api: vi.fn(async (method, _path, body) => method === 'POST' ? { Id: 20, ...body } : { Id: 20, Description: '<p>A &amp; B</p>' }) } as unknown as TpClient
    const service = new TestManagement(tp); vi.spyOn(service, 'editable').mockResolvedValue({} as any)
    expect(await service.updateRun('20', { description: '<p>A & B</p>' })).toMatchObject({ Id: 20, verified: true })
    expect(await service.updateRun('20', { description: '<p>Different</p>' })).toMatchObject({ id: '20', verified: false, writeStatus: 'acknowledged' })
  })
  it('creates only ID references and verifies the original card title', async () => {
    const tp = new TpClient(), posted: any[] = []
    vi.spyOn(tp as any, 'post').mockImplementation(async (_params, body) => { posted.push(body); return { Id: 80 } })
    vi.spyOn(tp, 'api').mockImplementation(async (_method, path) => path[0] === 'Generals' ? { Id: 50, Name: 'Original', ResourceType: 'Bug', Project: { Id: 7 } } : { Id: 80, Name: 'Test Plan: QA scope', LinkedGeneral: { Id: 50 } })
    const result = await tp.createTestPlan<any>('QA scope', '50', 'Bug')
    expect(result.verified).toBe(true)
    for (const name of ['LinkedGeneral', 'LinkedAssignable', 'LinkedBug']) expect(posted[0][name]).not.toHaveProperty('Name')
  })
  it('scopes bug workflows to the supplied project rather than configured defaults', async () => {
    const tp = new TpClient()
    vi.spyOn(tp, 'api').mockResolvedValue({ Process: { Id: 333 } })
    const get = vi.spyOn(tp as any, 'get').mockResolvedValue({ items: [] })
    await tp.getBugWorkflows({ projectId: '7' })
    expect(get.mock.calls[0][0].param.where).toContain('process.id=333')
    await expect(tp.getBugWorkflows({ projectId: '7', processId: '444' })).rejects.toThrow('does not belong')
  })
})
