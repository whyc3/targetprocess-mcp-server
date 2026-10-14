import { isAbsolute } from 'node:path'
import { z } from 'zod'
import type { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { TpClient } from './tp.js'
import { TestManagement } from './test_management.js'
import { errorDetails } from './http.js'

const id = z.string().regex(/^[1-9]\d*$/, 'Use a positive integer ID')
const text = z.string().trim().min(1)
const pagination = { take: z.number().int().min(1).max(100).default(50), skip: z.number().int().min(0).default(0) }
const step = z.object({ description: text, result: text })
const caseFields = {
  name: text, description: z.string().default(''), projectId: id.optional(), tags: z.string().optional(),
  testPlanId: id.optional(), steps: z.array(step).max(200).default([]),
}
const execution = {
  id, status: text.describe('Exact status supported by this tenant, e.g. Passed or Failed; inspect test-management metadata for other values'),
  comment: text.describe('Observed result or reason; expected-result text is not execution evidence'),
  evidenceAttachmentIds: z.array(id).min(1).max(20).describe('Screenshot IDs attached to this exact Test Plan Run'),
}
const uploadFields = {
  filePath: text.refine(isAbsolute, 'Use an absolute path on the MCP server host').optional(),
  fileContent: z.string().min(1).max(35 * 1024 * 1024).refine(value =>
    /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length % 4 !== 1 &&
    Buffer.from(value, 'base64').toString('base64').replace(/=+$/, '') === value.replace(/=+$/, ''),
  'Use raw base64 content without a data URL prefix').optional(),
  fileName: text.refine(value => !/[\/\\\r\n\0]/.test(value) && value !== '.' && value !== '..', 'Use a filename without directories').optional(),
}
function uploadSource(input: { filePath?: string; fileContent?: string; fileName?: string }) {
  if (input.filePath !== undefined) {
    if (input.fileContent !== undefined || input.fileName !== undefined) throw new Error('Provide filePath alone or fileContent with fileName')
    return { filePath: input.filePath }
  }
  if (input.fileContent === undefined || input.fileName === undefined) throw new Error('Provide filePath or both fileContent and fileName')
  return { fileContent: input.fileContent, fileName: input.fileName }
}
async function result(promise: Promise<unknown>) {
  try {
    const data = await promise
    const output = data as { status?: string; failed?: unknown[]; verified?: boolean } | null
    return {
      isError: output?.status === 'partial' || Boolean(output?.failed?.length) || output?.verified === false,
      content: [{ type: 'text' as const, text: JSON.stringify(data) }],
    }
  } catch (error) {
    return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: errorDetails(error) }) }] }
  }
}

