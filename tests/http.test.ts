import { afterEach, describe, expect, it, vi } from 'vitest'
import { TpApiError, TpHttp, redact } from '../src/http.js'
import { config, validateConfiguration } from '../src/config.js'

const savedConfig = { ...config.tp }
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); Object.assign(config.tp, savedConfig) })

describe('API transport', () => {
  it('retains status and operation while redacting server error bodies', async () => {
    const token = 'private+token&value'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Project is required; token=' + token, { status: 422 })))
    const client = new TpHttp({ url: 'https://example.test/', token })
    await expect(client.request('POST', '/api/v1/TestCases', {}, {})).rejects.toMatchObject({
      status: 422, operation: 'POST /api/v1/TestCases', body: 'Project is required; token=***',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('retries transient reads and preserves the original request', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('Unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response('{"Id":1}'))
    vi.stubGlobal('fetch', fetchMock)
    const result = await new TpHttp({ url: 'https://example.test', token: 'secret', readRetries: 1 }).request('GET', '/api/v1/TestCases/1')
    expect(result).toEqual({ Id: 1 })
    expect(fetchMock.mock.calls[0][0]).toBe(fetchMock.mock.calls[1][0])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry earlier than a long server Retry-After window', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Rate limited', { status: 429, headers: { 'Retry-After': '60' } })))
    await expect(new TpHttp({ url: 'https://example.test', token: '' }).request('GET', '/api/v1/TestCases')).rejects.toThrow('Retry-After: 60')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not retry validation errors on reads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Forbidden', { status: 403 })))
    await expect(new TpHttp({ url: 'https://example.test', token: '' }).request('GET', '/api/v1/TestCases')).rejects.toMatchObject({ status: 403 })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('never retries an ambiguous write', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection reset')))
    await expect(new TpHttp({ url: 'https://example.test', token: '', readRetries: 5 }).request('POST', '/api/v1/TestPlanRuns', {}, {}))
      .rejects.toThrow('Write outcome is unknown')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('aborts stalled requests and reports a timeout', async () => {
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')))
    })))
    await expect(new TpHttp({ url: 'https://example.test', token: '', timeoutMs: 5, readRetries: 0 }).request('GET', '/api/v1/TestCases'))
      .rejects.toThrow('Request timed out')
  })

  it('rejects malformed success JSON without exposing its contents', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>private content</html>')))
    await expect(new TpHttp({ url: 'https://example.test', token: '' }).request('GET', '/api/v1/TestCases')).rejects.toThrow('invalid JSON')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('encodes the token and lets fetch set the multipart boundary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Uploaded')))
    const body = new FormData()
    body.append('generalId', '12'); body.append('file', new Blob(['data']), 'file.txt')
    await new TpHttp({ url: 'https://example.test/', token: 'a+b&c' }).request('POST', '/UploadFile.ashx', {}, body, true)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://example.test/UploadFile.ashx?access_token=a%2Bb%26c')
    expect(init?.headers).toEqual({ Accept: 'application/json' })
    expect(init?.body).toBe(body)
    expect(init?.redirect).toBe('error')
  })

  it('logs metadata only, even when debugging is enabled', async () => {
    config.tp.debug = true
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"Id":1}')))
    await new TpHttp({ url: 'https://example.test', token: 'secret' }).request('POST', '/api/v1/TestCases', {}, { Description: 'private business data' })
    expect(JSON.stringify(log.mock.calls)).not.toContain('private business data')
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret')
  })

  it('redacts repeated secrets and credential fields', () => {
    expect(redact('abc abc {"password":"hidden"}', 'abc')).toBe('*** *** {"password":"***"}')
  })
})

describe('startup configuration', () => {
  it('rejects missing credentials without echoing configuration values', () => {
    config.tp.url = 'https://example.test'; config.tp.token = ''
    expect(validateConfiguration).toThrow('TP_TOKEN is required')
    config.tp.url = 'invalid'
    expect(validateConfiguration).toThrow('TP_BASE_URL')
  })
  it('rejects credentialed URLs and invalid retry counts', () => {
    config.tp.url = 'https://user:password@example.test'; config.tp.token = 'secret'
    expect(validateConfiguration).toThrow('without credentials')
    config.tp.url = 'https://example.test'; config.tp.readRetries = -1
    expect(validateConfiguration).toThrow('TP_READ_RETRIES')
  })
})
