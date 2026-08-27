import { afterEach, describe, expect, it, vi } from 'vitest'
import { TpClient } from '../src/tp.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TpClient business value tools', () => {
  it('posts a priority update to the selected entity', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ Id: 145789 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const tp = new TpClient()
    await tp.setBusinessValue({ id: '145789', entityType: 'UserStories', priorityId: '12' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(decodeURIComponent(url)).toContain('/UserStories/145789/?format=json&access_token=')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify({ Id: '145789', Priority: { Id: '12' } }))
  })

  it('gets the configured priority list', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ Next: '', Items: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const tp = new TpClient()
    await tp.getPriorities()

    const [url] = fetchMock.mock.calls[0]
    expect(decodeURIComponent(url)).toContain('/Priorities/?format=json&take=200&access_token=')
  })
})
