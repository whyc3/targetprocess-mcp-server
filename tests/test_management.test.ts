import { describe, expect, it, vi } from 'vitest'
import type { TpClient } from '../src/tp.js'
import { TestManagement } from '../src/test_management.js'

function fixture() {
  const runs: Record<string, any> = { '20': { Id: 20, Name: 'Cycle', TestPlan: { Id: 10 }, Project: { Id: 17 }, EntityState: { Id: 1 } } }
  const cases: Record<string, any> = { '40': { Id: 40, Name: 'Login', TestPlanRun: { Id: 20 }, TestCase: { Id: 30 }, Status: 'NotRun', Comment: '' } }
  const states = [{ Id: 1, Name: 'Open', IsFinal: false }, { Id: 2, Name: 'Done', IsFinal: true }]
  const files: any[] = [{ Id: 70, Name: 'login.png', MimeType: 'image/png', General: { Id: 20 } }]
  const bugLinks: Record<string, any[]> = { '40': [] }
  const metadata = { Properties: ['ChildTestPlanRuns', 'ParentTestPlanRuns', 'Bugs', 'Build', 'Status'].map(Name => ({ Name })) }
  const api = vi.fn(async (method: string, path: string[], body?: any) => {
    const [resource, id] = path
    if (id === 'meta') return metadata
    if (resource === 'TestPlanRuns' && id) {
      if (!runs[id]) throw new Error('Run not found')
      if (method === 'POST') Object.assign(runs[id], body)
      return structuredClone(runs[id])
    }
    if (resource === 'TestPlanRuns' && method === 'POST') {
      runs['22'] = { Id: 22, Name: 'New cycle', TestPlan: { Id: 10 }, Project: { Id: 17 }, EntityState: { Id: 1 } }
      cases['42'] = { Id: 42, TestPlanRun: { Id: 22 }, TestCase: { Id: 30 }, Status: 'NotRun' }
      return runs['22']
    }
    if (resource === 'TestCaseRuns' && id) {
      if (method === 'POST') {
        if (body.Bugs) bugLinks[id] = [...(bugLinks[id] || []), ...body.Bugs.Items.map((bug: any) => ({ Id: Number(bug.Id) }))]
        else Object.assign(cases[id], body)
      }
      return structuredClone(cases[id])
    }
    if (resource === 'EntityStates') return states.find(state => String(state.Id) === id)
    if (resource === 'Projects') return { Id: 17, Process: { Id: 4 } }
    if (resource === 'Bugs') return { Id: Number(id), Name: 'Defect' }
    if (resource === 'Generals') return { Id: Number(id), ResourceType: 'TestPlanRun' }
    throw new Error('Unexpected API call: ' + method + ' ' + path.join('/'))
  })
  const apiAll = vi.fn(async (path: string[], query?: any) => {
    const [resource, id, relation] = path
    if (resource === 'EntityStates') return states
    if (resource === 'TestPlanRuns' && relation === 'TestCaseRuns') return Object.values(cases).filter(item => String(item.TestPlanRun.Id) === id)
    if (resource === 'TestPlanRuns' && relation === 'ChildTestPlanRuns') return Object.values(runs).filter(run => String(run.ParentTestPlanRun?.Id) === id)
    if (resource === 'TestPlanRuns' && relation === 'ParentTestPlanRuns') return runs[id].ParentTestPlanRun ? [runs[id].ParentTestPlanRun] : []
    if (resource === 'TestPlanRuns' && relation === 'Bugs') return Object.values(bugLinks).flat()
    if (resource === 'TestCaseRuns' && relation === 'Bugs') return bugLinks[id] || []
    if (resource === 'Generals' && relation === 'Attachments') return files.filter(file => String(file.General.Id) === id)
    if (resource === 'TestPlans') return []
    throw new Error('Unexpected collection: ' + path.join('/') + JSON.stringify(query))
  })
  const tp = {
    api, apiAll,
    getTestPlan: vi.fn().mockResolvedValue({ Id: 10, Project: { Id: 17 } }),
    getTestPlanTestCases: vi.fn().mockResolvedValue({ Items: [{ Id: 30, Name: 'Login' }] }),
    addAttachedFile: vi.fn(async (generalId: string) => {
      files.push({ Id: 71, Name: 'evidence.png', MimeType: 'image/png', General: { Id: Number(generalId) } })
      return 'Uploaded'
    }),
  }
  return { service: new TestManagement(tp as unknown as TpClient), tp, runs, cases, states, files, bugLinks, metadata }
}
const writes = (tp: ReturnType<typeof fixture>['tp']) => tp.api.mock.calls.filter(call => call[0] === 'POST')

