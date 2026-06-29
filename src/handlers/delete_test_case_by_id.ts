import type { TpClient } from '../tp.js'
import type * as TP from '../types.js'

export async function handleDeleteTestCaseById(tp: TpClient, id: string) {
  const result = await tp.deleteTestCase<TP.TestCase>(id)

  if (!result.ok) {
    return {
      content: [{
        type: 'text' as const,
        text: `Failed to delete test case id: ${id}\n` +
          `HTTP status: ${result.status}\n` +
          `Response body: ${result.body}`
      }],
    }
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ deleted: true, testCaseId: Number(id), testCase: result.data })
    }],
  }
}
