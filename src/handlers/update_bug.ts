import type { TpClient } from '../tp.js'
import { validateTagMutation } from '../tags.js'

export async function handleUpdateBug(
  tp: TpClient,
  params: {
    id: string
    title?: string
    bugContent?: string
    origin?: string
    projectId?: string
    teamId?: string
    entityStateId?: string
    tags?: string
    addTags?: string
    removeTags?: string
    teamIterationId?: string
  },
) {
  const validationError = validateTagMutation(params)
  if (validationError) {
    return {
      content: [{ type: 'text' as const, text: validationError }],
    }
  }

  const bugResponse = await tp.updateBug<any>(params)

  if (!bugResponse) {
    return {
      content: [{
        type: 'text' as const,
        text: `Failed to update bug "${params.title}"\n JSON: ${JSON.stringify(bugResponse, null, 2)}`
      }],
    }
  }

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(bugResponse) }],
  }
}
