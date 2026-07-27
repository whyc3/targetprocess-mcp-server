import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const testsDir = path.dirname(fileURLToPath(import.meta.url))
const indexPath = path.resolve(testsDir, '../src/index.ts')

function getRegisteredToolNames(source: string): string[] {
  return [...source.matchAll(/server\.registerTool\(\s*['"]([^'"]+)['"]/g)].map(([, name]) => name)
}

describe('MCP tool registration', () => {
  it('registers each tool name only once', () => {
    const source = fs.readFileSync(indexPath, 'utf8')
    const toolNames = getRegisteredToolNames(source)
    const counts = new Map<string, number>()

    for (const name of toolNames) {
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }

    const duplicates = [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([name, count]) => `${name} (${count})`)

    expect(duplicates).toEqual([])
  })
})
