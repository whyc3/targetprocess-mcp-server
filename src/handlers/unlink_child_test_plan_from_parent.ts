import type { TpClient } from '../tp.js'

export async function handleUnlinkChildTestPlanFromParent(
  tp: TpClient,
  params: { parentTestPlanId: string, childTestPlanId: string, dryRun?: boolean },
) {
  const result = await tp.unlinkChildTestPlanFromParent(params)
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
  }
}
