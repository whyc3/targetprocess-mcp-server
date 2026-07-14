import type { TpClient } from '../tp.js'

export async function handleDeleteCard(tp: TpClient, params: { id: string, type: "Bug" | "UserStory" | "Feature" | "Epic" }) {
  const result = await tp.deleteCard(params)

  if (!result.ok) {
    return {
      content: [{
        type: 'text' as const,
        text: `Failed to delete ${params.type} id: ${params.id}\n` +
          `HTTP status: ${result.status}\n` +
          `Response body: ${result.body}`
      }],
    }
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ deleted: true, id: Number(params.id), type: params.type, card: result.data })
    }],
  }
}
