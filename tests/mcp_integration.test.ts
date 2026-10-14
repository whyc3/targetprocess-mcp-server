import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { server } from '../src/index.js'

const client = new Client({ name: 'test-client', version: '1.0.0' })
beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport); await client.connect(clientTransport)
})
afterAll(async () => { await client.close(); await server.close() })
afterEach(() => vi.unstubAllGlobals())

describe('MCP protocol integration', () => {
  it('advertises every new management tool with unique names and correct write annotations', async () => {
    const { tools } = await client.listTools()
    const names = tools.map(tool => tool.name)
    expect(new Set(names).size).toBe(names.length)
    for (const name of ['create_test_case', 'create_test_plan_run', 'update_test_case_run', 'attach_test_run_evidence', 'link_bug_to_test_case_run', 'get_test_run_summary']) {
      expect(names).toContain(name)
    }
    expect(tools.find(tool => tool.name === 'get_test_run_summary')?.annotations?.readOnlyHint).toBe(true)
    expect(tools.find(tool => tool.name === 'update_test_case_run')?.annotations?.readOnlyHint).toBe(false)
  })

  it('preserves every tool exposed by the connected 2.6.10 server', async () => {
    const expected: string[] = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/tools-2.6.10.json', import.meta.url)), 'utf8'))
    const names = (await client.listTools()).tools.map(tool => tool.name)
    expect(expected.filter(name => !names.includes(name))).toEqual([])
  })

  it('uses the same package version for handshake and get_version', async () => {
    const require = createRequire(import.meta.url)
    const { version } = require('../package.json')
    expect(client.getServerVersion()?.version).toBe(version)
    const result = await client.callTool({ name: 'get_version', arguments: {} })
    expect(result.content).toEqual([{ type: 'text', text: version }])
  })

  it('surfaces rejected creation as an MCP error with API details', async () => {
    const mocked = vi.fn().mockResolvedValue(new Response('Project permission denied', { status: 403 }))
    vi.stubGlobal('fetch', mocked)
    const result = await client.callTool({ name: 'create_test_case', arguments: { name: 'Draft', projectId: '17' } })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('403')
    expect(JSON.stringify(result.content)).toContain('Project permission denied')
    expect(mocked).toHaveBeenCalledTimes(1)
  })

  it('marks legacy bug-handler API errors as MCP failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Permission denied', { status: 403 })))
    const result = await client.callTool({ name: 'create_bug', arguments: { title: 'Denied fixture', bugContent: 'No record is created by this mock', projectId: '17' } })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('403')
  })

  it('rejects conflicting upload sources before reading or uploading files', async () => {
    const mocked = vi.fn()
    vi.stubGlobal('fetch', mocked)
    const result = await client.callTool({ name: 'upload_attachment', arguments: {
      generalId: '20', filePath: path.resolve('README.md'), fileContent: 'SGVsbG8=', fileName: 'file.txt',
    } })
    expect(result.isError).toBe(true)
    expect(mocked).not.toHaveBeenCalled()
  })

  it('rejects missing screenshot evidence before executing the result tool', async () => {
    const mocked = vi.fn(); vi.stubGlobal('fetch', mocked)
    const result = await client.callTool({ name: 'update_test_case_run', arguments: { id: '40', status: 'Passed', comment: 'Observed success' } })
    expect(result.isError).toBe(true)
    expect(mocked).not.toHaveBeenCalled()
  })
})
