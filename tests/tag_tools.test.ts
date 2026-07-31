import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleUpdateCardTags } from '../src/handlers/update_card_tags.js'
import { TpClient } from '../src/tp.js'
import type { TpClient as TpClientType } from '../src/tp.js'

const mockTp = {
  updateCardTags: vi.fn(),
} as unknown as TpClientType

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('handleUpdateCardTags', () => {
  it('returns bulk update results as JSON', async () => {
    vi.mocked(mockTp.updateCardTags).mockResolvedValue({
      succeeded: [{ id: '145789', response: { Id: 145789 } }],
      failed: [{ id: '145790', reason: 'Update failed' }],
    } as any)

    const result = await handleUpdateCardTags(mockTp, {
      entityType: 'UserStory',
      ids: ['145789', '145790'],
      addTags: 'api',
    })
    const parsed = JSON.parse(result.content[0].text)

    expect(parsed.entityType).toBe('UserStory')
    expect(parsed.requested).toBe(2)
    expect(parsed.succeeded[0].id).toBe('145789')
    expect(parsed.failed[0].id).toBe('145790')
  })

  it('rejects requests without tag mutation fields', async () => {
    const result = await handleUpdateCardTags(mockTp, {
      entityType: 'Bug',
      ids: ['145789'],
    })

    expect(result.content[0].text).toContain('Provide at least one tag update field')
    expect(mockTp.updateCardTags).not.toHaveBeenCalled()
  })

  it('rejects invalid tag mutation input', async () => {
    const result = await handleUpdateCardTags(mockTp, {
      entityType: 'Feature',
      ids: ['145636'],
      tags: 'api',
      addTags: 'mobile',
    })

    expect(result.content[0].text).toContain('Use either "tags" or "addTags"/"removeTags", not both.')
    expect(mockTp.updateCardTags).not.toHaveBeenCalled()
  })
})

describe('TpClient tag mutation helpers', () => {
  it('merges addTags and removeTags before updating a user story', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const decodedUrl = decodeURIComponent(url)

      if (decodedUrl.includes('/userStories/145789/')) {
        return new Response(JSON.stringify({ Id: 145789, Tags: 'api, legacy' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      if (decodedUrl.includes('/UserStories/?format=json&access_token=')) {
        return new Response(JSON.stringify({ Id: 145789 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      throw new Error(`Unexpected URL: ${decodedUrl}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const tp = new TpClient()
    await tp.updateUserStory({ id: '145789', addTags: 'mobile', removeTags: 'legacy' })

    const [url, init] = fetchMock.mock.calls[1]
    expect(decodeURIComponent(url)).toContain('/UserStories/?format=json&access_token=')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify({ Id: '145789', Tags: 'api, mobile' }))
  })

  it('allows clearing all tags with full replacement', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const decodedUrl = decodeURIComponent(url)

      if (decodedUrl.includes('/Features/?format=json&access_token=')) {
        return new Response(JSON.stringify({ Id: 145636 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      throw new Error(`Unexpected URL: ${decodedUrl}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const tp = new TpClient()
    await tp.updateFeature({ id: '145636', tags: '' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(decodeURIComponent(url)).toContain('/Features/?format=json&access_token=')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify({ Id: '145636', Tags: '' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports per-id success and failure for bulk tag updates', async () => {
    const tp = new TpClient()
    vi.spyOn(tp, 'updateBug').mockImplementation(async ({ id }) => {
      if (id === '145790') {
        return null as any
      }

      return { Id: id } as any
    })

    const result = await tp.updateCardTags({
      entityType: 'Bug',
      ids: ['145789', '145790'],
      addTags: 'api',
    })

    expect(result.succeeded).toEqual([{ id: '145789', response: { Id: '145789' } }])
    expect(result.failed).toEqual([{ id: '145790', reason: 'Update failed' }])
  })
})
