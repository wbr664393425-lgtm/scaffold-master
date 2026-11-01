export interface ApiResponse<T> {
  code: number
  message: string
  data: T
  traceId?: string
}

export interface HttpClientOptions {
  baseUrl?: string
  tokenProvider?: () => string | null
  fetcher?: typeof fetch
}

export interface HttpClient {
  get<T>(path: string, query?: QueryParams): Promise<T>
  post<T>(path: string, body?: unknown): Promise<T>
  put<T>(path: string, body?: unknown): Promise<T>
  delete<T>(path: string): Promise<T>
  download(path: string, query?: QueryParams): Promise<Blob>
  /** 导出接口以 POST + 表单参数接收查询条件（沿用旧后端 $download.post 的传参方式） */
  downloadForm(path: string, form?: QueryParams): Promise<Blob>
}

export type QueryParams = Record<string, string | number | boolean | null | undefined>

export class ApiError extends Error {
  code: number
  status: number
  traceId?: string

  constructor(message: string, code: number, status: number, traceId?: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.traceId = traceId
  }
}

let unauthorizedHandler: (() => void) | null = null

/** 登录失效（401）时的统一处理，由路由层注册 */
export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler
}

export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? defaultBaseUrl())
  const tokenProvider = options.tokenProvider ?? authSession.token
  const fetcher = options.fetcher ?? fetch

  async function request<T>(method: string, path: string, body?: unknown, query?: QueryParams): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    const token = tokenProvider()
    if (token) headers.Authorization = `Bearer ${token}`
    const init: RequestInit = { method, headers }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(body)
    }

    const response = await fetcher(buildUrl(baseUrl, path, query), init)
    const payload = await parseJson<ApiResponse<T>>(response)
    if (!response.ok || payload.code !== 200) {
      if ((payload.code === 401 || response.status === 401) && token && token === tokenProvider()) unauthorizedHandler?.()
      throw new ApiError(payload.message || '请求失败', payload.code || response.status, response.status, payload.traceId)
    }
    return payload.data
  }

  async function download(path: string, query?: QueryParams): Promise<Blob> {
    const headers: Record<string, string> = { Accept: 'text/csv,application/octet-stream,*/*' }
    const token = tokenProvider()
    if (token) headers.Authorization = `Bearer ${token}`

    const response = await fetcher(buildUrl(baseUrl, path, query), { method: 'GET', headers })
    return readBlob(response, token, '下载失败')
  }

  async function downloadForm(path: string, form?: QueryParams): Promise<Blob> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*',
      'Content-Type': 'application/x-www-form-urlencoded',
    }
    const token = tokenProvider()
    if (token) headers.Authorization = `Bearer ${token}`

    const response = await fetcher(buildUrl(baseUrl, path), { method: 'POST', headers, body: toQueryString(form ?? {}) })
    return readBlob(response, token, '导出失败')
  }

  async function readBlob(response: Response, token: string | null, fallback: string): Promise<Blob> {
    if (!response.ok) {
      const payload = await parseJson<ApiResponse<unknown>>(response)
      if ((payload.code === 401 || response.status === 401) && token && token === tokenProvider()) unauthorizedHandler?.()
      throw new ApiError(payload.message || fallback, payload.code || response.status, response.status, payload.traceId)
    }
    return response.blob()
  }

  return {
    get: (path, query) => request('GET', path, undefined, query),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    delete: (path) => request('DELETE', path),
    download,
    downloadForm,
  }
}

function normalizeBaseUrl(value: string) {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function defaultBaseUrl() {
  return ((import.meta as ImportMeta & { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL) || '/api'
}

function buildUrl(baseUrl: string, path: string, query?: QueryParams) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const queryString = query ? toQueryString(query) : ''
  return `${baseUrl}${normalizedPath}${queryString ? `?${queryString}` : ''}`
}

function toQueryString(query: QueryParams) {
  const params = new URLSearchParams()
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value))
    }
  })
  return params.toString()
}

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (!text) {
    return { code: response.status, message: response.statusText, data: null } as T
  }
  return JSON.parse(text) as T
}

import { authSession } from './session.ts'

export const httpClient = createHttpClient()
