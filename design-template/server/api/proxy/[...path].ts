export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const encryptionKey = config.public.encryptionKey as string
  const apiBaseUrl = config.apiBaseUrl as string
  const apiKey = config.apiKey as string

  // Get the proxied path
  const path = getRouterParam(event, 'path') || ''

  // Read real HTTP method from header
  const method = getRequestHeader(event, 'x-proxy-method') || 'GET'

  // Read forwarded headers
  let forwardedHeaders: Record<string, string> = {}
  const proxyHeaders = getRequestHeader(event, 'x-proxy-headers')
  if (proxyHeaders) {
    try {
      forwardedHeaders = JSON.parse(proxyHeaders)
    } catch {
      // ignore malformed header
    }
  }

  // Read and decrypt payload (contains body + params)
  let body: any = undefined
  let decryptedParams: Record<string, any> = {}
  const rawBody = await readBody(event).catch(() => null)

  if (rawBody && typeof rawBody === 'object' && rawBody._encrypted) {
    try {
      const decrypted = decrypt(rawBody._encrypted, encryptionKey)
      if (decrypted && typeof decrypted === 'object') {
        body = decrypted._body
        decryptedParams = decrypted._params || {}
      } else {
        body = decrypted
      }
    } catch (err) {
      throw createError({ statusCode: 400, message: 'Failed to decrypt request body' })
    }
  } else if (rawBody && typeof rawBody === 'object' && !rawBody._encrypted) {
    body = rawBody
  }

  const start = Date.now()

  // Build target URL with decrypted params
  const url = new URL(`${apiBaseUrl}/${path}`)
  for (const [key, value] of Object.entries(decryptedParams)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value))
    }
  }
  const targetUrl = url.toString()

  // Build headers for the backend request
  const headers: Record<string, string> = {
    'Accept-Language': 'fr',
    ...forwardedHeaders,
  }

  if (apiKey) {
    headers['X-API-Key'] = apiKey
  }

  const isBodyAllowed = !['GET', 'HEAD'].includes(method.toUpperCase())

  if (isBodyAllowed && body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }

  if (import.meta.dev) {
    logger.info(`→ ${method} ${targetUrl}`)
    logger.debug({ headers }, 'request headers')
    if (isBodyAllowed && body) logger.debug({ body }, 'payload')
  }

  try {
    const response = await $fetch.raw(targetUrl, {
      method: method as any,
      headers,
      body: isBodyAllowed && body ? JSON.stringify(body) : undefined,
    })

    const duration = Date.now() - start
    const responseData = response._data

    if (import.meta.dev) {
      logger.info(`← ${method} ${targetUrl} ${response.status} (${duration}ms)`)
      logger.debug({ data: responseData }, 'response')
    }

    const encrypted = encrypt(responseData, encryptionKey)

    setResponseStatus(event, response.status)
    return { _encrypted: encrypted }
  } catch (error: any) {
    const duration = Date.now() - start
    const status = error.status || error.statusCode || 500
    const errorData = error.data || { message: error.message || 'Proxy error' }

    if (import.meta.dev) {
      logger.error(`← ${method} ${targetUrl} ${status} (${duration}ms) ${errorData.message || ''}`)
      logger.debug({ data: errorData }, 'error response')
    }

    const encrypted = encrypt(errorData, encryptionKey)

    setResponseStatus(event, status)
    return { _encrypted: encrypted }
  }
})
