export type TagMutationParams = {
  tags?: string
  addTags?: string
  removeTags?: string
}

export type TaggableEntityType = 'Bug' | 'UserStory' | 'Feature' | 'Epic' | 'TestCase'

export function parseTags(value: string | undefined): string[] {
  if (!value) {
    return []
  }

  return value
    .split(/[;,]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
}

export function serializeTags(tags: string[]): string {
  return uniqueTags(tags).join(', ')
}

export function hasTagMutation(params: TagMutationParams): boolean {
  return params.tags !== undefined || params.addTags !== undefined || params.removeTags !== undefined
}

export function validateTagMutation(params: TagMutationParams): string | null {
  if (params.tags !== undefined && (params.addTags !== undefined || params.removeTags !== undefined)) {
    return 'Use either "tags" or "addTags"/"removeTags", not both.'
  }

  return null
}

export function applyTagMutation(currentTags: string | undefined, params: TagMutationParams): string | undefined {
  const validationError = validateTagMutation(params)
  if (validationError) {
    throw new Error(validationError)
  }

  if (!hasTagMutation(params)) {
    return undefined
  }

  if (params.tags !== undefined) {
    return serializeTags(parseTags(params.tags))
  }

  const nextTags = uniqueTags(parseTags(currentTags))
  const seen = new Set(nextTags)

  for (const tag of parseTags(params.addTags)) {
    if (!seen.has(tag)) {
      nextTags.push(tag)
      seen.add(tag)
    }
  }

  const removeSet = new Set(parseTags(params.removeTags))
  return serializeTags(nextTags.filter((tag) => !removeSet.has(tag)))
}

function uniqueTags(tags: string[]): string[] {
  const unique: string[] = []
  const seen = new Set<string>()

  for (const tag of tags) {
    if (!seen.has(tag)) {
      unique.push(tag)
      seen.add(tag)
    }
  }

  return unique
}
