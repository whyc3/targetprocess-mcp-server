import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fields } from '../build/capability_helpers.js'
import { writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
if (process.env.TP_VERIFY_READONLY !== 'true') throw new Error('Set TP_VERIFY_READONLY=true to explicitly enable tenant read-only verification')
const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../build/index.js', import.meta.url))], env: Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)) })
const client = new Client({ name: 'tp-mcp-readonly-verification', version: '1.0.0' })
const results = []
try {
  await client.connect(transport)
  const discovered = (await client.listTools()).tools
  console.log(JSON.stringify({ initialized: true, version: client.getServerVersion(), toolCount: discovered.length, unique: new Set(discovered.map(t => t.name)).size === discovered.length }))
  const start = process.env.TP_VERIFY_FROM || new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString()
  const end = process.env.TP_VERIFY_TO || new Date().toISOString()
  const planId = process.env.TP_VERIFY_TEST_PLAN_ID
  const calls = [
    ['get_history_records', { entityType: 'UserStory', from: start, to: end, take: 10 }],
    ...(planId ? [['list_test_plan_runs', { testPlanId: planId, take: 1 }], ['list_test_plan_runs', { testPlanId: planId, latestOnly: true, take: 1, orderBy: 'Id', orderDirection: 'desc' }]] : []),
    ...['Users', 'Projects', 'Processes'].map(resource => ['discover_directory', { resource, all: true }]),
    ...['UserStoryHistories', 'BugHistories', 'Assignments', 'RoleEfforts', 'AssignedEfforts'].map(resource => ['get_test_management_metadata', { resource }]),
    ['get_bug_workflows', {}],

    ['get_status_history', { entityTypes: ['UserStory'], statusScope: 'TeamState', from: start, to: end, take: 2 }],
    ...(planId ? [['get_card_details', { entityType: 'TestPlans', id: planId }]] : []),
    ['search_tp_cards', { entityType: 'Bugs', keyword: '', searchInName: true, searchInDescription: false, take: 1 }],
    ['get_tag_history', { entityTypes: ['UserStory'], from: start, to: end }],
    ['get_status_history', { entityTypes: ['Bug'], from: start, to: end, take: 2 }],
  ]
  for (const [name, args] of calls) {
    try {
      const reply = await client.callTool({ name, arguments: args })
      let data; try { data = JSON.parse(reply.content.find(c => c.type === 'text')?.text ?? '{}') } catch { data = {} }
      if (name === 'search_tp_cards' && data.items?.[0]) {
        const workflow = await client.callTool({ name: 'get_card_workflow', arguments: { entityType: 'Bugs', id: String(data.items[0].id) } });
        console.log(JSON.stringify({ tool: 'get_card_workflow', ok: !workflow.isError }));
        if (workflow.isError) results.push({ tool: 'get_card_workflow', ok: false });
      }
      const entry = { tool: name, resource: args.resource ?? args.entityType, ok: !reply.isError, ...(reply.isError ? { error: data.error ?? data } : name === 'get_test_management_metadata' ? { fields: [...fields(data).keys()] } : { complete: data.complete, count: data.returned ?? data.Items?.length ?? data.items?.length ?? data.length ?? data.events?.length, limitations: data.limitations, keys: Object.keys(data) }) }
      results.push(entry); console.log(JSON.stringify(entry))
    } catch (e) { const entry = { tool: name, ok: false, error: String(e).slice(0, 1000) }; results.push(entry); console.log(JSON.stringify(entry)) }
  }
} finally { await client.close() }
await mkdir(new URL('../validation/', import.meta.url), { recursive: true })
await writeFile(new URL('../validation/read-only-check.json', import.meta.url), JSON.stringify({ verifiedAt: new Date().toISOString(), results }, null, 2))

if (results.some(result => !result.ok)) process.exitCode = 1
