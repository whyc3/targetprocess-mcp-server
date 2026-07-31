import type { TpClient } from '../tp.js'
import { hasTagMutation, validateTagMutation, type TaggableEntityType } from '../tags.js'

export async function handleUpdateCardTags(
  tp: TpClient,
  params: {
    entityType: TaggableEntityType
    ids: string[]
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

  if (!hasTagMutation(params)) {
    return {
      content: [{ type: 'text' as const, text: 'Provide at least one tag update field: tags, addTags, or removeTags.' }],
    }
  }

  const response = await tp.updateCardTags<any>(params)

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        entityType: params.entityType,
        requested: params.ids.length,
        succeeded: response.succeeded,
        failed: response.failed,
      })
    }],
  }
}
