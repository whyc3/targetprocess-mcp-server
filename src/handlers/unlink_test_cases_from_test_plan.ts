import type { TpClient } from '../tp.js'

export async function handleUnlinkTestCasesFromTestPlan(
  tp: TpClient,
  params: { testPlanId: string, testCaseIds: string[], dryRun?: boolean },
) {
  const result = await tp.unlinkTestCasesFromTestPlan(params)
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
  }
}