describe('execution management', () => {
  it('blocks result changes in a final run', async () => {
    const f = fixture(); f.runs['20'].EntityState.Id = 2
    await expect(f.service.updateCaseRun({ id: '40', status: 'Passed', comment: 'Observed success', evidenceAttachmentIds: ['70'] })).rejects.toThrow('read-only')
    expect(writes(f.tp)).toHaveLength(0)
  })

  it('checks final parent runs before allowing child-run results', async () => {
    const f = fixture()
    f.runs['21'] = { ...f.runs['20'], Id: 21, ParentTestPlanRun: { Id: 20 } }
    f.runs['20'].EntityState = { Id: 2 }
    f.cases['40'].TestPlanRun.Id = 21
    await expect(f.service.updateCaseRun({ id: '40', status: 'Failed', comment: 'Error', evidenceAttachmentIds: ['70'] })).rejects.toThrow('20 is final')
    expect(writes(f.tp)).toHaveLength(0)
  })

  it('rejects missing screenshots without recording a result', async () => {
    const f = fixture()
    await expect(f.service.updateCaseRun({ id: '40', status: 'Passed', comment: 'Observed success' })).rejects.toThrow('screenshot')
    expect(writes(f.tp)).toHaveLength(0)
  })

  it('rejects evidence from another execution cycle', async () => {
    const f = fixture(); f.files[0].General.Id = 99
    await expect(f.service.updateCaseRun({ id: '40', status: 'Failed', comment: 'Observed error', evidenceAttachmentIds: ['70'] })).rejects.toThrow('exact Test Plan Run')
    expect(writes(f.tp)).toHaveLength(0)
  })

  it('saves and verifies actual results and screenshot references', async () => {
    const f = fixture()
    const result = await f.service.updateCaseRun({ id: '40', status: 'Passed', comment: 'Dashboard displayed', evidenceAttachmentIds: ['70'] })
    expect(result.Status).toBe('Passed')
    expect(result.Comment).toContain('Dashboard displayed')
    expect(result.Comment).toContain('70')
    expect(writes(f.tp)).toHaveLength(1)
  })

  it('rejects finalization while cases remain outstanding', async () => {
    const f = fixture()
    await expect(f.service.completeRun('20', '2')).rejects.toThrow('unexecuted')
    expect(writes(f.tp)).toHaveLength(0)
  })

  it('checks nested runs before finalization and includes them in summaries', async () => {
    const f = fixture(); f.cases['40'].Status = 'Passed'
    f.runs['21'] = { ...f.runs['20'], Id: 21, ParentTestPlanRun: { Id: 20 } }
    f.cases['41'] = { ...f.cases['40'], Id: 41, TestPlanRun: { Id: 21 }, TestCase: { Id: 31 }, Status: 'Blocked' }
    await expect(f.service.completeRun('20', '2')).rejects.toThrow('blocked')
    const summary = await f.service.summary('20')
    expect(summary.total).toBe(2)
    expect(summary.counts).toEqual({ Passed: 1, Blocked: 1 })
  })

  it('records explicit incomplete-run risk acceptance before closing', async () => {
    const f = fixture()
    await f.service.completeRun('20', '2', true, 'Remaining case deferred by QA')
    expect(f.runs['20'].Description).toContain('Remaining case deferred by QA')
    expect(f.runs['20'].EntityState.Id).toBe('2')
  })

  it('rejects state IDs from a different workflow', async () => {
    const f = fixture()
    await expect(f.service.updateRun('20', { stateId: '99' })).rejects.toThrow('workflow')
    expect(writes(f.tp)).toHaveLength(0)
  })

  it('reports the actual EndRunDate when the deprecated RunDate is absent', async () => {
    const f = fixture(); f.cases['40'].EndRunDate = '/Date(1791972000000)/'
    const summary = await f.service.summary('20')
    expect(summary.caseResults[0].runDate).toBe('/Date(1791972000000)/')
  })

  it('uses the project process to discover workflow states', async () => {
    const f = fixture()
    await f.service.workflow('20')
    expect(f.tp.apiAll).toHaveBeenCalledWith(['EntityStates'], expect.objectContaining({ where: expect.stringContaining('Workflow.Process.Id eq 4') }))
  })

  it('creates a plan run once and retrieves automatically generated case runs', async () => {
    const f = fixture()
    const result = await f.service.createRun('10')
    expect(result).toMatchObject({ id: 22, verified: true, caseRuns: [{ Id: 42 }] })
    expect(writes(f.tp)).toHaveLength(1)
    expect(writes(f.tp)[0][2]).toEqual({ TestPlan: { Id: '10' } })
  })

  it('links bugs through the execution relationship and preserves old links', async () => {
    const f = fixture(); f.bugLinks['40'].push({ Id: 80 })
    const result = await f.service.linkBug('40', '81')
    expect(result.verified).toBe(true)
    expect(f.bugLinks['40']).toEqual([{ Id: 80 }, { Id: 81 }])
  })

  it('allows additive bug links when collection replacement is read-only', async () => {
    const f = fixture()
    f.metadata.Properties.push({ Name: 'Bugs', CanSet: false, CanAdd: true, Type: 'Bug' } as any)
    const result = await f.service.linkBug('40', '81')
    expect(result.verified).toBe(true)
    expect(f.bugLinks['40']).toEqual([{ Id: 81 }])
  })

  it('refuses bug links when tenant metadata forbids adding to the collection', async () => {
    const f = fixture()
    f.metadata.Properties.push({ Name: 'Bugs', CanSet: false, CanAdd: false, Type: 'Bug' } as any)
    await expect(f.service.linkBug('40', '81')).rejects.toThrow('read-only')
    expect(writes(f.tp)).toHaveLength(0)
  })

  it('avoids duplicate existing bug links', async () => {
    const f = fixture(); f.bugLinks['40'].push({ Id: 80 })
    expect(await f.service.linkBug('40', '80')).toMatchObject({ alreadyLinked: true })
    expect(writes(f.tp)).toHaveLength(0)
  })

  it('uploads screenshots and embeds them in the exact case-run Final Result', async () => {
    const f = fixture()
    const result = await f.service.uploadRunEvidence('40', { fileContent: 'SGVsbG8=', fileName: 'evidence.png' })
    expect(result).toMatchObject({ generalId: '20', testCaseRunId: '40', attachments: [{ Id: 71 }] })
    expect(f.cases['40'].Comment).toContain('TestCaseRun 40')
    expect(f.cases['40'].Comment).toContain('71')
    expect(f.cases['40'].Comment).toContain('<img src="/Attachment.aspx?AttachmentID=71"')
    expect(result).toMatchObject({ status: 'complete', verified: true, storageEntity: 'TestPlanRun', evidenceField: 'TestCaseRun.Comment', directCaseRunAttachment: false })
  })

  it('keeps uploaded screenshots and support files when the actual result is updated', async () => {
    const f = fixture()
    await f.service.uploadRunEvidence('40', { fileContent: 'SGVsbG8=', fileName: 'evidence.png' })
    f.files.push({ Id: 72, Name: 'execution.log', MimeType: 'text/plain', General: { Id: 20 } })
    f.cases['40'].Comment += '<p><a href="/Attachment.aspx?AttachmentID=72">execution.log</a></p>'
    const result = await f.service.updateCaseRun({ id: '40', status: 'Passed', comment: 'Latest observed result', evidenceAttachmentIds: ['70'] })
    expect(result.Comment).toContain('Latest observed result')
    for (const id of [70, 71, 72]) expect(result.Comment).toContain('/Attachment.aspx?AttachmentID=' + id)
    expect(result.Comment?.match(/<img /g)).toHaveLength(2)
  })

  it('embeds legacy screenshot ID references and ignores attachments from other runs', async () => {
    const f = fixture()
    f.files.push({ Id: 72, Name: 'other.png', MimeType: 'image/png', General: { Id: 99 } })
    f.cases['40'].Comment = 'Evidence for TestCaseRun 40: attachment IDs 70, 72'
    const result = await f.service.updateCaseRun({ id: '40', status: 'Passed', comment: 'Observed result', evidenceAttachmentIds: ['70'] })
    expect(result.Comment).toContain('<img src="/Attachment.aspx?AttachmentID=70"')
    expect(result.Comment).not.toContain('AttachmentID=72')
  })

  it('preserves current observations saved during file upload', async () => {
    const f = fixture()
    const upload = f.tp.addAttachedFile.getMockImplementation()!
    f.tp.addAttachedFile.mockImplementation(async (generalId: string) => {
      f.cases['40'].Comment = '<p>Concurrent observation</p>'
      return upload(generalId)
    })
    await f.service.uploadRunEvidence('40', { fileContent: 'SGVsbG8=', fileName: 'evidence.png' })
    expect(f.cases['40'].Comment).toContain('<p>Concurrent observation</p>')
    expect(f.cases['40'].Status).toBe('NotRun')
  })

  it('returns uploaded IDs and recovery instructions if saving the result fails', async () => {
    const f = fixture()
    const api = f.tp.api.getMockImplementation()!
    f.tp.api.mockImplementation(async (method: string, path: string[], body?: any) => {
      if (method === 'POST' && path[0] === 'TestCaseRuns') throw new Error('Write timed out')
      return api(method, path, body)
    })
    const result = await f.service.uploadRunEvidence('40', { fileContent: 'SGVsbG8=', fileName: 'evidence.png' })
    expect(result).toMatchObject({ status: 'partial', verified: false, attachments: [{ Id: 71 }] })
    expect(result.recovery).toContain('Do not re-upload')
    expect(f.tp.addAttachedFile).toHaveBeenCalledTimes(1)
  })

  it('escapes file names and uses credential-free download links for supporting files', async () => {
    const f = fixture()
    const name = '<img src=x onerror=alert(1)>.log'
    f.tp.addAttachedFile.mockImplementation(async (generalId: string) => {
      f.files.push({ Id: 71, Name: name, MimeType: 'text/plain', Uri: 'https://example.invalid/?access_token=secret', General: { Id: Number(generalId) } })
      return 'Uploaded'
    })
    const result = await f.service.uploadRunEvidence('40', { fileContent: 'SGVsbG8=', fileName: name })
    expect(result.comment).toContain('&lt;img src=x onerror=alert(1)&gt;.log')
    expect(result.comment).toContain('href="/Attachment.aspx?AttachmentID=71"')
    expect(result.comment).not.toContain('<img ')
    expect(result.comment).not.toContain('secret')
  })

  it('replaces its evidence section without duplicating screenshots on repeated result updates', async () => {
    const f = fixture()
    const first = await f.service.updateCaseRun({ id: '40', status: 'Passed', comment: 'Observed success', evidenceAttachmentIds: ['70'] })
    const second = await f.service.updateCaseRun({ id: '40', status: 'Passed', comment: first.Comment!, evidenceAttachmentIds: ['70'] })
    expect(second.Comment?.match(/<img /g)).toHaveLength(1)
    expect(second.Comment).toBe(first.Comment)
  })

  it('keeps earlier screenshots when another file is uploaded', async () => {
    const f = fixture()
    await f.service.uploadRunEvidence('40', { fileContent: 'SGVsbG8=', fileName: 'evidence.png' })
    f.tp.addAttachedFile.mockImplementation(async (generalId: string) => {
      f.files.push({ Id: 72, Name: 'second.png', MimeType: 'image/png', General: { Id: Number(generalId) } })
      return 'Uploaded'
    })
    await f.service.uploadRunEvidence('40', { fileContent: 'SGVsbG8=', fileName: 'second.png' })
    expect(f.cases['40'].Comment.match(/<img /g)).toHaveLength(2)
    expect(f.cases['40'].Comment.match(/Evidence for TestCaseRun 40/g)).toHaveLength(1)
  })

  it('does not upload a file into a completed run', async () => {
    const f = fixture(); f.runs['20'].EntityState.Id = 2
    await expect(f.service.uploadRunEvidence('40', { fileContent: 'SGVsbG8=', fileName: 'evidence.png' })).rejects.toThrow('read-only')
    expect(f.tp.addAttachedFile).not.toHaveBeenCalled()
  })

  it('reports partial success when the saved evidence cannot be verified', async () => {
    const f = fixture()
    const api = f.tp.api.getMockImplementation()!
    f.tp.api.mockImplementation(async (method: string, path: string[], body?: any) => {
      if (method === 'POST' && path[0] === 'TestCaseRuns') return { ...f.cases['40'] }
      return api(method, path, body)
    })
    const result = await f.service.uploadRunEvidence('40', { fileContent: 'SGVsbG8=', fileName: 'evidence.png' })
    expect(result).toMatchObject({ status: 'partial', verified: false, attachments: [{ Id: 71 }] })
    expect(result.error?.message).toContain('could not be verified')
  })

  it('returns individual batch failures without losing successful results', async () => {
    const f = fixture()
    const result = await f.service.batchResults([
      { id: '40', status: 'Passed', comment: 'Success', evidenceAttachmentIds: ['70'] },
      { id: '999', status: 'Failed', comment: 'Error', evidenceAttachmentIds: ['70'] },
    ])
    expect(result.updated).toHaveLength(1)
    expect(result.failed).toMatchObject([{ id: '999' }])
  })

  it('rejects duplicate case-run IDs in a batch before any write', async () => {
    const f = fixture()
    const input = { id: '40', status: 'Passed', comment: 'Success', evidenceAttachmentIds: ['70'] }
    await expect(f.service.batchResults([input, input])).rejects.toThrow('unique')
    expect(writes(f.tp)).toHaveLength(0)
  })
})
