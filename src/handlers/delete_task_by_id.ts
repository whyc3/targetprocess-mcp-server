import type { TpClient } from '../tp.js'
import type * as TP from '../types.js'

export async function handleDeleteTaskById(tp: TpClient, id: string) {
  const result = await tp.deleteTask<TP.Task>(id)

  if (!result.ok) {
    return {
      content: [{
        type: 'text' as const,
        text: `Failed to delete task id: ${id}\n` +
          `HTTP status: ${result.status}\n` +
          `Response body: ${result.body}`,
      }],
    }
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ deleted: true, taskId: Number(id), task: result.data }),
    }],
  }
}
