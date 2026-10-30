import { setTimeout as delay } from 'node:timers/promises'
import { config } from './config.js'

export type HttpOptions = { url: string; token: string; timeoutMs?: number; readRetries?: number }
export type Query = Record<string, string | number>

export function redact(value: string, token = config.tp.token): string {
  let safe = value
  if (token) {
    safe = safe.split(token).join('***').split(encodeURIComponent(token)).join('***')
  }
  return safe
    .replace(/(access_token=)[^&\s"']*/gi, '$1***')
    .replace(/("?(?:password|token|authorization|access_token)"?\s*[:=]\s*")([^"]*)/gi, '$1***')
    .replace(/Bearer\s+\S+/gi, 'Bearer ***')
}

export class TpApiError extends Error {
  constructor(readonly operation: string, readonly status: number, readonly body: string) {
    super('Targetprocess API error (HTTP ' + status + '): ' + body + ' [' + operation + ']')
    this.name = 'TpApiError'
  }
}

export function errorDetails(error: unknown) {
  if (error instanceof TpApiError) {
    return { operation: error.operation, httpStatus: error.status, message: error.body }
  }
  return { message: redact(error instanceof Error ? error.message : String(error)).slice(0, 4000) }
}

export class TpHttp {
  constructor(private readonly options: HttpOptions = {
    url: config.tp.url, token: config.tp.token,
    timeoutMs: config.tp.timeoutMs, readRetries: config.tp.readRetries,
  }) {}

  async request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, query: Query = {}, body?: unknown, textResponse = false): Promise<T> {
    const base = new URL(this.options.url || 'https://targetprocess.invalid')
    const target = new URL(path, base)
    if (target.origin !== base.origin || target.username || target.password || !/^\/(?:api\/v[12]\/|UploadFile\.ashx$)/i.test(target.pathname)) throw new Error('Untrusted API or pagination URL')
    const operation = method + ' ' + target.pathname
    if (!target.pathname.endsWith('/') && !target.pathname.endsWith('.ashx')) target.pathname += '/'
    for (const [key, value] of Object.entries(query)) target.searchParams.set(key, String(value))
    target.searchParams.set('access_token', this.options.token)
    const url = target.toString().replace(/\+/g, '%20')
    const attempts = method === 'GET' ? (this.options.readRetries ?? 2) + 1 : 1

    for (let attempt = 0; attempt < attempts; attempt++) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30000)
      let retryDelay = 0
      try {
        const multipart = body instanceof FormData
        const response = await fetch(url, {
          method, signal: controller.signal,
          headers: multipart ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
          ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }),
          redirect: 'error',
        })
        const text = await response.text()
        if (!response.ok) {
          if (method === 'GET' && (response.status === 429 || response.status >= 500) && attempt + 1 < attempts) {
            const header = response.headers.get('Retry-After')
            const seconds = Number(header)
            const suggestedDelay = !header ? 0 : Number.isFinite(seconds) ? seconds * 1000 : Math.max(0, Date.parse(header) - Date.now())
            if (suggestedDelay > 2000) throw new TpApiError(operation, response.status, redact(text || response.statusText, this.options.token).slice(0, 3500) + '. Retry-After: ' + header)
            retryDelay = suggestedDelay > 0 ? suggestedDelay : 100 * 2 ** attempt
          } else {
            throw new TpApiError(operation, response.status, redact(text || response.statusText, this.options.token).slice(0, 4000))
          }
        } else {
          if (config.tp.debug) console.error(JSON.stringify({ operation, status: response.status }))
          if (textResponse) return text as T
          try {
            return (text ? JSON.parse(text) : null) as T
          } catch {
            throw new TpApiError(operation, response.status, 'The API returned invalid JSON' + (method === 'GET' ? '' : '. Write may have succeeded; verify records before retrying'))
          }
        }
      } catch (error) {
        if (error instanceof TpApiError) throw error
        if (method === 'GET' && attempt + 1 < attempts) retryDelay = 100 * 2 ** attempt
        else {
          const reason = controller.signal.aborted ? 'Request timed out' : redact(error instanceof Error ? error.message : String(error), this.options.token)
          const warning = method === 'GET' ? '' : '. Write outcome is unknown; verify records before retrying'
          throw new TpApiError(operation, 0, reason.slice(0, 2000) + warning)
        }
      } finally {
        clearTimeout(timeout)
      }
      await delay(retryDelay)
    }
    throw new TpApiError(operation, 0, 'Request attempts exhausted')
  }
}
