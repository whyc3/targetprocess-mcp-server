import type { TpClient } from '../tp.js'
import type * as TP from '../types.js'

export async function handleCreateBug(
  tp: TpClient,
  params: {
    title: string
    bugContent: string
    origin?: string
    releaseId?: string
    projectId?: string
    teamId?: string
    entityStateId?: string
    tags?: string
    teamIterationId?: string
  },
) {
  let bugResponse: TP.Bug
  try {
    bugResponse = await tp.createBugOnly<TP.Bug>(params)
  } catch (error) {
    return {
      content: [{
        type: 'text' as const,
        text: `Failed to create bug "${params.title}": ${error instanceof Error ? error.message : String(error)}`,
      }],
    }
  }

  if (!bugResponse) {
    return {
      content: [{
        type: 'text' as const,
        text: `Failed to create bug "${params.title}"\n JSON: ${JSON.stringify(bugResponse, null, 2)}`
      }],
    }
  }

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(bugResponse) }],
  }
}
