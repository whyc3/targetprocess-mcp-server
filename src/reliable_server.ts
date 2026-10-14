import { McpServer, type RegisteredTool, type ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnySchema, ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js'
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { errorDetails } from './http.js'

export class ReliableMcpServer extends McpServer {
  override registerTool<OutputArgs extends ZodRawShapeCompat | AnySchema, InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined>(
    name: string,
    configuration: {
      title?: string; description?: string; inputSchema?: InputArgs; outputSchema?: OutputArgs
      annotations?: ToolAnnotations; _meta?: Record<string, unknown>
    },
    callback: ToolCallback<InputArgs>,
  ): RegisteredTool {
    const readOnly = /^(get_|list_|search_)/.test(name)
    const guarded = (async (...args: any[]) => {
      try {
        const result = await (callback as (...args: any[]) => any)(...args)
        return result
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: errorDetails(error) }) }] }
      }
    }) as ToolCallback<InputArgs>
    return super.registerTool(name, {
      ...configuration,
      annotations: configuration.annotations ?? {
        readOnlyHint: readOnly,
        destructiveHint: !readOnly && /^(delete_|update_|set_|move_|batch_move_|unlink_)/.test(name),
        idempotentHint: readOnly,
        openWorldHint: true,
      },
    }, guarded)
  }
}
