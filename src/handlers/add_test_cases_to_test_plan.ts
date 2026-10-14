import type { TpClient } from '../tp.js'
import type { TestCase, TestStep, TpResponse } from '../types.js'
import { errorDetails } from '../http.js'

export type CaseInput = { name: string; description: string; steps: Array<{ description: string; result: string }>; projectId?: string; tags?: string }
export type CreatedCase = {
  id: number; name: string; status: 'complete' | 'partial'; stepsAdded: number
  failedSteps: Array<{ index: number; error: ReturnType<typeof errorDetails> }>
  verificationError?: ReturnType<typeof errorDetails>
}

export async function createCaseWithSteps(tp: TpClient, testPlanId: string | undefined, input: CaseInput): Promise<CreatedCase> {
  const entity = await tp.createTestCase<TestCase>(input.name, input.description, testPlanId, { projectId: input.projectId, tags: input.tags })
  if (!entity?.Id) throw new Error('Case creation did not return an ID. Verify existing records before retrying')
  const created: CreatedCase = { id: entity.Id, name: entity.Name, status: 'complete', stepsAdded: 0, failedSteps: [] }
  const addedIds: number[] = []

  for (const [index, step] of input.steps.entries()) {
    try {
      const result = await tp.addTestStep<TestStep>(String(entity.Id), { ...step, runOrder: index + 1 })
      if (!result?.Id) throw new Error('Step creation did not return an ID; verify this step before retrying')
      addedIds.push(result.Id)
      created.stepsAdded++
    } catch (error) {
      const detail = errorDetails(error)
      created.failedSteps.push({ index: index + 1, error: detail })
      // A timed-out write might have succeeded. Stop rather than creating more uncertain records.
      if ('httpStatus' in detail && detail.httpStatus === 0) break
    }
  }
  try {
    const response = await tp.getTestCaseSteps<TpResponse<TestStep>>(String(entity.Id))
    if (!response || !Array.isArray(response.Items)) throw new Error('Cannot verify created steps')
    const actual = response.Items.slice().sort((a, b) => a.RunOrder - b.RunOrder)
    if (actual.length !== input.steps.length || addedIds.some((id, i) => actual[i]?.Id !== id)) {
      throw new Error('Step count or order could not be verified; inspect the case before retrying')
    }
    if (testPlanId) {
      const plans = await tp.getTestCaseTestPlans(String(entity.Id))
      if (!plans?.some(plan => plan.id === testPlanId)) throw new Error('Destination test plan membership could not be verified')
    }
  } catch (error) {
    created.verificationError = errorDetails(error)
  }
  if (created.failedSteps.length || created.stepsAdded !== input.steps.length || created.verificationError) created.status = 'partial'
  return created
}

export async function handleAddTestCases(tp: TpClient, testPlanId: string, testCases: CaseInput[]) {
  const created: CreatedCase[] = [], partial: CreatedCase[] = []
  const failed: Array<{ name: string; error: ReturnType<typeof errorDetails> }> = []
  let processed = 0
  for (const testCase of testCases) {
    processed++
    try {
      const result = await createCaseWithSteps(tp, testPlanId, testCase)
      if (result.status === 'complete') created.push(result)
      else partial.push(result)
    } catch (error) {
      const detail = errorDetails(error)
      failed.push({ name: testCase.name, error: detail })
      if ('httpStatus' in detail && detail.httpStatus === 0) break
    }
  }
  return {
    isError: partial.length > 0 || failed.length > 0,
    content: [{ type: 'text' as const, text: JSON.stringify({ created, partial, failed, unprocessed: testCases.slice(processed).map(testCase => testCase.name) }) }],
  }
}
