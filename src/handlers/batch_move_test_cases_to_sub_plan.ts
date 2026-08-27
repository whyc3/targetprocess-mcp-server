import type { TpClient } from '../tp.js'

export async function handleBatchMoveTestCasesToSubPlan(
  tp: TpClient,
  params: {
    sourceTestPlanId: string
    destinationTestPlanId: string
    testCaseIds: string[]
    batchSize?: number
    dryRun?: boolean
  },
) {
  const result = await tp.batchMoveTestCasesToSubPlan(params)
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
  }
}
