import { JSDOM } from 'jsdom'
import type { TpClient } from '../tp.js'
import { parseTags } from '../tags.js'
import type * as TP from '../types.js'

export async function handleGetTestCaseById(tp: TpClient, id: string) {
  const testCase = await tp.getTestCase<TP.TestCase>(id)

  if (!testCase) {
    return {
      isError: true,
      content: [{
        type: 'text' as const,
        text: `Failed to get test case id: ${id}\n JSON: ${JSON.stringify(testCase, null, 2)}`
      }],
    }
  }

  let description = ''
  if (testCase.Description) {
    try {
      const dom = new JSDOM(`<html><body><div id="content">${testCase.Description}</div></body></html>`)
      description = dom.window.document.getElementById('content')?.textContent || ''
    } catch (error) {
      console.error('Error parsing test case description:', error)
    }
  }

  const testCaseSteps = await tp.getTestCaseSteps<TP.TpResponse<TP.TestStep>>(String(testCase.Id))

  if (!testCaseSteps) return { isError: true, content: [{ type: 'text' as const, text: 'Failed to get test steps for test case id: ' + id }] }

  const result = {
    id: testCase.Id,
    name: testCase.Name,
    description,
    tags: parseTags(testCase.Tags),
    projectId: testCase.Project?.Id,
    testPlans: testCase.TestPlans?.Items?.map(plan => ({ id: plan.Id, name: plan.Name })) ?? (testCase.LinkedTestPlan ? [{ id: testCase.LinkedTestPlan.Id, name: testCase.LinkedTestPlan.Name }] : []),
    testPlan: testCase.TestPlans?.Items?.[0]?.Name ?? testCase.LinkedTestPlan?.Name,
    steps: testCaseSteps.Items?.slice().sort((a, b) => a.RunOrder - b.RunOrder).map((step) => ({
      id: step.Id,
      description: step.Description,
      result: step.Result,
      runOrder: step.RunOrder,
    })) || [],
  }

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
  }
}
