import { describe, expect, it, vi } from 'vitest'
import { TestManagement } from '../src/test_management.js'
import type { TpClient } from '../src/tp.js'

describe('maintenance and tenant compatibility', () => {
  it('reads paginated history through the case relationship without unsupported root filters', async () => {
    const api = vi.fn().mockResolvedValue({ Items: [{ Id: 40, RunDate: '/Date(0)/' }] })
    await new TestManagement({ api } as unknown as TpClient).history('30', 10, 0)
    expect(api).toHaveBeenCalledWith('GET', ['TestCases', '30', 'TestCaseRuns'], undefined, { take: 10, skip: 0 })
  })

  it('copies ordered source steps and inherits the destination project when cloning', async () => {
    const tp = {
      getTestCase: vi.fn().mockResolvedValue({ Id: 1, Description: 'Precondition', Tags: 'smoke', Project: { Id: 99 } }),
      getTestCaseSteps: vi.fn().mockResolvedValue({ Items: [
        { Id: 3, Description: 'Second', Result: 'Done', RunOrder: 2 },
        { Id: 2, Description: 'First', Result: 'Ready', RunOrder: 1 },
      ] }),
    }
    const service = new TestManagement(tp as unknown as TpClient)
    const create = vi.spyOn(service, 'createCase').mockResolvedValue({ id: 100, name: 'Clone', status: 'complete', stepsAdded: 2, failedSteps: [] })
    await service.cloneCase('1', 'Clone', '10')
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Clone', testPlanId: '10', projectId: undefined,
      steps: [{ description: 'First', result: 'Ready' }, { description: 'Second', result: 'Done' }],
    }))
  })

  it('validates all destination projects before linking any existing case', async () => {
    const tp = {
      getTestPlan: vi.fn().mockResolvedValue({ Project: { Id: 17 } }),
      getTestCase: vi.fn().mockResolvedValueOnce({ Project: { Id: 17 } }).mockResolvedValueOnce({ Project: { Id: 99 } }),
      api: vi.fn(),
    }
    await expect(new TestManagement(tp as unknown as TpClient).linkCases('10', ['1', '2'])).rejects.toThrow('another project')
    expect(tp.api).not.toHaveBeenCalled()
  })

  it('preserves prior memberships and reports later link failures individually', async () => {
    const memberships: Record<string, Array<{ id: string }>> = { '1': [{ id: '11' }], '2': [{ id: '11' }] }
    const tp = {
      getTestPlan: vi.fn().mockResolvedValue({ Project: { Id: 17 } }),
      getTestCase: vi.fn().mockResolvedValue({ Project: { Id: 17 } }),
      getTestCaseTestPlans: vi.fn(async id => memberships[id]),
      api: vi.fn(async (_method, path, body) => {
        if (path[1] === '2') throw new Error('Permission denied')
        memberships[path[1]] = [...memberships[path[1]], ...body.TestPlans.Items.map((item: any) => ({ id: item.Id }))]
        return { Id: Number(path[1]) }
      }),
    }
    const result = await new TestManagement(tp as unknown as TpClient).linkCases('10', ['1', '2'])
    expect(result.linked).toEqual(['1'])
    expect(result.failed).toMatchObject([{ id: '2', error: { message: 'Permission denied' } }])
    expect(memberships['1']).toEqual([{ id: '11' }, { id: '10' }])
  })

  it('refuses conflicting retry positions before adding any step', async () => {
    const tp = {
      getTestCaseSteps: vi.fn().mockResolvedValue({ Items: [{ Id: 1, RunOrder: 1, Description: 'Existing', Result: 'Existing result' }] }),
      addTestStep: vi.fn(),
    }
    await expect(new TestManagement(tp as unknown as TpClient).retrySteps('10', [{ index: 1, description: 'Different', result: 'Changed' }])).rejects.toThrow('already occupies')
    expect(tp.addTestStep).not.toHaveBeenCalled()
  })

  it('requires explicit acknowledgment before applying globally shared case ordering', async () => {
    const tp = {
      api: vi.fn().mockResolvedValue({ Properties: [{ Name: 'NumericPriority', CanSet: true }] }),
      apiAll: vi.fn().mockResolvedValue([{ Id: 1 }, { Id: 2 }]),
      getTestCaseTestPlans: vi.fn().mockResolvedValue([{ id: '10' }, { id: '11' }]),
    }
    const service = new TestManagement(tp as unknown as TpClient)
    const preview = await service.reorderCases('10', ['2', '1'])
    expect(preview.canReorder).toBe(false)
    await expect(service.reorderCases('10', ['2', '1'], false)).rejects.toThrow('global')
    expect(tp.api.mock.calls.filter(call => call[0] === 'POST')).toHaveLength(0)
  })

  it('applies and verifies the complete case ordering after acknowledgment', async () => {
    const cases = [{ Id: 1, NumericPriority: 1 }, { Id: 2, NumericPriority: 2 }]
    const tp = {
      api: vi.fn(async (method, path, body) => {
        if (method === 'GET') return { Properties: [{ Name: 'NumericPriority', CanSet: true }] }
        Object.assign(cases.find(item => String(item.Id) === path[1])!, body)
        return {}
      }),
      apiAll: vi.fn(async () => structuredClone(cases)),
      getTestCaseTestPlans: vi.fn().mockResolvedValue([{ id: '10' }, { id: '11' }]),
    }
    const result = await new TestManagement(tp as unknown as TpClient).reorderCases('10', ['2', '1'], false, true)
    expect(result).toMatchObject({ verified: true, updated: ['2', '1'] })
    expect(cases).toEqual([{ Id: 1, NumericPriority: 2 }, { Id: 2, NumericPriority: 1 }])
  })

  it('does not try to write a metadata-declared read-only ordering field', async () => {
    const api = vi.fn().mockResolvedValue({ Properties: [{ Name: 'NumericPriority', CanSet: false }] })
    await expect(new TestManagement({ api } as unknown as TpClient).reorderCases('10', ['1'], false)).rejects.toThrow('read-only')
    expect(api.mock.calls.filter(call => call[0] === 'POST')).toHaveLength(0)
  })

  it('verifies the number of steps after reordering, not just the returned prefix', async () => {
    const tp = {
      getTestCaseSteps: vi.fn()
        .mockResolvedValueOnce({ Items: [{ Id: 1, RunOrder: 1 }, { Id: 2, RunOrder: 2 }] })
        .mockResolvedValueOnce({ Items: [{ Id: 2, RunOrder: 1 }] }),
      api: vi.fn().mockResolvedValue({}),
    }
    await expect(new TestManagement(tp as unknown as TpClient).reorderSteps('10', ['2', '1'])).rejects.toThrow('could not be verified')
  })

  it('maps step statuses to the live tenant Passed/Runned boolean fields', async () => {
    const step = { Id: 1, TestCaseRun: { Id: 40 }, Passed: false, Runned: false }
    const api = vi.fn(async (method, path, body) => {
      if (path[1] === 'meta') return { Properties: [{ Name: 'Passed', CanSet: true, Type: 'Boolean' }, { Name: 'Runned', CanSet: true, Type: 'Boolean' }] }
      if (path[0] === 'TestStepRuns') { if (method === 'POST') Object.assign(step, body); return { ...step } }
      if (path[0] === 'TestCaseRuns') return { Id: 40, TestPlanRun: { Id: 20 } }
      if (path[0] === 'TestPlanRuns') return { Id: 20, EntityState: { Id: 1 } }
      if (path[0] === 'EntityStates') return { Id: 1, IsFinal: false }
      throw new Error('Unexpected call')
    })
    const result = await new TestManagement({ api } as unknown as TpClient).updateStepRun('1', 'Passed')
    expect(result).toMatchObject({ Passed: true, Runned: true })
    expect(api).toHaveBeenCalledWith('POST', ['TestStepRuns', '1'], { Passed: true, Runned: true })
  })
})
