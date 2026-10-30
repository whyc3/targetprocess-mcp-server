import { describe, expect, it, vi } from 'vitest'
import { TpClient } from '../src/tp.js'
import { Insights } from '../src/insights.js'
import { TpApiError } from '../src/http.js'
import { processBytes } from '../src/attachment_processing.js'

function pdf(text: string) {
  const content = text ? 'BT /F1 12 Tf 50 100 Td (' + text + ') Tj ET' : ''
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Length ' + Buffer.byteLength(content) + ' >>\nstream\n' + content + '\nendstream']
  let body = '%PDF-1.4\n'; const offsets = [0]
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(body)); body += (index + 1) + ' 0 obj\n' + object + '\nendobj\n' }
  const xref = Buffer.byteLength(body)
  body += 'xref\n0 6\n0000000000 65535 f \n' + offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF'
  return Buffer.from(body)
}
describe('PDF extraction', () => {
  it('extracts actual text and page references from a valid PDF', async () => {
    const result = await processBytes(pdf('QA evidence'), 'evidence.pdf', { pages: [1] })
    expect(result).not.toHaveProperty('extractionFailed')
    expect(result.data).toMatchObject({ format: 'pdf', pageCount: 1, pages: [{ page: 1, text: expect.stringContaining('QA evidence'), scanned: false }] })
  })
  it('identifies scanned/empty pages and reports unavailable local OCR', async () => {
    const result = await processBytes(pdf(''), 'scan.pdf', { ocr: true })
    expect(result.data.pages[0]).toMatchObject({ scanned: true, ocr: { available: false } })
  })
})
describe('comment mutations use explicit ownership and verify the saved outcome', () => {
  function fixture() {
    let row: any = { Id: 10, General: { Id: 50 }, Description: '<p>Old</p>' }
    const api = vi.fn(async (method, path, body) => {
      if (path[1] === 'meta') return { CanUpdate: true, CanDelete: true, Properties: [{ Name: 'Description', CanSet: true }] }
      if (!row) throw new TpApiError('GET comment', 404, 'not found')
      if (method === 'POST') row.Description = body.Description.replace(' & ', ' &amp; ')
      if (method === 'DELETE') { row = undefined; return null }
      return structuredClone(row)
    })
    return { api, service: new Insights({ api } as unknown as TpClient) }
  }
  it('preserves equivalent formatted content', async () => {
    const f = fixture()
    expect(await f.service.comment('10', '50', '<p>A & B</p>')).toMatchObject({ verified: true, comment: { Description: '<p>A &amp; B</p>' } })
  })
  it('refuses an owner mismatch before mutating', async () => {
    const f = fixture(); await expect(f.service.comment('10', '99', undefined, true)).rejects.toThrow('another entity')
    expect(f.api.mock.calls.some(c => c[0] !== 'GET')).toBe(false)
  })
  it('verifies deletion by absence rather than a successful write response', async () => {
    expect(await fixture().service.comment('10', '50', undefined, true)).toMatchObject({ deleted: true, verified: true })
  })
})
describe('workflow state safety', () => {
  it('rejects a state from another process before updating a bug', async () => {
    const tp = new TpClient()
    vi.spyOn(tp, 'api').mockImplementation(async (_method, path) => path[0] === 'Projects' ? { Process: { Id: 3 } } : { Id: 50, Project: { Id: 7 }, EntityState: { Workflow: { Id: 31 } } })
    vi.spyOn(tp, 'apiAll').mockResolvedValue([{ Id: 100, Workflow: { Id: 31 } }])
    const post = vi.spyOn(tp as any, 'post')
    await expect(tp.updateBug({ id: '50', entityStateId: '999' })).rejects.toThrow('target card workflow')
    expect(post).not.toHaveBeenCalled()
  })
  it('rejects a different team workflow even within the same project process', async () => {
    const tp = new TpClient()
    vi.spyOn(tp, 'api').mockImplementation(async (_method, path) => path[0] === 'Projects' ? { Process: { Id: 3 } } : { Id: 50, Project: { Id: 7 }, EntityState: { Workflow: { Id: 31 } } })
    vi.spyOn(tp, 'apiAll').mockResolvedValue([{ Id: 100, Workflow: { Id: 32 } }])
    await expect(tp.validateCardState('Bugs', '100', '50')).rejects.toThrow('target card workflow')
  })
  it('discovers states through the card workflow rather than configured project defaults', async () => {
    const tp = { api: vi.fn(async (_m, path) => path[0] === 'Projects' ? { Process: { Id: 3 } } : { Id: 50, Project: { Id: 7 }, EntityState: { Id: 10, Workflow: { Id: 31 } } }), apiAll: vi.fn().mockResolvedValue([{ Id: 10 }]) } as unknown as TpClient
    const result = await new Insights(tp).workflow('Bugs', '50')
    expect(result.workflow.Id).toBe(31)
    expect(tp.apiAll).toHaveBeenCalledWith(['EntityStates'], expect.objectContaining({ where: 'Workflow.Id eq 31 and Workflow.Process.Id eq 3' }))
  })
})
