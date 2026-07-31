import type { TpClient } from '../tp.js'
import { hasTagMutation, validateTagMutation } from '../tags.js'

export async function handleUpdateTestCaseById(
  tp: TpClient,
  params: {
    id: string
    name?: string
    description?: string
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

  if (params.name === undefined && params.description === undefined && !hasTagMutation(params)) {
    return {
      content: [{
        type: 'text' as const,
        text: `Nothing to update for test case id: ${params.id}`
      }],
    }
  }

  const testCaseResponse = await tp.updateTestCase<any>(params)

  if (!testCaseResponse) {
    return {
      content: [{
        type: 'text' as const,
        text: `Failed to update test case id: ${params.id}\n JSON: ${JSON.stringify(testCaseResponse, null, 2)}`
      }],
    }
  }

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(testCaseResponse) }],
  }
}
