import { api } from '~/utils/api'

export interface UseApiCrudOptions<T> {
  limit?: number
  idKey?: keyof T & string
  paginated?: boolean
  defaultParams?: Record<string, any>
}

export interface BulkResultItem {
  id: number | string
  success: boolean
  error: any
}

export interface BulkResult {
  success: boolean
  results: BulkResultItem[]
}

export const useApiCrud = <T extends Record<string, any>>(
  endpoint: string,
  options?: UseApiCrudOptions<T>,
) => {
  const { handlePaginatedResponse, handleApiResponse } = useApiResponse()

  const limit = options?.limit ?? 20
  const idKey = (options?.idKey ?? 'id') as string
  const paginated = options?.paginated ?? true
  const defaultParams = options?.defaultParams ?? {}

  // --- State ---
  const items = ref<T[]>([]) as Ref<T[]>
  const isLoading = ref(false)
  const isLoadingMore = ref(false)
  const error = ref<string | null>(null)
  const hasMore = ref(paginated)
  const pagination = ref<{
    total: number
    page: number
    limit: number
    totalPages: number
  } | null>(null)
  const lastFilters = ref<Record<string, any>>({})

  // --- Computed ---
  const total = computed(() => pagination.value?.total ?? items.value.length)
  const currentPage = computed(() => pagination.value?.page ?? 1)
  const totalPages = computed(() => pagination.value?.totalPages ?? 1)
  const itemsPerPage = computed(() => pagination.value?.limit ?? limit)
  const isEmpty = computed(() => items.value.length === 0)

  // --- fetchList ---
  const fetchList = async (filters?: Record<string, any>) => {
    isLoading.value = true
    error.value = null

    try {
      const params = { ...defaultParams, ...filters }
      lastFilters.value = { ...params }

      const response = await api.get<any>(endpoint, { params })

      if (paginated) {
        const result = handlePaginatedResponse<T>(response)

        if (result.success) {
          items.value = result.data
          if (result.pagination) {
            pagination.value = {
              total: result.pagination.total,
              page:
                result.pagination.page ??
                (result.pagination as any).currentPage ??
                1,
              limit: result.pagination.limit,
              totalPages:
                result.pagination.totalPages ??
                Math.ceil(
                  (result.pagination.total || result.data.length) /
                    (result.pagination.limit || limit),
                ),
            }
          } else {
            pagination.value = {
              total: result.data.length,
              page: 1,
              limit,
              totalPages: 1,
            }
          }
          hasMore.value = currentPage.value < totalPages.value
        } else {
          error.value = result.error || 'Erreur lors du chargement'
          items.value = []
          pagination.value = null
          hasMore.value = false
        }
      } else {
        // Non-paginated: parse manually like the old composables did
        if (response.success && response.data) {
          let parsed: T[] = []
          if (Array.isArray(response.data)) {
            parsed = response.data
          } else if (response.data.data && Array.isArray(response.data.data)) {
            parsed = response.data.data
          }
          items.value = parsed
          pagination.value = {
            total: parsed.length,
            page: 1,
            limit: parsed.length,
            totalPages: 1,
          }
          hasMore.value = false
        } else {
          error.value = 'Aucune donnée reçue du serveur'
          items.value = []
          pagination.value = null
          hasMore.value = false
        }
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors du chargement'
      items.value = []
      pagination.value = null
      hasMore.value = false
    } finally {
      isLoading.value = false
    }
  }

  // --- fetchMore (infinite scroll) ---
  const fetchMore = async (): Promise<boolean> => {
    if (isLoadingMore.value || !hasMore.value) return false

    isLoadingMore.value = true

    try {
      const nextPage = currentPage.value + 1
      const params = { ...lastFilters.value, page: nextPage }

      const response = await api.get<any>(endpoint, { params })
      const result = handlePaginatedResponse<T>(response)

      if (result.success && result.data.length > 0) {
        const existingIds = new Set(items.value.map((item) => item[idKey]))
        const newItems = result.data.filter(
          (item: T) => !existingIds.has(item[idKey]),
        )
        items.value = [...items.value, ...newItems]

        const pag = result.pagination
        if (pag) {
          pagination.value = {
            total: pag.total,
            page: pag.page ?? (pag as any).currentPage ?? nextPage,
            limit: pag.limit,
            totalPages:
              pag.totalPages ??
              Math.ceil(
                (pag.total || result.data.length) / (pag.limit || limit),
              ),
          }
        } else {
          pagination.value = {
            total: items.value.length,
            page: nextPage,
            limit,
            totalPages: nextPage,
          }
        }
        hasMore.value = currentPage.value < totalPages.value

        return newItems.length > 0
      } else {
        hasMore.value = false
        return false
      }
    } catch (err: any) {
      console.error('Erreur fetchMore:', err)
      return false
    } finally {
      isLoadingMore.value = false
    }
  }

  // --- getById ---
  const getById = async (
    id: number | string,
    params?: Record<string, any>,
  ): Promise<T | null> => {
    try {
      const response = await api.get<any>(`${endpoint}/${id}`, { params })
      const result = handleApiResponse<T>(response)

      if (result.success && result.data) {
        return result.data
      } else {
        error.value = result.error || 'Élément non trouvé'
        return null
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors du chargement'
      return null
    }
  }

  // --- create ---
  const create = async (
    body: any,
  ): Promise<{ success: boolean; data: T | null; response: any }> => {
    isLoading.value = true
    error.value = null

    try {
      const response = await api.post<T>(endpoint, body)

      if (response.success) {
        await fetchList(lastFilters.value)
        const result = handleApiResponse<T>(response)
        return { success: true, data: result.data, response }
      } else {
        error.value =
          (response as any).error?.message || 'Erreur lors de la création'
        return { success: false, data: null, response }
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors de la création'
      return { success: false, data: null, response: null }
    } finally {
      isLoading.value = false
    }
  }

  // --- update ---
  const update = async (
    id: number | string,
    body: any,
    opts?: { method?: 'patch' | 'put'; refetch?: boolean },
  ): Promise<{ success: boolean; data: T | null; response: any }> => {
    isLoading.value = true
    error.value = null

    try {
      const method = opts?.method ?? 'patch'
      const response =
        method === 'put'
          ? await api.put<T>(`${endpoint}/${id}`, body)
          : await api.patch<T>(`${endpoint}/${id}`, body)

      if (response.success) {
        if (opts?.refetch) {
          await fetchList(lastFilters.value)
        } else {
          // Update in-place
          const result = handleApiResponse<T>(response)
          if (result.data) {
            const index = items.value.findIndex((item) => item[idKey] === id)
            if (index !== -1) {
              items.value[index] = result.data
            }
          }
        }
        const result = handleApiResponse<T>(response)
        return { success: true, data: result.data, response }
      } else {
        error.value =
          (response as any).error?.message || 'Erreur lors de la mise à jour'
        return { success: false, data: null, response }
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors de la mise à jour'
      return { success: false, data: null, response: null }
    } finally {
      isLoading.value = false
    }
  }

  // --- remove ---
  const remove = async (
    id: number | string,
  ): Promise<{ success: boolean; response: any }> => {
    isLoading.value = true
    error.value = null

    try {
      const response = await api.delete(`${endpoint}/${id}`)

      if (response.success) {
        // Remove from local list
        items.value = items.value.filter((item) => item[idKey] !== id)
        if (pagination.value) {
          pagination.value = {
            ...pagination.value,
            total: Math.max(0, pagination.value.total - 1),
          }
        }
        return { success: true, response }
      } else {
        error.value =
          (response as any).error?.message || 'Erreur lors de la suppression'
        return { success: false, response }
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors de la suppression'
      return { success: false, response: null }
    } finally {
      isLoading.value = false
    }
  }

  // --- bulkUpdate ---
  const bulkUpdate = async (
    ids: (number | string)[],
    body: any,
  ): Promise<BulkResult> => {
    const results = await Promise.allSettled(
      ids.map((id) => api.patch(`${endpoint}/${id}`, body)),
    )

    const successCount = results.filter(
      (r) => r.status === 'fulfilled' && (r.value as any).success,
    ).length

    if (successCount > 0) {
      await fetchList(lastFilters.value)
    }

    return {
      success: results.every(
        (r) => r.status === 'fulfilled' && (r.value as any).success,
      ),
      results: results.map((result, index) => ({
        id: ids[index],
        success: result.status === 'fulfilled' && (result.value as any).success,
        error: result.status === 'rejected' ? result.reason : null,
      })),
    }
  }

  // --- bulkDelete ---
  const bulkDelete = async (ids: (number | string)[]): Promise<BulkResult> => {
    const results = await Promise.allSettled(
      ids.map((id) => api.delete(`${endpoint}/${id}`)),
    )

    const successCount = results.filter(
      (r) => r.status === 'fulfilled' && (r.value as any).success,
    ).length

    if (successCount > 0) {
      await fetchList(lastFilters.value)
    }

    return {
      success: results.every(
        (r) => r.status === 'fulfilled' && (r.value as any).success,
      ),
      results: results.map((result, index) => ({
        id: ids[index],
        success: result.status === 'fulfilled' && (result.value as any).success,
        error: result.status === 'rejected' ? result.reason : null,
      })),
    }
  }

  // --- reset ---
  const reset = () => {
    items.value = []
    isLoading.value = false
    isLoadingMore.value = false
    error.value = null
    hasMore.value = paginated
    pagination.value = null
    lastFilters.value = {}
  }

  return {
    // State (readonly)
    items: readonly(items) as Readonly<Ref<T[]>>,
    isLoading: readonly(isLoading),
    isLoadingMore: readonly(isLoadingMore),
    error: readonly(error),
    hasMore: readonly(hasMore),
    pagination: readonly(pagination),

    // Computed
    total,
    currentPage,
    totalPages,
    itemsPerPage,
    isEmpty,

    // List
    fetchList,
    fetchMore,

    // CRUD
    getById,
    create,
    update,
    remove,

    // Bulk
    bulkUpdate,
    bulkDelete,

    // Utilities
    reset,
    _items: items,
    _lastFilters: lastFilters,
    _pagination: pagination,
  }
}
