import type { TpClient } from '../tp.js'
import type * as TP from '../types.js'

export async function handleCreateNestedTestPlan(
  tp: TpClient,
  params: { title: string, parentTestPlanId: string, description?: string },
) {
  const testPlan = await tp.createNestedTestPlan<TP.TestPlan>(params)

  if (!testPlan) {
    return {
      content: [{
        type: 'text' as const,
        text: `Failed to create sub test plan "${params.title}" beneath test plan ${params.parentTestPlanId}`,
      }],
    }
  }

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(testPlan) }],
  }
}
