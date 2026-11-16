/**
 * Enhanced API utility with automatic authentication headers
 * All requests go through the Nitro proxy with encrypted payloads
 */
import type { ApiResult, ApiResponse, ApiErrorResponse } from '~~/shared/types/api'
import { proxyFetch } from './proxyFetch'

interface ApiOptions {
  params?: Record<string, any>
  requireAuth?: boolean
  method?: string
  body?: any
  headers?: Record<string, string>
}

let globalLogout: (() => Promise<void>) | null = null

export const setGlobalLogout = (logoutFn: () => Promise<void>) => {
  globalLogout = logoutFn
}

async function handleTokenExpired(data: any) {
  const errorCode = data?.errorCode ?? data?.data?.errorCode
  if (errorCode === 'TOKEN_EXPIRED' && globalLogout) {
    try { await globalLogout() } catch (e) { console.error('Error during auto-logout:', e) }
  }
}

export const api = {
  /**
   * Generic API call with automatic components headers
   */
  async call<T = any>(endpoint: string, options: ApiOptions = {}): Promise<ApiResult<T>> {
    const { getToken, autoRefreshToken } = useAuth()

    const {
      requireAuth = true,
      params,
      headers = {},
      method = 'GET',
      body,
    } = options

    // Auto-refresh token if needed and components is required
    if (requireAuth) {
      await autoRefreshToken()
    }

    // Add authentication header if required and token exists
    if (requireAuth) {
      const token = getToken()
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }
    }

    if (!headers['Accept-Language']) {
      headers['Accept-Language'] = 'fr'
    }

    try {
      const response = await proxyFetch<any>(endpoint, {
        method,
        headers,
        body,
        params,
      })

      await handleTokenExpired(response)

      // Si la réponse a déjà la structure ApiResult, on la retourne telle quelle
      if (response && typeof response === 'object' && 'success' in response) {
        return response as ApiResult<T>
      }

      // Sinon, on wrappe la réponse dans la structure ApiResult
      return {
        success: true,
        data: response,
        message: 'Success'
      } as ApiResult<T>
    } catch (error: any) {
      await handleTokenExpired(error)

      // Si erreur 401 et qu'on a l'components requise, tenter un refresh
      if (error.status === 401 && requireAuth) {
        const refreshSuccess = await autoRefreshToken()
        if (refreshSuccess) {
          // Retry with new token
          const newToken = getToken()
          if (newToken) {
            headers['Authorization'] = `Bearer ${newToken}`
            try {
              const retryResponse = await proxyFetch<ApiResult<T>>(endpoint, {
                method,
                headers,
                body,
                params,
              })

              await handleTokenExpired(retryResponse)
              return retryResponse
            } catch (retryError: any) {
              // Si ça échoue encore, retourner l'erreur
              const errorResponse: ApiErrorResponse = {
                success: false,
                error: {
                  code: retryError.statusCode || 'NETWORK_ERROR',
                  message: retryError.message || 'Une erreur est survenue',
                  details: retryError.data || []
                }
              }

              await handleTokenExpired(retryError)
              return errorResponse
            }
          }
        }
      }

      // Handle error and return in standard format
      const errorResponse: ApiErrorResponse = {
        success: false,
        error: {
          code: error.statusCode || 'NETWORK_ERROR',
          message: error.message || 'Une erreur est survenue',
          details: error.data || []
        }
      }
      return errorResponse
    }
  },

  /**
   * GET request
   */
  async get<T = any>(endpoint: string, options: Omit<ApiOptions, 'method'> = {}): Promise<ApiResult<T>> {
    return this.call<T>(endpoint, { ...options, method: 'GET' })
  },

  /**
   * POST request
   */
  async post<T = any>(endpoint: string, body?: any, options: Omit<ApiOptions, 'method' | 'body'> = {}): Promise<ApiResult<T>> {
    return this.call<T>(endpoint, {
      ...options,
      method: 'POST',
      body,
    })
  },

  /**
   * PUT request
   */
  async put<T = any>(endpoint: string, body?: any, options: Omit<ApiOptions, 'method' | 'body'> = {}): Promise<ApiResult<T>> {
    return this.call<T>(endpoint, {
      ...options,
      method: 'PUT',
      body,
    })
  },

  /**
   * PATCH request
   */
  async patch<T = any>(endpoint: string, body?: any, options: Omit<ApiOptions, 'method' | 'body'> = {}): Promise<ApiResult<T>> {
    return this.call<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body,
    })
  },

  /**
   * DELETE request
   */
  async delete<T = any>(endpoint: string, options: Omit<ApiOptions, 'method'> = {}): Promise<ApiResult<T>> {
    return this.call<T>(endpoint, { ...options, method: 'DELETE' })
  }
}

/**
 * Enhanced version of createApiOperation with automatic components
 */
export function createApiOperation<T>(endpoint: string, requireAuth: boolean = true) {
  function serialize(body: T | object): Record<string, any> {
    return JSON.parse(JSON.stringify(body))
  }

  async function collection(params?: object): Promise<ApiResult<T[]>> {
    return await api.get<T[]>(endpoint, { params, requireAuth })
  }

  async function item(id: number | string): Promise<ApiResult<T>> {
    return await api.get<T>(`${endpoint}/${id}`, { requireAuth })
  }

  async function post(body: T | FormData): Promise<ApiResult<T>> {
    const serializedBody = body instanceof FormData ? body : serialize(body)
    return await api.post<T>(endpoint, serializedBody, { requireAuth })
  }

  async function patch(body: T): Promise<ApiResult<T>> {
    const _body = body as T & { id: number | string }
    if (!_body.id) {
      throw new Error('id is required')
    }

    return await api.patch<T>(`${endpoint}/${_body.id}`, serialize(_body), { requireAuth })
  }

  async function put(body: T): Promise<ApiResult<T>> {
    const _body = body as T & { id: number | string }
    if (!_body.id) {
      throw new Error('id is required')
    }

    return await api.put<T>(`${endpoint}/${_body.id}`, serialize(_body), { requireAuth })
  }

  async function remove(id: number | string): Promise<ApiResult<T>> {
    return await api.delete<T>(`${endpoint}/${id}`, { requireAuth })
  }

  return {
    collection,
    item,
    post,
    patch,
    put,
    remove,
  }
}
