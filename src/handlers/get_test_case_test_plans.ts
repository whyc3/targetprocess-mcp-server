import type { TpClient } from '../tp.js'

export async function handleGetTestCaseTestPlans(tp: TpClient, testCaseId: string) {
  const testPlans = await tp.getTestCaseTestPlans(testCaseId)
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        testCaseId,
        found: testPlans !== null,
        testPlans: testPlans || [],
      }),
    }],
  }
}
