import type { TpClient } from '../tp.js'

export async function handleUpdateFeature(
  tp: TpClient,
  params: {
    id: string
    title?: string
    description?: string
    epicId?: string
    releaseId?: string
    projectId?: string
    teamId?: string
    entityStateId?: string
    tags?: string
    teamIterationId?: string
  },
) {
  const response = await tp.updateFeature(params)

  if (!response) {
    return {
      content: [{
        type: 'text' as const,
        text: `Failed to update feature id: ${params.id}\n JSON: ${JSON.stringify(response, null, 2)}`
      }],
    }
  }

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(response) }],
  }
}
