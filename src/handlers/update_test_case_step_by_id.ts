import type { TpClient } from '../tp.js'
import type * as TP from '../types.js'

export async function handleUpdateTestCaseStepById(
  tp: TpClient,
  params: {
    id: string
    description?: string
    result?: string
  },
) {
  if (params.description === undefined && params.result === undefined) {
    return {
      content: [{
        type: 'text' as const,
        text: `Nothing to update for test step id: ${params.id}`
      }],
    }
  }

  const existingTestStep = await tp.getTestStep<TP.TestStep>(params.id)

  if (!existingTestStep) {
    return {
      content: [{
        type: 'text' as const,
        text: `Failed to get test step id: ${params.id}\n JSON: ${JSON.stringify(existingTestStep, null, 2)}`
      }],
    }
  }

  const testStepResponse = await tp.updateTestStep<TP.TestStep>({
    id: params.id,
    description: params.description ?? existingTestStep.Description,
    result: params.result ?? existingTestStep.Result,
  })

  if (!testStepResponse) {
    return {
      content: [{
        type: 'text' as const,
        text: `Failed to update test step id: ${params.id}\n JSON: ${JSON.stringify(testStepResponse, null, 2)}`
      }],
    }
  }

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(testStepResponse) }],
  }
}
