import type { TpClient } from '../tp.js'
import type * as TP from '../types.js'

export async function handleDeleteTestCaseStepById(tp: TpClient, id: string) {
  const result = await tp.deleteTestStep<TP.TestStep>(id)

  if (!result.ok) {
    return {
      content: [{
        type: 'text' as const,
        text: `Failed to delete test step id: ${id}\n` +
          `HTTP status: ${result.status}\n` +
          `Response body: ${result.body}`
      }],
    }
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ deleted: true, testStepId: Number(id), testStep: result.data })
    }],
  }
}
