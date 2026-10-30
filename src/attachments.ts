import { createHash } from 'node:crypto'
import { basename, dirname, isAbsolute, relative, resolve, delimiter, join } from 'node:path'
import { readFile, realpath, stat, mkdir, open, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type { TpClient } from './tp.js'
import { config } from './config.js'
import { fields, safeMetadata, equivalentMarkup } from './capability_helpers.js'
import { TestManagement, assertId, referencedEvidence } from './test_management.js'
import { TpApiError, errorDetails, redact } from './http.js'
import type { CaseRun } from './test_management_types.js'

type Row = Record<string, any>
export type FileSource = { filePath?: string; fileContent?: string; fileName?: string; mimeType?: string }
export type AttachmentTarget = { entityType: string; entityId: string }
export const attachmentResources = ['Generals', 'UserStories', 'Bugs', 'Features', 'Epics', 'Tasks', 'Requests', 'TestPlans', 'TestPlanRuns', 'TestCases', 'TestCaseRuns', 'Releases', 'Iterations', 'TeamIterations', 'Messages', 'Projects', 'Teams'] as const
const maxBytes = 25 * 1024 * 1024
const hash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex')
export async function sourceBytes(source: FileSource) {
  if (source.filePath !== undefined) {
    if (source.fileContent !== undefined || source.fileName !== undefined || !isAbsolute(source.filePath)) throw new Error('Provide an absolute filePath alone, or fileContent and fileName')
    const info = await stat(source.filePath)
    if (!info.isFile() || info.size > maxBytes) throw new Error('Source must be a file of at most 25 MiB')
  } else if (source.fileContent === undefined || !source.fileName || source.fileContent.length > 35 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(source.fileContent) || Buffer.from(source.fileContent, 'base64').toString('base64') !== source.fileContent) throw new Error('Provide canonical base64 fileContent and fileName')
  const name = source.filePath ? basename(source.filePath) : source.fileName!
  if (!name || /[\/\\\r\n\0]/.test(name) || name === '.' || name === '..') throw new Error('Use a filename without directories')
  const bytes = source.filePath ? await readFile(source.filePath) : Buffer.from(source.fileContent!, 'base64')
  if (bytes.length > maxBytes) throw new Error('Attachment exceeds 25 MiB')
  return { name, bytes, size: bytes.length, sha256: hash(bytes) }
}
export async function downloadBinary(id: string): Promise<Buffer> {
  assertId(id)
  const base = new URL(config.tp.url)
  if (base.protocol !== 'https:' && base.hostname !== 'localhost' && base.hostname !== '127.0.0.1') throw new Error('Attachment credentials require HTTPS')
  const basic = process.env.TP_ATTACHMENT_BASIC_AUTH, cookie = process.env.TP_ATTACHMENT_COOKIE
  if (!basic && !cookie) throw new Error('Binary authentication unavailable: configure TP_ATTACHMENT_BASIC_AUTH (base64 user:password) or TP_ATTACHMENT_COOKIE. REST API tokens are not supported for attachment downloads by the documented API.')
  if (basic && !/^[A-Za-z0-9+/]+={0,2}$/.test(basic)) throw new Error('Invalid attachment basic-auth configuration')
  const url = new URL('/Attachment.aspx', base); url.searchParams.set('AttachmentID', id)
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), config.tp.timeoutMs)
  try {
    const response = await fetch(url, { headers: { Accept: 'application/octet-stream', ...(basic ? { Authorization: 'Basic ' + basic } : { Cookie: cookie! }) }, redirect: 'error', signal: controller.signal })
    if (!response.ok) throw new TpApiError('GET attachment binary ' + id, response.status, 'Binary retrieval rejected; check attachment authentication and permissions')
    if (/text\/html/i.test(response.headers.get('content-type') ?? '') && /login/i.test(response.url)) throw new Error('Binary endpoint returned an authentication page')
    if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Attachment exceeds 25 MiB')
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Binary response has no body')
    const chunks: Uint8Array[] = []; let size = 0
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break
        size += part.value.length
        if (size > maxBytes) { await reader.cancel(); throw new Error('Attachment exceeds 25 MiB') }
        chunks.push(part.value)
      }
    } finally { reader.releaseLock() }
    return Buffer.concat(chunks)
  } catch (e) {
    if (e instanceof TpApiError) throw e
    throw new Error(controller.signal.aborted ? 'Binary retrieval timed out' : 'Binary retrieval failed: ' + redact(e instanceof Error ? e.message : String(e)).split(basic ?? '\0').join('***').split(cookie ?? '\0').join('***'))
  } finally { clearTimeout(timer) }
}
export class Attachments {
  readonly management: TestManagement
  constructor(readonly tp: TpClient) { this.management = new TestManagement(tp) }
  async capabilities(entityType: string) {
    if (!attachmentResources.includes(entityType as typeof attachmentResources[number])) throw new Error('Unsupported resource name')
    const metadata = await this.tp.api<Row>('GET', [entityType, 'meta'])
    const descriptor = fields(metadata).get('Attachments')
    return { entityType, attachments: Boolean(descriptor?.CanGet), descriptor, directCaseRunAttachment: entityType === 'TestCaseRuns' && Boolean(descriptor?.CanGet), upload: descriptor?.CanGet ? 'General-backed entities verified individually; other owners are read/update/delete only' : 'unavailable', metadata: safeMetadata(metadata) }
  }
  async target(target: AttachmentTarget, write = false) {
    const capabilities = await this.capabilities(target.entityType)
    if (!capabilities.attachments) throw new Error(target.entityType === 'TestCaseRuns' ? 'TestCaseRun has no direct attachments; use attach_test_run_evidence on its parent TestPlanRun' : target.entityType + ' has no attachment collection')
    const entity = await this.tp.api<Row>('GET', [target.entityType, assertId(target.entityId)])
    if (String(entity?.Id) !== target.entityId) throw new Error('Attachment target identity could not be verified')
    if (write && (entity.ResourceType === 'TestPlanRun' || target.entityType === 'TestPlanRuns')) await this.management.editable(target.entityId)
    return entity
  }
  async list(target: AttachmentTarget, take = 100, skip = 0) {
    await this.target(target)
    const items = await this.tp.apiAll<Row>([target.entityType, target.entityId, 'Attachments'])
    return { ...target, items: safeMetadata(items.slice(skip, skip + take)), total: items.length, hasMore: skip + take < items.length, nextSkip: skip + take < items.length ? skip + take : null, complete: true }
  }
  async metadata(id: string, target: AttachmentTarget) {
    await this.target(target)
    const file = await this.tp.api<Row>('GET', ['Attachments', assertId(id)])
    if (String(file?.Id) !== id || String(target.entityType === 'Messages' ? file.Message?.Id : file.General?.Id) !== target.entityId) throw new Error('Attachment does not belong to the explicit target')
    return safeMetadata(file)
  }
  async read(id: string, target: AttachmentTarget, includeContent = false, maxContentBytes = 1024 * 1024) {
    const attachment = await this.metadata(id, target)
    if (!includeContent) return { attachment, contentRetrieved: false }
    const bytes = await downloadBinary(id)
    if (attachment.Size !== undefined && Number(attachment.Size) !== bytes.length) throw new Error('Downloaded byte count differs from attachment metadata')
    return { attachment, size: bytes.length, sha256: hash(bytes), contentRetrieved: true, ...(bytes.length <= maxContentBytes ? { base64: bytes.toString('base64') } : { omitted: true, reason: 'Binary exceeds requested output bound; use download_attachment or process_attachment' }) }
  }
  async download(id: string, target: AttachmentTarget, destination: string) {
    const attachment = await this.metadata(id, target)
    if (!isAbsolute(destination) || /[:*?"<>|\0]/.test(basename(destination))) throw new Error('Destination must be an absolute regular filename without alternate stream syntax')
    const roots = (process.env.TP_ATTACHMENT_DOWNLOAD_ROOTS ?? '').split(delimiter).filter(Boolean)
    if (!roots.length) throw new Error('Configure TP_ATTACHMENT_DOWNLOAD_ROOTS to allow local download destinations')
    const parent = await realpath(dirname(destination)), final = join(parent, basename(destination))
    let permitted = false
    for (const root of roots) {
      const rel = relative(await realpath(root), final)
      if (rel && !rel.startsWith('..') && !isAbsolute(rel)) permitted = true
    }
    if (!permitted) throw new Error('Destination is outside allowed download roots')
    const bytes = await downloadBinary(id)
    if (attachment.Size !== undefined && Number(attachment.Size) !== bytes.length) throw new Error('Downloaded size mismatch')
    const file = await open(final, 'wx')
    try { await file.writeFile(bytes) } catch (e) { await file.close(); await unlink(final); throw e }
    await file.close()
    return { id, destination: final, size: bytes.length, sha256: hash(bytes), verified: true }
  }
  async create(target: AttachmentTarget, source: FileSource, operationId: string) {
    const local = await sourceBytes(source)
    const entity = await this.target(target, true)
    const general = await this.tp.api<Row>('GET', ['Generals', target.entityId])
    if (String(general?.Id) !== target.entityId || (general.ResourceType && entity.ResourceType && general.ResourceType !== entity.ResourceType)) throw new Error('UploadFile supports General-backed owners only; this target is not verified as a General')
    const attachmentMeta = await this.tp.api<Row>('GET', ['Attachments', 'meta'])
    if (attachmentMeta.CanCreate !== true) throw new Error('Attachment creation is unsupported by metadata')
    const journalRoot = resolve(process.env.TP_ATTACHMENT_JOURNAL_DIR || join(tmpdir(), 'tp-mcp-attachment-operations'))
    await mkdir(journalRoot, { recursive: true })
    const fingerprint = hash(JSON.stringify([config.tp.url, target, local.name, local.sha256]))
    const journalPath = join(journalRoot, hash(config.tp.url + ':' + operationId) + '.json')
    const current = () => this.tp.apiAll<Row>([target.entityType, target.entityId, 'Attachments'])
    const before = await current()
    const reservation = { fingerprint, beforeIds: before.map(f => String(f.Id)), name: local.name, size: local.size, sha256: local.sha256, target, operationId }
    let existing: Row | undefined
    try {
      const file = await open(journalPath, 'wx')
      try { await file.writeFile(JSON.stringify(reservation)) } finally { await file.close() }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      existing = JSON.parse(await readFile(journalPath, 'utf8')) as Row
      if (existing.fingerprint !== fingerprint) throw new Error('operationId already targets different content or entity')
    }
    if (existing?.result?.verified) {
      const saved = await this.metadata(String(existing.result.attachments[0].Id), target)
      return { ...existing.result, attachments: [saved], recovered: true }
    }
    let uploadError: unknown
    if (!existing) {
      try {
        await this.tp.addAttachedFile(target.entityId, { fileContent: local.bytes.toString('base64'), fileName: local.name, mimeType: source.mimeType })
      } catch (e) { uploadError = e }
    }
    let discovered: Row[] = []
    try {
      const after = await current(), previous = new Set<string>(existing?.beforeIds ?? reservation.beforeIds)
      const candidates = after.filter(f => !previous.has(String(f.Id)) && f.Name === local.name && (f.Size === undefined || Number(f.Size) === local.size))
      discovered = candidates
      if (candidates.length !== 1) return { ...target, operationId, status: 'partial', verified: false, attachments: safeMetadata(candidates), candidateIds: candidates.map(f => f.Id), localSha256: local.sha256, error: uploadError ? errorDetails(uploadError) : undefined, recovery: 'Upload outcome is ambiguous. Retry this same operationId only to inspect/recover; it will never re-upload. Inspect ownership/content before a new operationId.' }
      const attachment = await this.metadata(String(candidates[0].Id), target)
      let binaryVerified = false
      if (process.env.TP_ATTACHMENT_BASIC_AUTH || process.env.TP_ATTACHMENT_COOKIE) {
        if (hash(await downloadBinary(String(attachment.Id))) !== local.sha256) throw new Error('Uploaded content hash mismatch')
        binaryVerified = true
      }
      const result = { ...target, generalId: target.entityId, operationId, status: 'complete', verified: true, attachments: [attachment], localSha256: local.sha256, binaryVerified, verification: binaryVerified ? 'metadata and SHA-256' : 'new attachment identity, name and available size; download authentication not configured' }
      await writeFile(journalPath, JSON.stringify({ ...reservation, result }))
      return result
    } catch (e) {
      return { ...target, operationId, status: 'partial', verified: false, attachments: safeMetadata(discovered), candidateIds: discovered.map(f => f.Id), localSha256: local.sha256, error: errorDetails(e), recovery: 'Retry the same operationId to recover existing uploads; do not use a new operationId.' }
    }
  }
  async update(id: string, target: AttachmentTarget, changes: { name?: string; description?: string }) {
    const before = await this.metadata(id, target); await this.target(target, true)
    const metadata = await this.tp.api<Row>('GET', ['Attachments', 'meta']), descriptors = fields(metadata)
    if (metadata.CanUpdate !== true) throw new Error('Attachment metadata updates are unsupported')
    const body: Row = {}
    for (const [key, field] of [['name', 'Name'], ['description', 'Description']] as const) if (changes[key] !== undefined) {
      if (descriptors.get(field)?.CanSet !== true) throw new Error(field + ' is read-only')
      body[field] = changes[key]
    }
    if (!Object.keys(body).length) throw new Error('Supply name or description')
    let writeError: unknown
    try { await this.tp.api('POST', ['Attachments', id], body) } catch (e) { writeError = e }
    try {
      const after = await this.metadata(id, target)
      if ((changes.name !== undefined && after.Name !== changes.name) || (changes.description !== undefined && !equivalentMarkup(after.Description, changes.description)) || after.Size !== before.Size) throw new Error('Attachment metadata verification failed')
      return { id, verified: true, attachment: after }
    } catch (e) { return { id, status: 'partial', verified: false, writeStatus: writeError ? 'unknown' : 'acknowledged', error: errorDetails(e), recovery: 'Read this attachment ID before retrying.' } }
  }
  async references(id: string, target: AttachmentTarget) {
    const entity = await this.target(target)
    if (entity.ResourceType !== 'TestPlanRun' && target.entityType !== 'TestPlanRuns') return { checked: false, references: [], reason: 'API provides no universal reverse-reference index for attachment links in arbitrary rich text' }
    const snapshot = await this.management.getRun(target.entityId)
    return { checked: true, references: snapshot.caseRuns.filter(row => referencedEvidence(row.Comment ?? '').has(id)).map(row => ({ testCaseRunId: String(row.Id), testPlanRunId: String(row.TestPlanRun.Id) })) }
  }
  async remove(id: string, target: AttachmentTarget, acknowledgeUnknownReferences = false) {
    await this.metadata(id, target); await this.target(target, true)
    const references = await this.references(id, target)
    if (references.references.length) throw new Error('Attachment is referenced by TestCaseRun IDs: ' + references.references.map(r => r.testCaseRunId).join(', ') + '; use update_test_run_evidence first')
    if (!references.checked && !acknowledgeUnknownReferences) throw new Error('Cross-entity rich-text references cannot be enumerated; acknowledgeUnknownReferences is required for this explicit deletion')
    const meta = await this.tp.api<Row>('GET', ['Attachments', 'meta'])
    if (meta.CanDelete !== true) throw new Error('Attachment deletion is unsupported')
    let writeError: unknown
    try { await this.tp.api('DELETE', ['Attachments', id]) } catch (e) { writeError = e }
    try {
      await this.tp.api('GET', ['Attachments', id])
      return { id, status: 'partial', deleted: false, verified: false, writeStatus: writeError ? 'unknown' : 'acknowledged', recovery: 'Attachment still exists; inspect this ID before retrying.' }
    } catch (e) {
      if (e instanceof TpApiError && e.status === 404) return { id, deleted: true, verified: true, references }
      return { id, status: 'partial', verified: false, error: errorDetails(e), recovery: 'Deletion could not be verified; inspect this ID before retrying.' }
    }
  }
  async replace(id: string, target: AttachmentTarget, source: FileSource, operationId: string, removeOriginal: boolean, acknowledgeUnknownReferences = false) {
    const original = await this.metadata(id, target)
    if (removeOriginal) {
      const refs = await this.references(id, target)
      if (refs.references.length || (!refs.checked && !acknowledgeUnknownReferences)) throw new Error('Original has evidence references or unknown cross-entity references; replace case evidence explicitly or retain the original')
    }
    const replacement = await this.create(target, source, operationId)
    if (!replacement.verified || !replacement.attachments?.[0]) return { ...replacement, originalId: id, replacementId: null, originalRemoved: false, replacementMode: 'new attachment, not in-place' }
    const newId = String(replacement.attachments[0].Id)
    if (newId === id) throw new Error('Replacement resolved to original attachment; original retained')
    try {
      if (original.Description) {
        const metadataUpdate = await this.update(newId, target, { description: original.Description })
        if (!metadataUpdate.verified) return { originalId: id, replacementId: newId, replacement, metadataUpdate, status: 'partial', verified: false, originalRemoved: false, recovery: 'Replacement was uploaded; inspect its metadata before removing the original.' }
      }
      const deletion = removeOriginal ? await this.remove(id, target, acknowledgeUnknownReferences) : undefined
      return { replacementMode: 'new attachment, not in-place', originalId: id, replacementId: newId, replacement, deletion, originalRemoved: Boolean(deletion?.deleted), verified: replacement.verified && (!removeOriginal || Boolean(deletion?.verified)) }
    } catch (e) {
      return { replacementMode: 'new attachment, not in-place', originalId: id, replacementId: newId, replacement, status: 'partial', verified: false, originalRemoved: false, error: errorDetails(e), recovery: 'Replacement exists. Read both IDs before retrying; do not re-upload.' }
    }
  }
  async evidence(caseRunId: string, attachmentId: string, replacementId?: string, removeBacking = false) {
    assertId(caseRunId); assertId(attachmentId); if (replacementId) assertId(replacementId)
    if (replacementId === attachmentId) throw new Error('Replacement must be a different attachment ID')
    const row = await this.tp.api<CaseRun>('GET', ['TestCaseRuns', caseRunId])
    const target = { entityType: 'TestPlanRuns', entityId: String(row.TestPlanRun.Id) }
    await this.management.editable(target.entityId)
    await this.metadata(attachmentId, target)
    const replacement = replacementId ? await this.metadata(replacementId, target) : undefined
    if (!referencedEvidence(row.Comment ?? '').has(attachmentId)) throw new Error('This exact case result does not reference the attachment')
    const { JSDOM } = await import('jsdom'), dom = new JSDOM(row.Comment ?? '')
    let note: string
    try {
      const document = dom.window.document
      for (const element of document.querySelectorAll('[href], [src]')) {
        for (const attribute of ['href', 'src']) {
          const value = element.getAttribute(attribute)
          if (!value) continue
          const url = new URL(value, 'https://targetprocess.invalid')
          const key = [...url.searchParams.keys()].find(key => key.toLowerCase() === 'attachmentid')
          if (!/\/Attachment\.aspx$/i.test(url.pathname) || !key || url.searchParams.get(key) !== attachmentId) continue
          if (replacementId) {
            if (element.tagName === 'IMG' && !/^image\/(png|jpeg|gif|webp)$/i.test(replacement?.MimeType ?? '') && !/\.(png|jpe?g|gif|webp)$/i.test(replacement?.Name ?? '')) { element.remove(); continue }
            url.searchParams.set(key, replacementId); element.setAttribute(attribute, url.pathname + url.search)
            if (element.tagName === 'A') element.textContent = (replacement?.Name ?? 'Evidence') + ' (attachment ' + replacementId + ')'
          }
          else element.remove()
        }
      }
      document.body.innerHTML = document.body.innerHTML.replace(/((?:Evidence attachment IDs:|Evidence for TestCaseRun \d+: attachment IDs)\s*)([\d, ]+)/gi, (_all, prefix, ids) => prefix + String(ids).split(',').map(s => s.trim()).filter(Boolean).flatMap(s => s === attachmentId ? replacementId ? [replacementId] : [] : [s]).join(', '))
      note = document.body.innerHTML
    } finally { dom.window.close() }
    const current = await this.tp.api<CaseRun>('GET', ['TestCaseRuns', caseRunId])
    if (current.Comment !== row.Comment || current.TestPlanRun.Id !== row.TestPlanRun.Id) throw new Error('Case result changed concurrently; no result update attempted')
    let writeError: unknown
    try { await this.tp.api('POST', ['TestCaseRuns', caseRunId], { Comment: note }) } catch (e) { writeError = e }
    try {
      const after = await this.tp.api<CaseRun>('GET', ['TestCaseRuns', caseRunId])
      if (!equivalentMarkup(after.Comment, note)) throw new Error('Case-result reference update could not be verified')
      const shared = await this.references(attachmentId, target)
      const deletion = removeBacking && !shared.references.length ? await this.remove(attachmentId, target) : undefined
      return { testCaseRunId: caseRunId, originalId: attachmentId, replacementId: replacementId ?? null, referenceUpdated: true, sharedReferences: shared.references, backingRetained: !Boolean((deletion as Row)?.deleted), deletion, verified: !deletion || Boolean((deletion as Row).verified) }
    } catch (e) { return { testCaseRunId: caseRunId, originalId: attachmentId, replacementId, status: 'partial', verified: false, writeStatus: writeError ? 'unknown' : 'acknowledged', error: errorDetails(e), recovery: 'Inspect this case result and both attachment IDs; files have not been automatically re-uploaded.' } }
  }
}
