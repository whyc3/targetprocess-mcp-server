import type { TpClient } from '../tp.js'

export async function handleMoveTestCasesBetweenSiblingPlans(
  tp: TpClient,
  params: {
    parentTestPlanId: string
    sourceTestPlanId: string
    destinationTestPlanId: string
    testCaseIds: string[]
    dryRun?: boolean
  },
) {
  const result = await tp.moveTestCasesBetweenSiblingPlans(params)
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
  }
}
