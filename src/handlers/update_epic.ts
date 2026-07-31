import type { TpClient } from '../tp.js'
import { validateTagMutation } from '../tags.js'

export async function handleUpdateEpic(
  tp: TpClient,
  params: {
    id: string
    title?: string
    description?: string
    releaseId?: string
    projectId?: string
    tags?: string
    addTags?: string
    removeTags?: string
  },
) {
  const validationError = validateTagMutation(params)
  if (validationError) {
    return {
      content: [{ type: 'text' as const, text: validationError }],
    }
  }

  const response = await tp.updateEpic(params)

  if (!response) {
    return {
      content: [{
        type: 'text' as const,
        text: `Failed to update epic id: ${params.id}\n JSON: ${JSON.stringify(response, null, 2)}`
      }],
    }
  }

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(response) }],
  }
}
