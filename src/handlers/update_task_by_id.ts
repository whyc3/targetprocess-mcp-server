import type { TpClient } from '../tp.js'

export async function handleUpdateTaskById(
  tp: TpClient,
  params: {
    id: string
    title?: string
    description?: string
    entityStateId?: string
  },
) {
  if (params.title === undefined && params.description === undefined && params.entityStateId === undefined) {
    return {
      content: [{
        type: 'text' as const,
        text: `Nothing to update for task id: ${params.id}`,
      }],
    }
  }

  const response = await tp.updateTask<any>(params)

  if (!response) {
    return {
      content: [{
        type: 'text' as const,
        text: `Failed to update task id: ${params.id}\n JSON: ${JSON.stringify(response, null, 2)}`,
      }],
    }
  }

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(response) }],
  }
}
