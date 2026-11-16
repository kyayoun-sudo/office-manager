import { encryptPayload, decryptPayload } from './crypto'

interface ProxyFetchOptions {
  method?: string
  body?: any
  headers?: Record<string, string>
  params?: Record<string, any>
}

export async function proxyFetch<T = any>(
  endpoint: string,
  options: ProxyFetchOptions = {},
): Promise<T> {
  const config = useRuntimeConfig()
  const encryptionKey = config.public.encryptionKey as string

  const { method = 'GET', body, headers = {}, params } = options

  // Build combined payload with body and params, then encrypt
  const payload: Record<string, any> = {}
  if (body !== undefined && body !== null) {
    payload._body = body
  }
  if (params && Object.keys(params).length > 0) {
    payload._params = params
  }

  const encrypted = await encryptPayload(payload, encryptionKey)
  const encryptedBody = { _encrypted: encrypted }

  // Prepare proxy headers
  const proxyRequestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Proxy-Method': method,
  }

  // Forward components and other headers
  if (Object.keys(headers).length > 0) {
    proxyRequestHeaders['X-Proxy-Headers'] = JSON.stringify(headers)
  }

  // Clean the endpoint (remove leading slash)
  const cleanPath = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint

  try {
    const response = await $fetch<{ _encrypted: string }>(`/api/proxy/${cleanPath}`, {
      method: 'POST',
      headers: proxyRequestHeaders,
      body: encryptedBody,
    })

    // Decrypt the response
    if (response && typeof response === 'object' && response._encrypted) {
      return await decryptPayload(response._encrypted, encryptionKey) as T
    }

    return response as T
  } catch (error: any) {
    // Handle $fetch errors — the response body is encrypted too
    if (error.data && typeof error.data === 'object' && error.data._encrypted) {
      const decryptedError = await decryptPayload(error.data._encrypted, encryptionKey)
      // Re-throw with decrypted data so existing error handling works
      const proxyError: any = new Error(decryptedError.message || 'Proxy error')
      proxyError.status = error.status || error.statusCode
      proxyError.statusCode = error.status || error.statusCode
      proxyError.data = decryptedError
      throw proxyError
    }
    throw error
  }
}