export function registerTestManagementTools(server: McpServer, tp: TpClient) {
  const management = new TestManagement(tp)
  function register<S extends z.ZodRawShape>(
    name: string, description: string, schema: S,
    callback: (params: z.infer<z.ZodObject<S>>) => Promise<unknown>, readOnly = false,
  ) {
    server.registerTool(name, {
      description, inputSchema: schema,
      annotations: { readOnlyHint: readOnly, destructiveHint: /^(update_|complete_|reopen_|reorder_|move_|unlink_)/.test(name), idempotentHint: readOnly, openWorldHint: true },
    }, (async (params: z.infer<z.ZodObject<S>>) => result(callback(params))) as unknown as ToolCallback<S>)
  }

  register('move_test_cases_between_sibling_plans', 'Move explicit direct case memberships between two direct children of the same parent. Defaults to dry run; verifies source removal before assignment and attempts verified restoration on failure. Never deletes or copies a case.',
    { parentTestPlanId: id, sourceTestPlanId: id, destinationTestPlanId: id, testCaseIds: z.array(id).min(1).max(100), dryRun: z.boolean().default(true) }, async p => {
      const moved = await tp.moveTestCasesBetweenSiblingPlans(p)
      return { ...moved, verified: moved.dryRun || (!moved.reason && moved.movedTestCaseIds.length === p.testCaseIds.length) }
    })
  register('unlink_child_test_plan_from_parent', 'Remove only one direct parent-child plan association. Defaults to dry run; both plans and all direct cases are verified as preserved.',
    { parentTestPlanId: id, childTestPlanId: id, dryRun: z.boolean().default(true) }, async p => {
      const unlinked = await tp.unlinkChildTestPlanFromParent(p)
      return { ...unlinked, verified: unlinked.dryRun || unlinked.unlinked }
    })

  register('get_test_management_metadata', 'Inspect tenant fields, relationships, and supported values before using test-management tools.',
    { resource: z.enum(['TestCases', 'TestPlans', 'TestPlanRuns', 'TestCaseRuns', 'TestStepRuns', 'TestSteps', 'EntityStates', 'Bugs', 'Attachments']) },
    p => management.metadata(p.resource), true)

  register('create_test_case', 'Create one case with optional steps and plan. Empty steps creates a draft. Project is inherited from the plan; standalone cases require projectId or TP_PROJECT_ID. Creation returns complete or partial with the created ID.',
    caseFields, p => management.createCase(p))
  register('list_test_cases', 'Search test cases independently of test plans. Returns a paginated collection; use skip/take for subsequent pages.',
    { projectId: id.optional(), keyword: text.optional(), ...pagination }, p => management.listCases(p), true)
  register('clone_test_case', 'Create a new independent case from an existing case and its ordered steps. Does not copy execution history or bugs.',
    { id, name: text, testPlanId: id.optional(), projectId: id.optional() }, p => management.cloneCase(p.id, p.name, p.testPlanId, p.projectId))
  register('link_test_cases_to_test_plan', 'Link existing cases without removing any previous plan memberships. Validates projects before writing and verifies memberships.',
    { testPlanId: id, testCaseIds: z.array(id).min(1).max(100) }, p => management.linkCases(p.testPlanId, p.testCaseIds))
  register('retry_test_case_steps', 'Resume missing steps on a partially created case without recreating the case. Existing exact matches are skipped; conflicting positions are rejected.',
    { testCaseId: id, steps: z.array(step.extend({ index: z.number().int().min(1) })).min(1).max(200) }, p => management.retrySteps(p.testCaseId, p.steps))
  register('reorder_test_steps', 'Reorder existing steps. Provide every step ID exactly once; verifies the resulting order.',
    { testCaseId: id, stepIds: z.array(id).min(1).max(200) }, p => management.reorderSteps(p.testCaseId, p.stepIds))
  register('reorder_test_cases', 'Preview or apply the order of all direct cases in one plan. Uses NumericPriority only when tenant metadata exposes it. Shared-case ordering affects other plans and requires explicit acknowledgement.',
    { testPlanId: id, testCaseIds: z.array(id).min(1).max(200), dryRun: z.boolean().default(true), acknowledgeSharedOrder: z.boolean().default(false) }, p => management.reorderCases(p.testPlanId, p.testCaseIds, p.dryRun, p.acknowledgeSharedOrder))
  register('update_test_plan', 'Update the name or description of an existing test plan and read it back.',
    { id, name: text.optional(), description: z.string().optional() }, p => management.updatePlan(p.id, p))
  register('get_test_step_by_id', 'Read an individual test step, including its ID, owning case, and order.',
    { id }, p => tp.getTestStep(p.id), true)

  register('create_test_plan_run', 'Create a new execution cycle. Targetprocess generates case/step runs automatically. Returns the created ID even if subsequent verification fails. Never retry blindly after a timeout.',
    { testPlanId: id, name: text.optional(), description: z.string().optional(), buildId: id.optional() }, p => management.createRun(p.testPlanId, p))
  register('list_test_plan_runs', 'List runs by plan or project with pagination and optional latest-run filtering.',
    { testPlanId: id.optional(), projectId: id.optional(), latestOnly: z.boolean().default(false), ...pagination }, p => management.listRuns(p), true)
  register('get_test_plan_run', 'Read a run and all generated case runs, following nested runs using tenant metadata. Fails explicitly if nested coverage cannot be established.',
    { id }, p => management.getRun(p.id), true)
  register('get_test_case_run', 'Read one execution record with its generated step runs and linked bugs.',
    { id }, p => management.getCaseRun(p.id), true)
  register('get_test_run_workflow', 'Discover valid state IDs and final-state flags from the run project process.',
    { id }, p => management.workflow(p.id), true)
  register('update_test_plan_run', 'Update an open run name, description, or non-final state. Use complete_test_plan_run for finalization.',
    { id, name: text.optional(), description: z.string().optional(), stateId: id.optional() }, p => management.updateRun(p.id, p))
  register('complete_test_plan_run', 'Move to a project-specific final state after checking all nested case runs. Outstanding cases require explicit allowIncomplete and a recorded reason.',
    { id, stateId: id, allowIncomplete: z.boolean().default(false), reason: text.optional() }, p => management.completeRun(p.id, p.stateId, p.allowIncomplete, p.reason))
  register('reopen_test_plan_run', 'Explicitly move a run to a non-final state from its workflow. Targetprocess enforces parent-run restrictions; parents are never reopened automatically.',
    { id, stateId: id }, p => management.reopenRun(p.id, p.stateId))

  register('update_test_case_run', 'Record an actual case execution result and screenshot evidence. Checks final-state restrictions and verifies saved status and notes.',
    execution, p => management.updateCaseRun(p))
  register('update_test_step_run', 'Set a generated step run result, e.g. Passed or Failed. Maps to the tenant-supported Status or Passed/Runned fields using metadata. Checks the parent run and verifies persistence.',
    { id, status: text }, p => management.updateStepRun(p.id, p.status))
  register('batch_update_test_case_runs', 'Record actual results for explicit case-run IDs. Returns per-record successes and failures; never creates cases or runs.',
    { results: z.array(z.object(execution)).min(1).max(100) }, p => management.batchResults(p.results))

  register('upload_attachment', 'Upload exactly one local file or base64 file to a General entity and verify the new attachment. For execution screenshots use attach_test_run_evidence.',
    { generalId: id, ...uploadFields }, async p => management.upload(p.generalId, uploadSource(p)))
  register('list_attachments', 'List all attachments on a General entity, with attachment IDs, names, MIME types, and URLs.',
    { generalId: id }, p => management.attachments(p.generalId), true)
  register('attach_test_run_evidence', 'Upload evidence to the parent Test Plan Run and record the attachment IDs in the exact Test Case Run note. This avoids assuming TestCaseRun is a General entity.',
    { testCaseRunId: id, ...uploadFields }, async p => management.uploadRunEvidence(p.testCaseRunId, uploadSource(p)))
  register('link_bug_to_test_case_run', 'Link an existing bug to an execution through the Bugs relationship, after metadata validation. Preserves previous bug links and verifies the result.',
    { testCaseRunId: id, bugId: id }, p => management.linkBug(p.testCaseRunId, p.bugId))

  register('get_test_run_summary', 'Summarize all case-run results across the run hierarchy, outstanding cases, and linked defects.',
    { id }, p => management.summary(p.id), true)
  register('get_test_case_history', 'Read paginated execution history for one case. This is execution evidence, separate from expected results.',
    { testCaseId: id, ...pagination }, p => management.history(p.testCaseId, p.take, p.skip), true)
  register('get_requirement_test_coverage', 'Read linked case inventory for a work item including nested plans. Case counts do not prove requirement completeness or successful execution.',
    { resourceId: id }, p => management.coverage(p.resourceId), true)
}
