import { afterEach, describe, expect, it, vi } from 'vitest'
import { TpClient } from '../src/tp.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

function mockSuccessFetch() {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ Id: 145789 }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('TpClient bug release assignment', () => {
  it('assigns a release when creating a standalone bug', async () => {
    const fetchMock = mockSuccessFetch()
    const tp = new TpClient()

    await tp.createBugOnly({ title: 'Bug', bugContent: 'Details', releaseId: '145200' })

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init?.body as string)).toMatchObject({ Release: { Id: '145200' } })
  })

  it('assigns a release when creating a bug linked to a card', async () => {
    const fetchMock = mockSuccessFetch()
    const tp = new TpClient()

    await tp.createBug({
      title: 'Bug',
      bugContent: 'Details',
      releaseId: '145200',
      card: { id: '145789', type: 'UserStory' },
    })

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init?.body as string)).toMatchObject({
      Release: { Id: '145200' },
      UserStory: { Id: '145789' },
    })
  })

  it('assigns a release when updating a bug', async () => {
    const fetchMock = mockSuccessFetch()
    const tp = new TpClient()

    await tp.updateBug({ id: '145789', releaseId: '145200' })

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init?.body as string)).toEqual({ Id: '145789', Release: { Id: '145200' } })
  })
})
