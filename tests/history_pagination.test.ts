import { describe, expect, it, vi } from 'vitest'
import { Insights } from '../src/insights.js'
import type { TpClient } from '../src/tp.js'
import { processBytes } from '../src/attachment_processing.js'

describe('history pagination and distinct team scope', () => {
  it('follows history Next pages without replacing transitions with current state', async () => {
    const transition = (id: number, date: string) => ({ Id: id, Date: date, Name: 'Then', CurrentBug: { Id: 50 }, EntityState: { Id: id + 10, Name: 'Done' }, PreviousHistoryRecord: { Id: id - 1, EntityState: { Id: id + 9, Name: 'Open' } } })
    const tp = { api: vi.fn(async (_m, path) => path[1] === 'meta' ? { Properties: ['Id', 'Name', 'Date', 'EntityState', 'IsChangedEntityState', 'CurrentBug', 'PreviousHistoryRecord'].map(Name => ({ Name, CanGet: true })) } : { Items: [transition(2, '2026-10-26T09:00:00Z')], Next: '/api/v1/BugHistories?skip=1&take=1' }), apiPage: vi.fn().mockResolvedValue({ Items: [transition(3, '2026-10-26T10:00:00Z')], Next: '' }) } as unknown as TpClient
    const result = await new Insights(tp).history({ entityTypes: ['Bug'], from: '2026-10-26T00:00:00Z', to: '2026-10-27T00:00:00Z', take: 1, skip: 0, direction: 'asc' }, 'status')
    expect(result.events[0].historyId).toBe(2)
    expect(result.hasMore).toBe(true)
    expect(tp.apiPage).toHaveBeenCalledWith('/api/v1/BugHistories?skip=1&take=1')
  })
  it('returns team-state events without relabelling entity state', async () => {
    const tp = { api: vi.fn(async (_m, path) => path[1] === 'meta' ? { Properties: ['Id', 'Date', 'TeamState', 'IsChangedTeamState', 'CurrentBug', 'PreviousHistoryRecord'].map(Name => ({ Name, CanGet: true })) } : { Items: [{ Id: 2, Date: '2026-10-26T09:00:00Z', CurrentBug: { Id: 50 }, TeamState: { Id: 20, Name: 'QA Done' }, EntityState: { Id: 100, Name: 'In Progress' }, PreviousHistoryRecord: { Id: 1, TeamState: { Id: 19, Name: 'QA' } } }], Next: '' }) } as unknown as TpClient
    const result = await new Insights(tp).history({ entityTypes: ['Bug'], from: '2026-10-26T00:00:00Z', to: '2026-10-27T00:00:00Z', take: 1, skip: 0, direction: 'asc', statusScope: 'TeamState' }, 'status')
    expect(result.events[0]).toMatchObject({ scope: 'TeamState', previous: { Name: 'QA' }, next: { Name: 'QA Done' } })
  })
  it('identifies encrypted Office containers without attempting macro execution', async () => {
    const bytes = Buffer.from('d0cf11e0a1b11ae100000000', 'hex')
    expect(await processBytes(bytes, 'encrypted.docx')).toMatchObject({ extractionFailed: true, encrypted: true })
  })
})
