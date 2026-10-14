import { basename, isAbsolute } from 'node:path'
import { statSync } from 'node:fs'
import type { TpClient } from './tp.js'
import type { TestCase, TestStep, TpResponse } from './types.js'
import type { Attachment, CaseRun, ExecutionInput, PlanRun, Ref, State, StepRun } from './test_management_types.js'
import { errorDetails } from './http.js'
import { createCaseWithSteps, type CaseInput } from './handlers/add_test_cases_to_test_plan.js'

export function assertId(id: string) {
  if (!/^[1-9]\d*$/.test(id)) throw new Error('Use a positive integer entity ID')
  return id
}
function quote(text: string) { return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'") }
function metadataNames(value: unknown, found = new Set<string>()): Set<string> {
  if (!value || typeof value !== 'object') return found
  for (const [key, child] of Object.entries(value)) {
    found.add(key)
    if (key.toLowerCase() === 'name' && typeof child === 'string') found.add(child)
    if (typeof child === 'object') metadataNames(child, found)
  }
  return found
}
function metadataField(value: unknown, name: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const object = value as Record<string, unknown>
  if (object.Name === name && ('CanSet' in object || 'Type' in object)) return object
  for (const [key, child] of Object.entries(object)) {
    if (key === name && child && typeof child === 'object') return child as Record<string, unknown>
    const found = metadataField(child, name)
    if (found) return found
  }
  return undefined
}

const terminal = (status: string | null | undefined) => ['passed', 'failed'].includes((status || '').toLowerCase())

export class TestManagement {
  private readonly metadataCache = new Map<string, unknown>()
  constructor(readonly tp: TpClient) {}

  async metadata(resource: string) {
    if (!this.metadataCache.has(resource)) this.metadataCache.set(resource, await this.tp.api('GET', [resource, 'meta']))
    return this.metadataCache.get(resource)
  }

  private async requireField(resource: string, field: string, collectionAdd = false) {
    const metadata = await this.metadata(resource)
    const descriptor = metadataField(metadata, field)
    if ((collectionAdd && descriptor?.CanAdd === false) || (descriptor?.CanSet === false && !(collectionAdd && descriptor.CanAdd === true))) throw new Error(resource + '.' + field + ' is read-only; no write was attempted')
    if (!metadataNames(metadata).has(field)) {
      throw new Error(resource + ' metadata does not expose ' + field + '; no write was attempted')
    }
  }

  async listCases(options: { projectId?: string; keyword?: string; take?: number; skip?: number }) {
    const where = []
    if (options.projectId) where.push('Project.Id eq ' + assertId(options.projectId))
    if (options.keyword) where.push("Name contains '" + quote(options.keyword) + "'")
    return this.tp.api<TpResponse<TestCase>>('GET', ['TestCases'], undefined, {
      take: options.take ?? 50, skip: options.skip ?? 0, ...(where.length ? { where: where.join(' and ') } : {}),
      include: '[Id,Name,Description,Tags,Project,TestPlans]',
    })
  }

  async createCase(input: CaseInput & { testPlanId?: string }) {
    return createCaseWithSteps(this.tp, input.testPlanId, input)
  }

  async cloneCase(id: string, name: string, testPlanId?: string, projectId?: string) {
    const source = await this.tp.getTestCase<TestCase>(assertId(id))
    if (!source?.Id) throw new Error('Source test case was not found')
    const steps = await this.tp.getTestCaseSteps<TpResponse<TestStep>>(id)
    if (!steps?.Items) throw new Error('Source test steps could not be read')
    return this.createCase({
      name, description: source.Description, tags: source.Tags, testPlanId,
      projectId: projectId ?? (testPlanId ? undefined : String(source.Project.Id)),
      steps: steps.Items.slice().sort((a, b) => a.RunOrder - b.RunOrder).map(step => ({ description: step.Description, result: step.Result })),
    })
  }

  async linkCases(testPlanId: string, testCaseIds: string[]) {
    const plan = await this.tp.getTestPlan<{ Project: Ref }>(assertId(testPlanId))
    if (!plan?.Project?.Id) throw new Error('Destination project could not be read')
    if (new Set(testCaseIds).size !== testCaseIds.length) throw new Error('Case IDs must be unique')
    const cases = []
    // Validate the whole batch before the first write.
    for (const id of testCaseIds) {
      const entity = await this.tp.getTestCase<TestCase>(assertId(id))
      if (entity?.Project?.Id !== plan.Project.Id) throw new Error('Case ' + id + ' belongs to another project')
      cases.push(id)
    }
    const linked: string[] = [], alreadyLinked: string[] = []
    const failed: Array<{ id: string; error: ReturnType<typeof errorDetails> }> = []
    for (const id of cases) {
      try {
      const previous = await this.tp.getTestCaseTestPlans(id)
      if (!previous) throw new Error('Cannot read memberships for ' + id)
      if (previous.some(plan => plan.id === testPlanId)) { alreadyLinked.push(id); continue }
      await this.tp.api('POST', ['TestCases', id], { TestPlans: { Items: [{ Id: testPlanId }] } })
      const after = await this.tp.getTestCaseTestPlans(id)
      if (!after?.some(plan => plan.id === testPlanId) || previous.some(plan => !after.some(next => next.id === plan.id))) {
        throw new Error('Membership verification failed for ' + id + '; inspect it before retrying')
      }
      linked.push(id)
      } catch (error) { failed.push({ id, error: errorDetails(error) }) }
    }
    return { linked, alreadyLinked, failed }
  }

  async retrySteps(testCaseId: string, steps: Array<{ index: number; description: string; result: string }>) {
    const current = await this.tp.getTestCaseSteps<TpResponse<TestStep>>(assertId(testCaseId))
    if (!current?.Items) throw new Error('Cannot read existing steps')
    if (new Set(steps.map(step => step.index)).size !== steps.length) throw new Error('Step positions must be unique')
    const missing = []
    for (const step of steps) {
      const existing = current.Items.find(item => item.RunOrder === step.index)
      if (existing && (existing.Description !== step.description || existing.Result !== step.result)) {
        throw new Error('A different step already occupies position ' + step.index)
      }
      if (!existing) missing.push(step)
    }
    const created: Ref[] = []
    for (const step of missing) {
      created.push(await this.tp.addTestStep<TestStep>(testCaseId, { description: step.description, result: step.result, runOrder: step.index }))
    }
    const after = await this.tp.getTestCaseSteps<TpResponse<TestStep>>(testCaseId)
    if (steps.some(step => !after?.Items.some(item => item.RunOrder === step.index && item.Description === step.description && item.Result === step.result))) {
      throw new Error('Retried step verification failed; do not retry blindly')
    }
    return { created, alreadyPresent: steps.length - missing.length }
  }

  async reorderSteps(testCaseId: string, stepIds: string[]) {
    const current = await this.tp.getTestCaseSteps<TpResponse<TestStep>>(assertId(testCaseId))
    if (!current?.Items || stepIds.length !== current.Items.length || new Set(stepIds).size !== stepIds.length || current.Items.some(step => !stepIds.includes(String(step.Id)))) {
      throw new Error('Provide every existing step ID exactly once')
    }
    for (const [index, id] of stepIds.entries()) {
      await this.tp.api('POST', ['TestSteps', id], { RunOrder: index + 1 })
    }
    const after = await this.tp.getTestCaseSteps<TpResponse<TestStep>>(testCaseId)
    if (!after?.Items || after.Items.length !== stepIds.length || after.Items.slice().sort((a, b) => a.RunOrder - b.RunOrder).some((step, index) => String(step.Id) !== stepIds[index])) {
      throw new Error('Step order could not be verified; inspect current order')
    }
    return { testCaseId, stepIds }
  }

  async reorderCases(testPlanId: string, testCaseIds: string[], dryRun = true, acknowledgeSharedOrder = false) {
    await this.requireField('TestCases', 'NumericPriority')
    const current = await this.tp.apiAll<TestCase & { NumericPriority: number }>(['TestPlans', assertId(testPlanId), 'TestCases'])
    if (new Set(testCaseIds).size !== testCaseIds.length || current.length !== testCaseIds.length || current.some(item => !testCaseIds.includes(String(item.Id)))) throw new Error('Provide every direct test case ID exactly once')
    const sharedCases: Array<{ id: string; testPlanIds: string[] }> = []
    for (const id of testCaseIds) {
      const plans = await this.tp.getTestCaseTestPlans(assertId(id))
      if (!plans) throw new Error('Cannot verify case memberships for ' + id)
      if (plans.some(plan => plan.id !== testPlanId)) sharedCases.push({ id, testPlanIds: plans.map(plan => plan.id) })
    }
    const preview = { dryRun, testPlanId, testCaseIds, sharedCases, canReorder: sharedCases.length === 0 || acknowledgeSharedOrder }
    if (dryRun) return preview
    if (!preview.canReorder) throw new Error('Ordering is global for shared cases; inspect the dry run and explicitly acknowledgeSharedOrder before applying')
    const updated: string[] = []
    for (const [index, id] of testCaseIds.entries()) {
      try {
        await this.tp.api('POST', ['TestCases', id], { NumericPriority: index + 1 })
        updated.push(id)
      } catch (error) { return { ...preview, updated, failed: [{ id, error: errorDetails(error) }] } }
    }
    const after = await this.tp.apiAll<TestCase & { NumericPriority: number }>(['TestPlans', testPlanId, 'TestCases'])
    const ordered = after.slice().sort((a, b) => a.NumericPriority - b.NumericPriority)
    if (ordered.length !== testCaseIds.length || ordered.some((item, index) => String(item.Id) !== testCaseIds[index])) return { ...preview, updated, failed: [{ message: 'Case order could not be verified; inspect the current order' }] }
    return { ...preview, updated, verified: true }
  }

  async updatePlan(id: string, changes: { name?: string; description?: string }) {
    if (changes.name === undefined && changes.description === undefined) throw new Error('Provide a name or description')
    await this.tp.api('GET', ['TestPlans', assertId(id)])
    await this.tp.api('POST', ['TestPlans', id], {
      ...(changes.name === undefined ? {} : { Name: changes.name }),
      ...(changes.description === undefined ? {} : { Description: changes.description }),
    })
    return this.tp.api('GET', ['TestPlans', id])
  }

  async createRun(testPlanId: string, options: { name?: string; description?: string; buildId?: string } = {}) {
    const plan = await this.tp.getTestPlan<Ref>(assertId(testPlanId))
    if (!plan?.Id) throw new Error('Source test plan was not found')
    if (options.buildId) {
      await this.requireField('TestPlanRuns', 'Build')
      await this.tp.api('GET', ['Builds', assertId(options.buildId)])
    }
    const run = await this.tp.api<PlanRun>('POST', ['TestPlanRuns'], {
      TestPlan: { Id: testPlanId },
      ...(options.name ? { Name: options.name } : {}),
      ...(options.description === undefined ? {} : { Description: options.description }),
      ...(options.buildId ? { Build: { Id: options.buildId } } : {}),
    }, { resultFormat: 'json', resultInclude: '[Id,TestPlan,Project,EntityState]' })
    if (!run?.Id) throw new Error('Run creation returned no ID; inspect existing runs before retrying')
    // Return the ID even when automatic child generation or subsequent reads are not ready.
    try {
      const snapshot = await this.getRun(String(run.Id))
      const expected = await this.tp.getTestPlanTestCases<TpResponse<TestCase>>(testPlanId)
      if (!expected?.Items) throw new Error('Source case inventory could not be read')
      const expectedIds = new Set(expected.Items.map(item => item.Id))
      const actualIds = new Set(snapshot.caseRuns.map(item => item.TestCase.Id))
      if (expectedIds.size !== actualIds.size || [...expectedIds].some(id => !actualIds.has(id))) throw new Error('Generated case runs do not yet match the source plan; inspect this run before creating another')
      return { id: run.Id, verified: true, ...snapshot }
    }
    catch (error) { return { id: run.Id, verified: false, verificationError: errorDetails(error) } }
  }

  listRuns(options: { testPlanId?: string; projectId?: string; take?: number; skip?: number; latestOnly?: boolean }) {
    const where = []
    if (options.testPlanId) where.push('TestPlan.Id eq ' + assertId(options.testPlanId))
    if (options.projectId) where.push('Project.Id eq ' + assertId(options.projectId))
    if (options.latestOnly) where.push("IsLastStarted eq 'True'")
    return this.tp.api('GET', ['TestPlanRuns'], undefined, { take: options.take ?? 50, skip: options.skip ?? 0, orderby: 'CreateDate desc', ...(where.length ? { where: where.join(' and ') } : {}) })
  }

  async getCaseRun(id: string) {
    const run = await this.tp.api<CaseRun>('GET', ['TestCaseRuns', assertId(id)])
    const steps = await this.tp.apiAll<StepRun>(['TestCaseRuns', id, 'TestStepRuns'], { orderby: 'RunOrder' })
    const bugs = await this.tp.apiAll<Ref>(['TestCaseRuns', id, 'Bugs'])
    return { ...run, stepRuns: steps, bugs }
  }

  private async children(run: PlanRun): Promise<PlanRun[]> {
    const names = metadataNames(await this.metadata('TestPlanRuns'))
    if (metadataField(await this.metadata('TestPlanRuns'), 'TestPlanRuns')) return this.tp.apiAll<PlanRun>(['TestPlanRuns', String(run.Id), 'TestPlanRuns'])
    if (names.has('ChildTestPlanRuns')) return this.tp.apiAll<PlanRun>(['TestPlanRuns', String(run.Id), 'ChildTestPlanRuns'])
    const parent = names.has('ParentTestPlanRun') ? 'ParentTestPlanRun' : names.has('ParentTestPlanRuns') ? 'ParentTestPlanRuns' : undefined
    if (parent) return this.tp.apiAll<PlanRun>(['TestPlanRuns'], { where: parent + '.Id eq ' + run.Id })
    const plans = await this.tp.apiAll<Ref>(['TestPlans'], { where: 'ParentTestPlans.Id eq ' + run.TestPlan.Id })
    if (plans.length) throw new Error('Tenant metadata does not expose the nested run relationship; cannot safely enumerate this run')
    return []
  }

  async getRun(id: string) {
    const root = await this.tp.api<PlanRun>('GET', ['TestPlanRuns', assertId(id)])
    const runIds: number[] = [], caseRuns: CaseRun[] = []
    const pending = [root], visited = new Set<number>()
    while (pending.length) {
      const run = pending.shift()!
      if (visited.has(run.Id)) continue
      visited.add(run.Id); runIds.push(run.Id)
      caseRuns.push(...await this.tp.apiAll<CaseRun>(['TestPlanRuns', String(run.Id), 'TestCaseRuns']))
      pending.push(...await this.children(run))
    }
    return { run: root, runIds, caseRuns: [...new Map(caseRuns.map(item => [item.Id, item])).values()] }
  }

  async workflow(id: string): Promise<State[]> {
    const run = await this.tp.api<PlanRun>('GET', ['TestPlanRuns', assertId(id)])
    const project = await this.tp.api<{ Process: Ref }>('GET', ['Projects', String(run.Project.Id)])
    if (!project?.Process?.Id) throw new Error('Run project process could not be resolved')
    return this.tp.apiAll<State>(['EntityStates'], {
      where: "(EntityType.Name eq 'TestPlanRun') and (Workflow.Process.Id eq " + project.Process.Id + ')',
      include: '[Id,Name,IsFinal,IsInitial]',
    })
  }

  private async editable(id: string, visited = new Set<string>()): Promise<PlanRun> {
    if (visited.has(id)) throw new Error('Cycle in parent test plan runs')
    visited.add(id)
    const run = await this.tp.api<PlanRun>('GET', ['TestPlanRuns', assertId(id)])
    if (!run?.EntityState?.Id) throw new Error('Cannot resolve the current run state')
    const state = await this.tp.api<State>('GET', ['EntityStates', String(run.EntityState.Id)])
    if (state.IsFinal === undefined) throw new Error('Cannot verify whether this run is final')
    if (state.IsFinal) throw new Error('Test plan run ' + id + ' is final and read-only')
    const names = metadataNames(await this.metadata('TestPlanRuns'))
    let parents: Ref[] = []
    if (names.has('ParentTestPlanRuns')) parents = await this.tp.apiAll<Ref>(['TestPlanRuns', id, 'ParentTestPlanRuns'])
    else if (names.has('ParentTestPlanRun')) {
      const expanded = await this.tp.api<PlanRun>('GET', ['TestPlanRuns', id], undefined, { include: '[Id,ParentTestPlanRun]' })
      if (expanded.ParentTestPlanRun) parents = [expanded.ParentTestPlanRun]
    }
    for (const parent of parents) await this.editable(String(parent.Id), new Set(visited))
    return run
  }

  async updateRun(id: string, changes: { name?: string; description?: string; stateId?: string }) {
    await this.editable(id)
    if (changes.stateId) {
      const state = (await this.workflow(id)).find(state => String(state.Id) === changes.stateId)
      if (!state) throw new Error('State does not belong to this run project workflow')
      if (state.IsFinal) throw new Error('Use complete_test_plan_run to move to a final state')
    }
    const body = {
      ...(changes.name === undefined ? {} : { Name: changes.name }),
      ...(changes.description === undefined ? {} : { Description: changes.description }),
      ...(changes.stateId ? { EntityState: { Id: changes.stateId } } : {}),
    }
    if (!Object.keys(body).length) throw new Error('Provide fields to update')
    await this.tp.api('POST', ['TestPlanRuns', id], body)
    const after = await this.tp.api<PlanRun>('GET', ['TestPlanRuns', id])
    if (changes.stateId && String(after.EntityState?.Id) !== changes.stateId) throw new Error('Run state could not be verified')
    if (changes.name !== undefined && after.Name !== changes.name) throw new Error('Run name could not be verified')
    if (changes.description !== undefined && after.Description !== changes.description) throw new Error('Run description could not be verified')
    return after
  }

  async completeRun(id: string, stateId: string, allowIncomplete = false, reason?: string) {
    await this.editable(id)
    const state = (await this.workflow(id)).find(state => String(state.Id) === stateId)
    if (!state?.IsFinal) throw new Error('Select a final state from this run project workflow')
    const snapshot = await this.getRun(id)
    const outstanding = snapshot.caseRuns.filter(run => !terminal(run.Status))
    if (outstanding.length && (!allowIncomplete || !reason?.trim())) {
      throw new Error('Run has ' + outstanding.length + ' unexecuted, blocked, or on-hold cases. Explicit allowIncomplete and reason are required')
    }
    if (outstanding.length) {
      const old = snapshot.run.Description || ''
      await this.tp.api('POST', ['TestPlanRuns', id], { Description: old + '\nCompletion exception: ' + reason })
    }
    await this.tp.api('POST', ['TestPlanRuns', id], { EntityState: { Id: stateId } })
    const after = await this.tp.api<PlanRun>('GET', ['TestPlanRuns', id])
    if (String(after.EntityState?.Id) !== stateId) throw new Error('Run finalization could not be verified')
    return after
  }

  async reopenRun(id: string, stateId: string) {
    const current = await this.tp.api<PlanRun>('GET', ['TestPlanRuns', assertId(id)])
    const state = (await this.workflow(id)).find(state => String(state.Id) === stateId)
    if (!state || state.IsFinal !== false) throw new Error('Select a non-final state from this run project workflow')
    if (!current?.EntityState?.Id) throw new Error('Cannot read the run state')
    // Targetprocess validates parent-run restrictions; never reopen parents implicitly.
    await this.tp.api('POST', ['TestPlanRuns', id], { EntityState: { Id: stateId } })
    const after = await this.tp.api<PlanRun>('GET', ['TestPlanRuns', id])
    if (String(after.EntityState?.Id) !== stateId) throw new Error('Run reopening could not be verified')
    return after
  }

  async attachments(generalId: string): Promise<Attachment[]> {
    return this.tp.apiAll<Attachment>(['Generals', assertId(generalId), 'Attachments'])
  }

  private async verifyEvidence(runId: string, evidenceIds: string[]) {
    if (!evidenceIds.length) throw new Error('At least one screenshot attachment ID is required')
    const attached = await this.attachments(runId)
    const selected = evidenceIds.map(id => attached.find(file => String(file.Id) === assertId(id)))
    if (selected.some(file => !file || !(/^image\/(png|jpeg|gif|webp)$/i.test(file.MimeType || '') || /\.(png|jpe?g|gif|webp)$/i.test(file.Name || '')))) {
      throw new Error('Evidence must be a screenshot attached to this exact Test Plan Run')
    }
    return selected as Attachment[]
  }

  private async validateStatus(resource: string, status: string) {
    const metadata = await this.metadata(resource)
    let allowed: string[] | undefined
    const scan = (value: unknown, fieldName?: string) => {
      if (!value || typeof value !== 'object') return
      const descriptor = value as Record<string, unknown>
      if (descriptor.Name === 'Status' || fieldName === 'Status') {
        for (const [key, list] of Object.entries(descriptor)) {
          if (/^(values|possiblevalues|allowedvalues|enumvalues)$/i.test(key) && Array.isArray(list)) {
            allowed = list.map(item => typeof item === 'string' ? item : item?.Value ?? item?.Name).filter((item): item is string => typeof item === 'string')
          }
        }
      }
      for (const [key, child] of Object.entries(descriptor)) if (typeof child === 'object') scan(child, key)
    }
    scan(metadata)
    if (allowed?.length && !allowed.includes(status)) throw new Error('Unsupported ' + resource + ' status. Allowed values: ' + allowed.join(', '))
    // When metadata does not advertise enum values, the API remains authoritative.
  }

  async updateCaseRun(input: ExecutionInput) {
    const run = await this.tp.api<CaseRun>('GET', ['TestCaseRuns', assertId(input.id)])
    if (!run?.TestPlanRun?.Id) throw new Error('Cannot resolve the case run parent')
    await this.editable(String(run.TestPlanRun.Id))
    if (!input.comment.trim()) throw new Error('Provide actual results or the reason for this status')
    const evidence = await this.verifyEvidence(String(run.TestPlanRun.Id), input.evidenceAttachmentIds || [])
    await this.validateStatus('TestCaseRuns', input.status)
    const note = input.comment + '\nEvidence attachment IDs: ' + evidence.map(file => file.Id).join(', ')
    await this.tp.api('POST', ['TestCaseRuns', input.id], { Status: input.status, Comment: note })
    const after = await this.tp.api<CaseRun>('GET', ['TestCaseRuns', input.id])
    if (after.Status !== input.status || after.Comment !== note) throw new Error('Case run result verification failed; read the current result before retrying')
    return after
  }

  async updateStepRun(id: string, status: string) {
    const step = await this.tp.api<StepRun>('GET', ['TestStepRuns', assertId(id)])
    const run = await this.tp.api<CaseRun>('GET', ['TestCaseRuns', String(step.TestCaseRun.Id)])
    await this.editable(String(run.TestPlanRun.Id))
    const meta = await this.metadata('TestStepRuns')
    const statusField = metadataField(meta, 'Status')
    let body: Record<string, unknown>
    if (statusField && statusField.CanSet !== false) {
      await this.validateStatus('TestStepRuns', status)
      body = { Status: status }
    } else {
      await this.requireField('TestStepRuns', 'Passed')
      if (!['Passed', 'Failed'].includes(status)) throw new Error('This tenant represents step results with Passed; use Passed or Failed')
      body = { Passed: status === 'Passed' }
      if (metadataField(meta, 'Runned')?.CanSet === true) body.Runned = true
    }
    await this.tp.api('POST', ['TestStepRuns', id], body)
    const after = await this.tp.api<StepRun>('GET', ['TestStepRuns', id])
    const actual = after as unknown as Record<string, unknown>
    if (Object.entries(body).some(([key, value]) => actual[key] !== value)) throw new Error('Step run result could not be verified')
    return after
  }

  async batchResults(results: ExecutionInput[]) {
    if (new Set(results.map(result => result.id)).size !== results.length) throw new Error('Case run IDs must be unique')
    const updated: CaseRun[] = [], failed = []
    for (const result of results) {
      try { updated.push(await this.updateCaseRun(result)) }
      catch (error) { failed.push({ id: result.id, error: errorDetails(error) }) }
    }
    return { updated, failed }
  }

  async linkBug(testCaseRunId: string, bugId: string) {
    const run = await this.tp.api<CaseRun>('GET', ['TestCaseRuns', assertId(testCaseRunId)])
    await this.editable(String(run.TestPlanRun.Id))
    await this.tp.api('GET', ['Bugs', assertId(bugId)])
    await this.requireField('TestCaseRuns', 'Bugs', true)
    const before = await this.tp.apiAll<Ref>(['TestCaseRuns', testCaseRunId, 'Bugs'])
    if (before.some(bug => String(bug.Id) === bugId)) return { alreadyLinked: true, testCaseRunId, bugId }
    await this.tp.api('POST', ['TestCaseRuns', testCaseRunId], { Bugs: { Items: [{ Id: bugId }] } })
    const after = await this.tp.apiAll<Ref>(['TestCaseRuns', testCaseRunId, 'Bugs'])
    if (!after.some(bug => String(bug.Id) === bugId) || before.some(bug => !after.some(item => item.Id === bug.Id))) throw new Error('Bug relation verification failed')
    return { testCaseRunId, bugId, verified: true }
  }

  async summary(id: string) {
    const snapshot = await this.getRun(id)
    const counts: Record<string, number> = {}
    for (const run of snapshot.caseRuns) counts[run.Status || 'NotRun'] = (counts[run.Status || 'NotRun'] || 0) + 1
    const bugs = []
    for (const runId of snapshot.runIds) bugs.push(...await this.tp.apiAll<Ref>(['TestPlanRuns', String(runId), 'Bugs']))
    return { id, run: snapshot.run, runIds: snapshot.runIds, total: snapshot.caseRuns.length, counts,
      caseResults: snapshot.caseRuns.map(run => ({ id: run.Id, name: run.Name, status: run.Status, actualResult: run.Comment, testCase: run.TestCase, testPlanRun: run.TestPlanRun, tester: run.LastExecutor, runDate: run.EndRunDate || run.RunDate || run.StartRunDate, startRunDate: run.StartRunDate, endRunDate: run.EndRunDate })),
      outstanding: snapshot.caseRuns.filter(run => !terminal(run.Status)),
      bugs: [...new Map(bugs.map(bug => [bug.Id, bug])).values()] }
  }

  history(testCaseId: string, take = 50, skip = 0) {
    return this.tp.api('GET', ['TestCases', assertId(testCaseId), 'TestCaseRuns'], undefined, { take, skip })
  }

  async coverage(resourceId: string) {
    const entity = await this.tp.api<{ Id: number; Name: string; LinkedTestPlan?: Ref }>('GET', ['Generals', assertId(resourceId)])
    if (!entity?.LinkedTestPlan?.Id) return { id: entity.Id, name: entity.Name, hasLinkedTestPlan: false, testCases: [], caseCount: 0 }
    const cases = await this.tp.getTestPlanTestCases<TpResponse<TestCase>>(String(entity.LinkedTestPlan.Id))
    if (!cases?.Items) throw new Error('Cannot read requirement test coverage')
    const unique = [...new Map(cases.Items.map(item => [item.Id, item])).values()]
    return { id: entity.Id, name: entity.Name, testPlan: entity.LinkedTestPlan, caseCount: unique.length, testCases: unique,
      interpretation: 'Linked test inventory only; this does not prove requirement completeness or execution success' }
  }

  async upload(generalId: string, source: { filePath: string } | { fileContent: string; fileName: string }) {
    const fileName = 'filePath' in source ? basename(source.filePath) : source.fileName
    if ('filePath' in source && !isAbsolute(source.filePath)) throw new Error('Use an absolute path on the MCP server host')
    const size = 'filePath' in source ? statSync(source.filePath).size : Buffer.from(source.fileContent, 'base64').length
    if (size > 25 * 1024 * 1024) throw new Error('Attachments must be at most 25 MiB')
    const target = await this.tp.api<Ref & { ResourceType?: string }>('GET', ['Generals', assertId(generalId)])
    if (target.ResourceType === 'TestPlanRun') await this.editable(generalId)
    const before = new Set((await this.attachments(generalId)).map(file => file.Id))
    const response = await this.tp.addAttachedFile(generalId, source)
    if (!response) throw new Error('Upload returned an empty response; inspect attachments before retrying')
    const newFiles = (await this.attachments(generalId)).filter(file => !before.has(file.Id) && file.Name === fileName && (file.Size === undefined || file.Size === size))
    if (newFiles.length !== 1) throw new Error('Upload could not be uniquely verified; inspect attachments before retrying')
    return { generalId, attachments: newFiles }
  }

  async uploadRunEvidence(testCaseRunId: string, source: { filePath: string } | { fileContent: string; fileName: string }) {
    const run = await this.tp.api<CaseRun>('GET', ['TestCaseRuns', assertId(testCaseRunId)])
    await this.editable(String(run.TestPlanRun.Id))
    const result = await this.upload(String(run.TestPlanRun.Id), source)
    const note = (run.Comment || '') + '\nEvidence for TestCaseRun ' + testCaseRunId + ': attachment IDs ' + result.attachments.map(file => file.Id).join(', ')
    await this.tp.api('POST', ['TestCaseRuns', testCaseRunId], { Comment: note })
    const after = await this.tp.api<CaseRun>('GET', ['TestCaseRuns', testCaseRunId])
    if (after.Comment !== note) throw new Error('File uploaded but case-run evidence note could not be verified; do not re-upload')
    return { ...result, testCaseRunId }
  }
}
