import { afterEach, describe, expect, it, vi } from 'vitest'
import { TpClient } from '../src/tp.js'

describe('TpClient bug creation errors', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('preserves Targetprocess response body on creation failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('{"message":"Project is required"}', {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))

    await expect(new TpClient().createBugOnly({
      title: 'Login fails',
      bugContent: '<div>Steps</div>',
    })).rejects.toThrow('Targetprocess API error (HTTP 422): {"message":"Project is required"}')
  })
})
