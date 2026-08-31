import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleUpdateTaskById } from '../src/handlers/update_task_by_id.js'
import { handleDeleteTaskById } from '../src/handlers/delete_task_by_id.js'
import type { TpClient } from '../src/tp.js'

const mockTp = {
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
} as unknown as TpClient

beforeEach(() => {
  vi.clearAllMocks()
})

describe('handleUpdateTaskById', () => {
  it('updates supplied task fields', async () => {
    vi.mocked(mockTp.updateTask).mockResolvedValue({ Id: 145789, Name: 'Write regression tests' } as any)

    const result = await handleUpdateTaskById(mockTp, {
      id: '145789',
      title: 'Write regression tests',
      entityStateId: '42',
    })

    expect(JSON.parse(result.content[0].text)).toMatchObject({ Id: 145789, Name: 'Write regression tests' })
    expect(mockTp.updateTask).toHaveBeenCalledWith({
      id: '145789',
      title: 'Write regression tests',
      entityStateId: '42',
    })
  })

  it('does not call the API if no update fields are provided', async () => {
    const result = await handleUpdateTaskById(mockTp, { id: '145789' })

    expect(result.content[0].text).toContain('Nothing to update for task id: 145789')
    expect(mockTp.updateTask).not.toHaveBeenCalled()
  })

  it('reports a failed update', async () => {
    vi.mocked(mockTp.updateTask).mockResolvedValue(null as any)

    const result = await handleUpdateTaskById(mockTp, { id: '145789', description: 'New description' })

    expect(result.content[0].text).toContain('Failed to update task id: 145789')
  })
})

describe('handleDeleteTaskById', () => {
  it('returns a deletion confirmation', async () => {
    vi.mocked(mockTp.deleteTask).mockResolvedValue({ ok: true, data: { Id: 145789 } } as any)

    const result = await handleDeleteTaskById(mockTp, '145789')

    expect(JSON.parse(result.content[0].text)).toEqual({
      deleted: true,
      taskId: 145789,
      task: { Id: 145789 },
    })
    expect(mockTp.deleteTask).toHaveBeenCalledWith('145789')
  })

  it('surfaces Targetprocess deletion errors', async () => {
    vi.mocked(mockTp.deleteTask).mockResolvedValue({
      ok: false,
      status: 404,
      body: '{"Message":"Task not found"}',
    } as any)

    const result = await handleDeleteTaskById(mockTp, '145789')

    expect(result.content[0].text).toContain('Failed to delete task id: 145789')
    expect(result.content[0].text).toContain('HTTP status: 404')
    expect(result.content[0].text).toContain('Task not found')
  })
})
