import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import sharp from 'sharp'
import { Attachments, downloadBinary } from '../src/attachments.js'
import { processBytes } from '../src/attachment_processing.js'
import { TpApiError } from '../src/http.js'
import { config } from '../src/config.js'
import type { TpClient } from '../src/tp.js'

let root: string
const target = { entityType: 'Bugs', entityId: '50' }
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'tp-attachment-test-')); vi.stubEnv('TP_ATTACHMENT_JOURNAL_DIR', root); vi.stubEnv('TP_ATTACHMENT_BASIC_AUTH', ''); vi.stubEnv('TP_ATTACHMENT_COOKIE', '') })
afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }) })
function fixture() {
  const files: any[] = [{ Id: 1, Name: 'old.txt', General: { Id: 50 }, Size: 3, MimeType: 'text/plain' }]
  const cases: Record<string, any> = { '40': { Id: 40, TestPlanRun: { Id: 50 }, Comment: '<p>Observed</p><a href="/Attachment.aspx?AttachmentID=1">old</a>' }, '41': { Id: 41, TestPlanRun: { Id: 50 }, Comment: '<p>Other case</p><a href="/Attachment.aspx?AttachmentID=1">old</a>' } }
  const api = vi.fn(async (method, path, body) => {
    const [resource, id] = path
    if (id === 'meta') return { CanCreate: true, CanUpdate: true, CanDelete: true, Properties: (resource === 'Attachments' ? ['Name', 'Description'] : ['Attachments']).map(Name => ({ Name, CanGet: true, CanSet: true })) }
    if (resource === 'Attachments') {
      const found = files.find(f => String(f.Id) === id)
      if (!found) throw new TpApiError('GET attachment', 404, 'not found')
      if (method === 'DELETE') files.splice(files.indexOf(found), 1)
      if (method === 'POST') Object.assign(found, body)
      return structuredClone(found)
    }
    if (resource === 'TestCaseRuns') { if (method === 'POST') Object.assign(cases[id], body); return structuredClone(cases[id]) }
    return { Id: Number(id), ResourceType: 'Bug' }
  })
  const tp = { api, apiAll: vi.fn(async () => structuredClone(files)), addAttachedFile: vi.fn(async () => { files.push({ Id: 2, Name: 'new.txt', General: { Id: 50 }, Size: 3 }); return 'OK' }) }
  const service = new Attachments(tp as unknown as TpClient)
  return { service, tp, files, cases }
}
describe('attachment CRUD and recovery', () => {
  it('validates ownership before content access or mutation', async () => {
    const f = fixture(); f.files[0].General.Id = 99
    await expect(f.service.update('1', target, { name: 'wrong.txt' })).rejects.toThrow('does not belong')
    expect(f.tp.api.mock.calls.some(c => c[0] === 'POST')).toBe(false)
  })
  it('recovers a committed upload after a timeout without retrying the write', async () => {
    const f = fixture(); f.tp.addAttachedFile.mockImplementation(async () => { f.files.push({ Id: 2, Name: 'new.txt', General: { Id: 50 }, Size: 3 }); throw new Error('timeout') })
    const first = await f.service.create(target, { fileContent: 'YWJj', fileName: 'new.txt' }, 'operation-1')
    const retry = await f.service.create(target, { fileContent: 'YWJj', fileName: 'new.txt' }, 'operation-1')
    expect(first).toMatchObject({ verified: true, attachments: [{ Id: 2 }] })
    expect(retry).toMatchObject({ verified: true, recovered: true })
    expect(f.tp.addAttachedFile).toHaveBeenCalledTimes(1)
  })
  it('never retries an unresolved upload, even across service instances', async () => {
    const f = fixture(); f.tp.addAttachedFile.mockRejectedValue(new Error('timeout'))
    expect(await f.service.create(target, { fileContent: 'YWJj', fileName: 'new.txt' }, 'operation-2')).toMatchObject({ verified: false, status: 'partial' })
    const second = new Attachments(f.tp as unknown as TpClient)
    expect(await second.create(target, { fileContent: 'YWJj', fileName: 'new.txt' }, 'operation-2')).toMatchObject({ verified: false })
    expect(f.tp.addAttachedFile).toHaveBeenCalledTimes(1)
  })
  it('rejects reuse of an operation ID for different content', async () => {
    const f = fixture(); await f.service.create(target, { fileContent: 'YWJj', fileName: 'new.txt' }, 'operation-3')
    await expect(f.service.create(target, { fileContent: 'eHl6', fileName: 'new.txt' }, 'operation-3')).rejects.toThrow('different content')
  })
  it('verifies supported metadata changes without altering binary metadata', async () => {
    const f = fixture()
    expect(await f.service.update('1', target, { name: 'renamed.txt', description: '<p>A & B</p>' })).toMatchObject({ verified: true, attachment: { Name: 'renamed.txt', Size: 3 } })
  })
  it('retains the original when replacement verification fails', async () => {
    const f = fixture(); f.tp.addAttachedFile.mockResolvedValue('empty')
    const result = await f.service.replace('1', target, { fileContent: 'YWJj', fileName: 'new.txt' }, 'replace-1', true, true)
    expect(result).toMatchObject({ originalId: '1', originalRemoved: false, verified: false })
    expect(f.files.some(f => f.Id === 1)).toBe(true)
    expect(f.tp.api.mock.calls.some(c => c[0] === 'DELETE')).toBe(false)
  })
  it('uploads and verifies a replacement before deleting the explicit original', async () => {
    const f = fixture(); const result = await f.service.replace('1', target, { fileContent: 'YWJj', fileName: 'new.txt' }, 'replace-2', true, true)
    expect(result).toMatchObject({ originalId: '1', replacementId: '2', originalRemoved: true, verified: true })
    expect(f.files.map(f => f.Id)).toEqual([2])
  })
  it('checks shared evidence and updates only the explicitly targeted case result', async () => {
    const f = fixture(), originalOther = f.cases['41'].Comment
    f.files.push({ Id: 2, Name: 'replacement.txt', General: { Id: 50 }, Size: 3 })
    vi.spyOn(f.service.management, 'editable').mockResolvedValue({} as any)
    vi.spyOn(f.service, 'target').mockResolvedValue({ Id: 50, ResourceType: 'TestPlanRun' })
    vi.spyOn(f.service.management, 'getRun').mockImplementation(async () => ({ run: {} as any, runIds: [50], caseRuns: Object.values(f.cases) }))
    const result = await f.service.evidence('40', '1', '2', true)
    expect(result).toMatchObject({ referenceUpdated: true, backingRetained: true, sharedReferences: [{ testCaseRunId: '41' }] })
    expect(f.cases['40'].Comment).toContain('AttachmentID=2')
    expect(f.cases['40'].Comment).toContain('Observed')
    expect(f.cases['41'].Comment).toBe(originalOther)
    expect(f.files.some(f => f.Id === 1)).toBe(true)
  })
  it('does not treat verification permission failure as successful deletion', async () => {
    const f = fixture(); const original = f.tp.api.getMockImplementation()!
    let deleted = false
    f.tp.api.mockImplementation(async (method, path, body) => { if (method === 'DELETE') { deleted = true; return null } if (deleted && path[0] === 'Attachments' && path[1] === '1') throw new TpApiError('GET attachment', 403, 'denied'); return original(method, path, body) })
    expect(await f.service.remove('1', target, true)).toMatchObject({ verified: false, status: 'partial' })
  })
})
describe('authenticated binary reads and downloads', () => {
  it('requires supported attachment authentication, never sends an API token URL', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const url = config.tp.url; config.tp.url = 'https://tenant.test'
    try { await expect(downloadBinary('1')).rejects.toThrow('Binary authentication unavailable'); expect(fetch).not.toHaveBeenCalled() } finally { config.tp.url = url }
  })
  it('uses headers for credentials and refuses redirect forwarding', async () => {
    vi.stubEnv('TP_ATTACHMENT_BASIC_AUTH', 'dXNlcjpwYXNz')
    const fetchMock = vi.fn().mockResolvedValue(new Response('abc', { headers: { 'content-type': 'application/octet-stream' } })); vi.stubGlobal('fetch', fetchMock)
    const url = config.tp.url; config.tp.url = 'https://tenant.test'
    try {
      expect((await downloadBinary('1')).toString()).toBe('abc')
      expect(fetchMock.mock.calls[0][0].toString()).not.toContain('access_token')
      expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'error', headers: { Authorization: 'Basic dXNlcjpwYXNz' } })
    } finally { config.tp.url = url }
  })
  it('writes only to explicitly allowed destinations and never overwrites', async () => {
    const f = fixture(); vi.stubEnv('TP_ATTACHMENT_DOWNLOAD_ROOTS', root); vi.stubEnv('TP_ATTACHMENT_BASIC_AUTH', 'dXNlcjpwYXNz')
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Response('abc')))
    const destination = join(root, 'download.txt')
    expect(await f.service.download('1', target, destination)).toMatchObject({ verified: true, size: 3 })
    expect(await readFile(destination, 'utf8')).toBe('abc')
    await expect(f.service.download('1', target, destination)).rejects.toMatchObject({ code: 'EEXIST' })
    await expect(f.service.download('1', target, join(root, '..', 'outside.txt'))).rejects.toThrow('outside')
  })
})
describe('bounded untrusted attachment processing', () => {
  it('extracts selected text lines and bounds output', async () => {
    const result = await processBytes(Buffer.from('one\ntwo\nthree'), 'run.log', { startLine: 2, maxRows: 1, maxChars: 30 })
    expect(result.data.lines).toEqual([{ line: 2, text: 'two' }]); expect(result.untrustedContent).toBe(true)
  })
  it('parses quoted CSV including multiline cells without evaluating formulas', async () => {
    const result = await processBytes(Buffer.from('name,value\r\n"A,B","hello\nworld"\r\nformula,=1+1'), 'report.csv')
    expect(result.data.rows[1].values).toEqual(['A,B', 'hello\nworld'])
    expect(result.data.rows[2].values[1]).toBe('=1+1')
  })
  it('extracts DOCX paragraphs and tables', async () => {
    const docx = Buffer.from(zipSync({ 'word/document.xml': strToU8('<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>') }))
    const result = await processBytes(docx, 'test.docx')
    expect(result.data.blocks).toEqual([{ paragraph: 1, text: 'Hello' }, { table: 2, rows: [['Cell']] }])
  })
  it('selects XLSX sheet/range and reports cached formula values', async () => {
    const xlsx = Buffer.from(zipSync({ 'xl/workbook.xml': strToU8('<workbook xmlns:r="urn:rels"><sheets><sheet name="QA" sheetId="1" r:id="r1"/></sheets></workbook>'), 'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>'), 'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1"><f>1+1</f><v>2</v></c><c r="A2"><v>4</v></c></row></sheetData></worksheet>') }))
    const result = await processBytes(xlsx, 'report.xlsx', { sheet: 'QA', range: 'A1:B1' })
    expect(result.data.cells).toHaveLength(2)
    expect(result.data.cells[1]).toMatchObject({ cell: 'B1', value: 2, formula: '1+1', cachedValueOnly: true })
  })
  it('inspects image dimensions and makes a bounded preview', async () => {
    const bytes = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#ffffff' } }).png().toBuffer()
    const result = await processBytes(bytes, 'image.png', { preview: true, ocr: true })
    expect(result.data).toMatchObject({ width: 20, height: 10, preview: { mimeType: 'image/png' }, ocr: { available: false } })
  })
  it('reports unsupported and malformed/encrypted containers explicitly', async () => {
    expect(await processBytes(Buffer.from('binary'), 'report.xls')).toMatchObject({ supported: false })
    expect(await processBytes(Buffer.from('bad'), 'report.pdf')).toMatchObject({ extractionFailed: true })
  })
  it('refuses XML entity declarations in documents', async () => {
    const bytes = Buffer.from(zipSync({ 'word/document.xml': strToU8('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///secret">]><w:document xmlns:w="urn:word">&e;</w:document>') }))
    expect(await processBytes(bytes, 'file.docx')).toMatchObject({ extractionFailed: true, error: expect.stringContaining('entity declarations') })
  })
})
