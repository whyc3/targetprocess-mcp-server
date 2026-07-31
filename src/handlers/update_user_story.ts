import type { TpClient } from '../tp.js'
import { validateTagMutation } from '../tags.js'

export async function handleUpdateUserStory(
  tp: TpClient,
  params: {
    id: string
    title?: string
    description?: string
    projectId?: string
    teamId?: string
    entityStateId?: string
    featureId?: string
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

  const response = await tp.updateUserStory<any>(params)

  if (!response) {
    return {
      content: [{
        type: 'text' as const,
        text: `Failed to update user story id: ${params.id}\n JSON: ${JSON.stringify(response, null, 2)}`
      }]
    }
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(response)
    }],
  }
}
