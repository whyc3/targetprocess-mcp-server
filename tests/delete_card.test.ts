import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleDeleteCard } from '../src/handlers/delete_card.js'
import type { TpClient } from '../src/tp.js'

const mockTp = {
  deleteCard: vi.fn(),
} as unknown as TpClient

beforeEach(() => {
  vi.clearAllMocks()
})

describe('handleDeleteCard', () => {
  it('returns deleted confirmation on success', async () => {
    vi.mocked(mockTp.deleteCard).mockResolvedValue({
      ok: true,
      data: { Id: 148980 },
    } as any)

    const result = await handleDeleteCard(mockTp, { id: '148980', type: 'Bug' })
    const parsed = JSON.parse(result.content[0].text)

    expect(parsed.deleted).toBe(true)
    expect(parsed.id).toBe(148980)
    expect(parsed.type).toBe('Bug')
    expect(mockTp.deleteCard).toHaveBeenCalledWith({ id: '148980', type: 'Bug' })
  })

  it('surfaces HTTP status and response body on failure', async () => {
    vi.mocked(mockTp.deleteCard).mockResolvedValue({
      ok: false,
      status: 404,
      body: '{"Status":"NotFound","Message":"Bug 999 not found"}',
    } as any)

    const result = await handleDeleteCard(mockTp, { id: '999', type: 'Bug' })

    expect(result.content[0].text).toContain('Failed to delete Bug id: 999')
    expect(result.content[0].text).toContain('HTTP status: 404')
    expect(result.content[0].text).toContain('Bug 999 not found')
  })
})
