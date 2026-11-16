import type {
  Language,
  CreateLanguageDto,
  UpdateLanguageDto,
  LanguageListResponse,
} from '~~/shared/types/language'
import { api } from '~/utils/api'

export const useLanguages = () => {
  const crud = useApiCrud<Language>('/languages', {
    paginated: false,
    defaultParams: { includeAllTranslations: true },
  })

  const fetchLanguages = (params?: {
    enabled?: boolean
    includeAllTranslations?: boolean
    lang?: string
  }) => crud.fetchList(params as Record<string, any>)

  // Custom endpoint: /languages/enabled
  const fetchEnabledLanguages = async (): Promise<Language[]> => {
    try {
      const response = await api.get<LanguageListResponse>('/languages/enabled', {
        params: { includeAllTranslations: true },
      })

      if (response.success && response.data) {
        if (Array.isArray(response.data)) {
          return response.data
        } else if ((response.data as any).data && Array.isArray((response.data as any).data)) {
          return (response.data as any).data
        }
      }
      return []
    } catch {
      return []
    }
  }

  const getLanguageById = (id: number, includeAllTranslations: boolean = true) =>
    crud.getById(id, { includeAllTranslations })

  // Custom endpoint: /languages/code/:code
  const getLanguageByCode = async (code: string): Promise<Language | null> => {
    try {
      const response = await api.get<Language>(`/languages/code/${code}`)
      if (response.success && response.data) {
        return response.data as Language
      }
      return null
    } catch {
      return null
    }
  }

  const createLanguage = async (data: CreateLanguageDto) => {
    const result = await crud.create(data)
    return result.response
  }

  const updateLanguage = async (data: UpdateLanguageDto & { id: number }) => {
    const { id, ...updateData } = data
    const result = await crud.update(id, updateData, { refetch: true })
    return result.response
  }

  // Custom endpoint: /languages/:id/toggle
  const toggleLanguage = async (id: number) => {
    const response = await api.patch<Language>(`/languages/${id}/toggle`)

    if (response.success) {
      await crud.fetchList(crud._lastFilters.value)
    }

    return response
  }

  const deleteLanguage = async (id: number) => {
    const result = await crud.remove(id)
    return result.response
  }

  // Bulk: toggle uses custom endpoint per language
  const bulkEnableLanguages = async (languageIds: number[]): Promise<{ success: boolean; results: any[] }> => {
    const results = await Promise.allSettled(
      languageIds.map((id) => {
        const lang = crud._items.value.find(l => l.id === id)
        if (lang && !lang.enabled) {
          return api.patch(`/languages/${id}/toggle`)
        }
        return Promise.resolve({ success: true })
      }),
    )

    const successCount = results.filter(r => r.status === 'fulfilled').length

    if (successCount > 0) {
      await crud.fetchList(crud._lastFilters.value)
    }

    return {
      success: results.every(r => r.status === 'fulfilled'),
      results: results.map((result, index) => ({
        id: languageIds[index],
        success: result.status === 'fulfilled',
        error: result.status === 'rejected' ? result.reason : null,
      })),
    }
  }

  const bulkDisableLanguages = async (languageIds: number[]): Promise<{ success: boolean; results: any[] }> => {
    const results = await Promise.allSettled(
      languageIds.map((id) => {
        const lang = crud._items.value.find(l => l.id === id)
        if (lang && lang.enabled) {
          return api.patch(`/languages/${id}/toggle`)
        }
        return Promise.resolve({ success: true })
      }),
    )

    const successCount = results.filter(r => r.status === 'fulfilled').length

    if (successCount > 0) {
      await crud.fetchList(crud._lastFilters.value)
    }

    return {
      success: results.every(r => r.status === 'fulfilled'),
      results: results.map((result, index) => ({
        id: languageIds[index],
        success: result.status === 'fulfilled',
        error: result.status === 'rejected' ? result.reason : null,
      })),
    }
  }

  const bulkDeleteLanguages = async (languageIds: number[]) =>
    crud.bulkDelete(languageIds)

  // Computed
  const enabledLanguages = computed(() => crud._items.value.filter(l => l.enabled))
  const disabledLanguages = computed(() => crud._items.value.filter(l => !l.enabled))

  return {
    languages: crud.items,
    loading: crud.isLoading,
    error: crud.error,
    total: crud.total,
    enabledLanguages,
    disabledLanguages,
    fetchLanguages,
    fetchEnabledLanguages,
    getLanguageById,
    getLanguageByCode,
    createLanguage,
    updateLanguage,
    toggleLanguage,
    deleteLanguage,
    bulkEnableLanguages,
    bulkDisableLanguages,
    bulkDeleteLanguages,
  }
}
