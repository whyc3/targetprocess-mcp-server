import { JSDOM } from 'jsdom'
import type { TpClient } from '../tp.js'
import { config } from '../config.js'
import type * as TP from '../types.js'

type SearchableEntity = TP.General & {
  EntityState?: TP.EntityState
}

type SearchAccumulator = {
  item: SearchableEntity
  matchedFields: Set<TP.SearchField>
  score: number
}

type SearchParams = {
  keyword: string
  entityType: TP.SearchEntityType
  searchInName?: boolean
  searchInDescription?: boolean
  take?: number
  skip?: number
  state?: string
  projectId?: string
  ownerId?: string
  releaseId?: string
  tags?: string[]
  createdAfter?: string
  createdBefore?: string
  modifiedAfter?: string
  modifiedBefore?: string
  orderBy?: TP.SearchOrderField
  orderDirection?: TP.SearchOrderDirection
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function stripHtml(value: string | undefined): string {
  if (!value) {
    return ''
  }

  const dom = new JSDOM(`<html><body><div id="content">${value}</div></body></html>`)
  const text = dom.window.document.getElementById('content')?.textContent ?? ''
  return collapseWhitespace(text)
}

function normalizeForMatch(value: string): string {
  return collapseWhitespace(value).toLowerCase()
}

function parseTags(value: string | undefined): string[] {
  if (!value) {
    return []
  }

  return value
    .split(/[;,]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
}

function buildItemKey(item: SearchableEntity): string {
  const entityType = item.EntityType?.Name ?? item.ResourceType ?? 'Unknown'
  return `${entityType}:${item.Id}`
}

function scoreFieldMatch(item: SearchableEntity, keyword: string, field: TP.SearchField): number {
  const normalizedKeyword = normalizeForMatch(keyword)
  const rawFieldValue = field === 'Name' ? item.Name ?? '' : stripHtml(item.Description)
  const normalizedFieldValue = normalizeForMatch(rawFieldValue)

  if (!normalizedFieldValue) {
    return 0
  }

  const baseScore = field === 'Name' ? 200 : 100

  if (normalizedFieldValue === normalizedKeyword) {
    return baseScore + 200
  }

  if (normalizedFieldValue.startsWith(normalizedKeyword)) {
    return baseScore + 100
  }

  if (normalizedFieldValue.includes(normalizedKeyword)) {
    return baseScore + 50
  }

  return baseScore
}

function compareRankedItems(left: SearchAccumulator, right: SearchAccumulator): number {
  if (right.score !== left.score) {
    return right.score - left.score
  }

  const leftModified = left.item.ModifyDate ? Date.parse(left.item.ModifyDate) : 0
  const rightModified = right.item.ModifyDate ? Date.parse(right.item.ModifyDate) : 0
  if (rightModified !== leftModified) {
    return rightModified - leftModified
  }

  return right.item.Id - left.item.Id
}

function definedFilters(params: SearchParams): TP.SearchFilters {
  return {
    entityStateName: params.state,
    projectId: params.projectId,
    ownerId: params.ownerId,
    releaseId: params.releaseId,
    tags: params.tags,
    createdAfter: params.createdAfter,
    createdBefore: params.createdBefore,
    modifiedAfter: params.modifiedAfter,
    modifiedBefore: params.modifiedBefore,
  }
}

export async function handleSearchTpCards(tp: TpClient, params: SearchParams) {
  const {
    keyword,
    entityType,
    searchInName = true,
    searchInDescription = true,
    take = 25,
    skip = 0,
    orderBy,
    orderDirection = 'asc',
  } = params

  const fields: TP.SearchField[] = []
  if (searchInName) {
    fields.push('Name')
  }
  if (searchInDescription) {
    fields.push('Description')
  }

  if (fields.length === 0) {
    return {
      content: [{
        type: 'text' as const,
        text: 'At least one search field must be enabled: searchInName or searchInDescription'
      }],
    }
  }

  const filters = definedFilters(params)
  const responses = await Promise.all(
    fields.map((field) => tp.searchEntities<TP.TpResponse<SearchableEntity>>({
      entityType,
      field,
      keyword,
      take,
      skip,
      orderBy,
      orderDirection,
      filters,
    }))
  )

  const resultMap = new Map<string, SearchAccumulator>()

  for (const [index, response] of responses.entries()) {
    if (!response?.Items?.length) {
      continue
    }

    const field = fields[index]
    for (const item of response.Items) {
      const key = buildItemKey(item)
      const existing = resultMap.get(key)
      const nextScore = scoreFieldMatch(item, keyword, field)

      if (existing) {
        existing.item = item
        existing.matchedFields.add(field)
        existing.score += nextScore
        continue
      }

      resultMap.set(key, {
        item,
        matchedFields: new Set([field]),
        score: nextScore,
      })
    }
  }

  if (resultMap.size === 0) {
    return {
      content: [{
        type: 'text' as const,
        text: `No matching cards found for keyword: "${keyword}"`
      }],
    }
  }

  const rankedItems = [...resultMap.values()].sort(compareRankedItems)
  const selectedItems = rankedItems.slice(0, take)
  const hasMore = rankedItems.length > take || responses.some((response) => Boolean(response?.Next))

  const parsedItems = selectedItems.map(({ item, matchedFields }) => ({
    id: item.Id,
    entityType: item.EntityType?.Name ?? item.ResourceType,
    title: item.Name,
    description: stripHtml(item.Description),
    url: `${config.tp.url}/entity/${item.Id}`,
    matchedFields: [...matchedFields],
    projectName: item.Project?.Name,
    entityStateName: item.EntityState?.Name,
    ownerName: item.Owner?.FullName,
    tags: parseTags(item.Tags),
    createDate: item.CreateDate,
    modifyDate: item.ModifyDate,
  }))

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        query: {
          keyword,
          entityType,
          searchFields: fields,
          filters: {
            state: params.state,
            projectId: params.projectId,
            ownerId: params.ownerId,
            releaseId: params.releaseId,
            tags: params.tags,
            createdAfter: params.createdAfter,
            createdBefore: params.createdBefore,
            modifiedAfter: params.modifiedAfter,
            modifiedBefore: params.modifiedBefore,
          },
          orderBy,
          orderDirection,
        },
        pagination: {
          take,
          skip,
          returned: parsedItems.length,
          hasMore,
          nextSkip: hasMore ? skip + take : null,
        },
        items: parsedItems,
      })
    }],
  }
}
