import type { TpClient } from '../tp.js'
import type * as TP from '../types.js'

export async function handleAddTestCaseStepById(
  tp: TpClient,
  params: {
    testCaseId: string
    description: string
    result: string
  },
) {
  const testStepResponse = await tp.addTestStep<TP.TestStep>(params.testCaseId, {
    description: params.description,
    result: params.result,
  })

  if (!testStepResponse) {
    return {
      content: [{
        type: 'text' as const,
        text: `Failed to add test step to test case id: ${params.testCaseId}\n JSON: ${JSON.stringify(testStepResponse, null, 2)}`
      }],
    }
  }

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(testStepResponse) }],
  }
}
