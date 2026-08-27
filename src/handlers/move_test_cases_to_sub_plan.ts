import type { TpClient } from '../tp.js'

export async function handleMoveTestCasesToSubPlan(
  tp: TpClient,
  params: {
    sourceTestPlanId: string
    destinationTestPlanId: string
    testCaseIds: string[]
    dryRun?: boolean
  },
) {
  const result = await tp.moveTestCasesToSubPlan(params)
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
  }
}
