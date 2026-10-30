import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const client = new Client({ name: 'targetprocess-integration-validation', version: '1.0.0' })
const transport = new StdioClientTransport({
  command: process.execPath, args: [path.join(root, 'build', 'index.js')], cwd: root,
  env: Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)),
  stderr: 'pipe',
})
const mode = process.argv[2] || 'inspect'
const statePath = path.join(root, 'validation', 'live-state.json')
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {}
const parentPlanId = process.env.TP_SMOKE_PARENT_PLAN_ID || state.parentPlanId
function save() { fs.mkdirSync(path.dirname(statePath), { recursive: true }); fs.writeFileSync(statePath, JSON.stringify(state, null, 2)) }
async function call(name, args = {}) {
  const response = await client.callTool({ name, arguments: args })
  const text = response.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
  if (response.isError) throw new Error(name + ': ' + text)
  try { return JSON.parse(text) } catch { return text }
}
function names(value, result = new Set()) {
  if (!value || typeof value !== 'object') return result
  for (const [key, child] of Object.entries(value)) {
    if (key.toLowerCase() === 'name' && typeof child === 'string') result.add(child)
    if (typeof child === 'object') names(child, result)
  }
  return result
}
try {
  await client.connect(transport)
  if (mode === 'inspect') {
    console.log(JSON.stringify({ version: client.getServerVersion()?.version, toolCount: (await client.listTools()).tools.length }))
    if (!parentPlanId) throw new Error('Set TP_SMOKE_PARENT_PLAN_ID to the explicitly authorized QA parent plan')
    const plan = await call('get_test_plan_by_id', { id: parentPlanId })
    console.log(JSON.stringify({ plan }))
    for (const resource of ['TestCases', 'TestPlans', 'TestPlanRuns', 'TestCaseRuns', 'TestStepRuns', 'Attachments']) {
      const meta = await call('get_test_management_metadata', { resource })
      const all = [...names(meta)]
      console.log(JSON.stringify({ resource, rootKeys: Object.keys(meta), fields: all.filter(name => /Parent|Child|Test|Status|State|NumericPriority|RunOrder|Bug|Comment|Attachment|General|Build|Final|Date|User/i.test(name)).slice(0, 100) }))
    }
  } else if (mode === 'inspect-details') {
    for (const resource of ['Bugs']) {
      const meta = await call('get_test_management_metadata', { resource })
      const selected = []
      const scan = value => {
        if (!value || typeof value !== 'object') return
        if (['Status', 'Passed', 'IsPassed', 'Result', 'Description', 'RunOrder', 'Runned', 'IsFinal', 'TestCaseRuns', 'Bugs', 'TestCaseRunLinks'].includes(value.Name)) selected.push(value)
        for (const child of Object.values(value)) if (typeof child === 'object') scan(child)
      }
      scan(meta)
      console.log(JSON.stringify({ resource, canUpdate: meta.CanUpdate, names: [...names(meta)], selected }))
    }
  } else if (mode === 'prepare') {
    if (!parentPlanId) throw new Error('Set TP_SMOKE_PARENT_PLAN_ID to an explicitly authorized QA parent plan')
    state.parentPlanId = parentPlanId
    state.label ||= '[MCP smoke test] ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
    const parent = await call('get_test_plan_by_id', { id: state.parentPlanId })
    state.projectId = String(parent.projectId); save()
    if (!state.childPlanId) {
      if (state.childAttempted) throw new Error('A previous child-plan write was attempted; verify its outcome before retrying')
      state.childAttempted = true; save()
      const child = await call('create_nested_test_plan', { parentTestPlanId: state.parentPlanId, title: state.label, description: 'Isolated integration validation for Targetprocess MCP 2.7.0. Sample records only; no ERP functional validation.' })
      state.childPlanId = String(child.Id); save()
    }
    if (!state.caseId) {
      if (state.caseAttempted) throw new Error('A previous case write was attempted; verify its outcome before retrying')
      state.caseAttempted = true; save()
      const created = await call('create_test_case', { testPlanId: state.childPlanId, name: '[MCP smoke test] Verify generated execution records', description: '<p>Integration fixture. Environment: authorized Targetprocess QA project. MCP build: local 2.7.0. Precondition: isolated child plan under the authorized QA parent. This is not an ERP product test.</p>', steps: [
        { description: 'Read the generated case run through the MCP server.', result: 'The source case and parent plan-run IDs match the created fixture.' },
        { description: 'Read the generated step runs through the MCP server.', result: 'Both source steps appear in the same order with readable expected results.' },
      ] })
      state.caseId = String(created.id); save()
    }
    if (!state.runId) {
      if (state.runAttempted) throw new Error('A previous run write was attempted; verify its outcome before retrying')
      state.runAttempted = true; save()
      const created = await call('create_test_plan_run', { testPlanId: state.childPlanId, name: state.label, description: 'Authorized MCP integration smoke test. Stage: authorized Targetprocess QA project; MCP build: local 2.7.0. Only sample records in this isolated child plan are executed.' })
      state.runId = String(created.id); save()
    }
    const snapshot = await call('get_test_plan_run', { id: state.runId })
    const run = snapshot.caseRuns.find(item => String(item.TestCase?.Id) === state.caseId)
    if (!run) throw new Error('The generated case run was not found; inspect the existing run')
    state.caseRunId = String(run.Id); save()
    const details = await call('get_test_case_run', { id: state.caseRunId })
    state.stepRunIds = details.stepRuns.map(step => String(step.Id))
    state.observed = { sourceCaseMatches: String(details.TestCase.Id) === state.caseId, parentRunMatches: String(details.TestPlanRun.Id) === state.runId, stepCount: details.stepRuns.length, expectedStepCount: 2 }
    state.preparedAt = new Date().toISOString(); save()
    console.log(JSON.stringify({ parentPlanId: state.parentPlanId, childPlanId: state.childPlanId, caseId: state.caseId, runId: state.runId, caseRunId: state.caseRunId, stepRunIds: state.stepRunIds, observed: state.observed }))
  } else if (mode === 'execute') {
    if (!state.caseRunId || !state.runId) throw new Error('Prepare the isolated fixture first')
    if (!state.observed?.sourceCaseMatches || !state.observed?.parentRunMatches || state.observed.stepCount !== 2) throw new Error('Observed fixture checks did not pass')
    if (!state.evidenceAttachmentIds) {
      if (state.evidenceAttempted) throw new Error('An evidence upload was already attempted; inspect attachments before retrying')
      state.evidenceAttempted = true; save()
      const evidence = await call('attach_test_run_evidence', { testCaseRunId: state.caseRunId, filePath: path.join(root, 'validation', 'mcp-smoke-evidence.png') })
      state.evidenceAttachmentIds = evidence.attachments.map(file => String(file.Id)); save()
    }
    state.stepResults = []
    for (const id of state.stepRunIds) {
      const step = await call('update_test_step_run', { id, status: 'Passed' })
      state.stepResults.push({ id, Passed: step.Passed, Runned: step.Runned, Status: step.Status }); save()
    }
    const caseRun = await call('update_test_case_run', { id: state.caseRunId, status: 'Passed', comment: 'Observed via MCP on ' + state.preparedAt + ': generated case run maps to source case ' + state.caseId + ' and plan run ' + state.runId + '; both generated step records appear in the expected order. This is an integration fixture, not ERP release validation.', evidenceAttachmentIds: state.evidenceAttachmentIds })
    state.caseStatus = caseRun.Status; state.executedAt = new Date().toISOString(); save()
    console.log(JSON.stringify({ caseRunId: state.caseRunId, status: state.caseStatus, evidenceAttachmentIds: state.evidenceAttachmentIds, stepResults: state.stepResults }))
  } else if (mode === 'finish') {
    if (state.caseStatus !== 'Passed' || !state.evidenceAttachmentIds?.length) throw new Error('Execute the fixture and attach evidence first')
    if (!state.bugId) {
      if (state.bugAttempted) throw new Error('A sample-defect write was attempted; verify its outcome before retrying')
      const teamId = process.env.TP_SMOKE_TEAM_ID
      state.bugAttempted = true; save()
      const created = await call('create_bug', { title: '[MCP SAMPLE - NOT A PRODUCT DEFECT] Execution relation smoke test', projectId: state.projectId, ...(teamId ? { teamId: String(teamId) } : {}), tags: 'mcp-smoke-test,sample-not-product-defect', bugContent: '<h2>Environment</h2><p>Authorized Targetprocess QA project. Local MCP build 2.7.0. Authorized integration fixture only.</p><h2>URLs</h2><p>Child plan ' + state.childPlanId + '; run ' + state.runId + '; case run ' + state.caseRunId + '.</p><h2>Steps to Reproduce</h2><ol><li>Read the generated fixture case and step runs through MCP.</li><li>Attach the observed screenshot.</li><li>Link this explicitly labelled sample defect to the case run.</li></ol><h2>Current Behavior</h2><p>The integration fixture checks passed. This sample record exists solely to verify the execution-defect relationship; it reports no product failure.</p><h2>Expected Behavior</h2><p>The MCP preserves and verifies this sample relationship and screenshot evidence.</p><h2>Additional Information</h2><p>Screenshot evidence is attached immediately after creation. This is not a release-blocking defect or ERP validation.</p>' })
      if (!created?.Id) throw new Error('Sample defect creation returned no ID; verify its outcome')
      state.bugId = String(created.Id); save()
    }
    if (!state.bugAttachmentIds) {
      const uploaded = await call('upload_attachment', { generalId: state.bugId, filePath: path.join(root, 'validation', 'mcp-smoke-evidence.png') })
      state.bugAttachmentIds = uploaded.attachments.map(file => String(file.Id)); save()
    }
    const linked = await call('link_bug_to_test_case_run', { testCaseRunId: state.caseRunId, bugId: state.bugId })
    state.bugLinkVerified = linked.verified || linked.alreadyLinked; save()
    const summary = await call('get_test_run_summary', { id: state.runId })
    if (summary.total !== 1 || summary.counts.Passed !== 1 || !summary.bugs.some(bug => String(bug.Id) === state.bugId)) throw new Error('Execution summary did not match the fixture results')
    state.summary = { total: summary.total, counts: summary.counts, bugIds: summary.bugs.map(bug => bug.Id) }; save()
    const states = await call('get_test_run_workflow', { id: state.runId })
    const finals = states.filter(value => value.IsFinal)
    const final = finals.find(value => /^done$/i.test(value.Name)) || (finals.length === 1 ? finals[0] : undefined)
    const initial = states.find(value => value.IsInitial && !value.IsFinal) || states.find(value => value.IsFinal === false)
    if (!final || !initial) throw new Error('Cannot unambiguously select completion and reopening states')
    const completed = await call('complete_test_plan_run', { id: state.runId, stateId: String(final.Id) })
    state.finalStateId = String(completed.EntityState.Id); save()
    const blocked = await client.callTool({ name: 'update_test_plan_run', arguments: { id: state.runId, description: 'This guard-check text must never be saved.' } })
    if (!blocked.isError) throw new Error('The final-state write guard did not reject the update')
    state.finalWriteRejected = true; save()
    const reopened = await call('reopen_test_plan_run', { id: state.runId, stateId: String(initial.Id) })
    if (String(reopened.EntityState.Id) !== String(initial.Id)) throw new Error('Run reopening was not verified')
    state.reopenVerified = true; save()
    await call('complete_test_plan_run', { id: state.runId, stateId: String(final.Id) })
    state.completedAt = new Date().toISOString(); delete state.lastError; save()
    console.log(JSON.stringify({ childPlanId: state.childPlanId, caseId: state.caseId, runId: state.runId, caseRunId: state.caseRunId, bugId: state.bugId, evidenceAttachmentIds: state.evidenceAttachmentIds, bugAttachmentIds: state.bugAttachmentIds, summary: state.summary, finalWriteRejected: state.finalWriteRejected, reopenVerified: state.reopenVerified, finalStateId: state.finalStateId }))
  } else if (mode === 'verify') {
    if (!state.completedAt) throw new Error('Finish the isolated validation first')
    const summary = await call('get_test_run_summary', { id: state.runId })
    const history = await call('get_test_case_history', { testCaseId: state.caseId, take: 10, skip: 0 })
    const listed = await call('list_test_cases', { projectId: state.projectId, keyword: '[MCP smoke test] Verify generated execution records', take: 10, skip: 0 })
    const preservedPreview = await call('unlink_child_test_plan_from_parent', { parentTestPlanId: state.parentPlanId, childTestPlanId: state.childPlanId, dryRun: true })
    if (!preservedPreview.canUnlink || preservedPreview.unlinked) throw new Error('The preserved unlink tool did not provide a safe dry run')
    const preview = await call('reorder_test_cases', { testPlanId: state.childPlanId, testCaseIds: [state.caseId], dryRun: true })
    if (!history.Items.some(item => String(item.Id) === state.caseRunId && item.Status === 'Passed')) throw new Error('Execution history did not contain the passed fixture')
    if (!listed.Items.some(item => String(item.Id) === state.caseId)) throw new Error('Case search did not contain the fixture')
    if (String(summary.run.EntityState.Id) !== state.finalStateId || summary.counts.Passed !== 1) throw new Error('Final run summary differs from expected')
    state.readChecks = { history: true, caseSearch: true, orderingPreview: true }; state.verifiedAt = new Date().toISOString(); state.finalStateName = summary.run.EntityState.Name; delete state.lastError; save()
    console.log(JSON.stringify({ version: client.getServerVersion().version, toolCount: (await client.listTools()).tools.length, runId: state.runId, finalState: summary.run.EntityState.Name, total: summary.total, counts: summary.counts, historyVerified: true, caseSearchVerified: true, orderPreviewVerified: preview.dryRun === true, caseResults: summary.caseResults.map(item => ({ id: item.id, status: item.status, hasActualResult: Boolean(item.actualResult), hasTester: Boolean(item.tester), hasRunDate: Boolean(item.runDate), hasStartDate: Boolean(item.startRunDate), hasEndDate: Boolean(item.endRunDate) })) }))
  } else {
    throw new Error('Unsupported validation mode: ' + mode)
  }
} catch (error) {
  state.lastError = error.message; save()
  console.error(error.message)
  process.exitCode = 1
} finally {
  await client.close()
  await transport.close()
}
