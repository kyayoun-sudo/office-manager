import type { Midwife, MidwifeFilters } from '~~~/shared/types/midwife'
import { api } from '~/utils/api'

export const useMidwives = () => {
  const { handleApiResponse } = useApiResponse()
  const crud = useApiCrud<Midwife>('/clinicians', { limit: 20 })

  // Fetch all components
  const fetchMidwives = async (filters?: MidwifeFilters | Record<string, any>) => {
    const params: Record<string, any> = {}

    if (filters) {
      if ('page' in filters && filters.page) params.page = filters.page
      if ('limit' in filters && filters.limit) params.limit = filters.limit
      if ('sortBy' in filters && filters.sortBy) params.sortBy = filters.sortBy
      if ('sortOrder' in filters && filters.sortOrder) params.sortOrder = filters.sortOrder
      if ('verified' in filters && filters.verified !== undefined) params.verified = filters.verified
      if ('specialtyId' in filters && filters.specialtyId) params.specialtyId = filters.specialtyId
      if ('acceptingNewPatients' in filters && filters.acceptingNewPatients !== undefined) params.acceptingNewPatients = filters.acceptingNewPatients
      if ('languages' in filters && filters.languages) params.languages = filters.languages
      if ('lang' in filters && filters.lang) params.lang = filters.lang
      if ('includeAllTranslations' in filters) params.includeAllTranslations = filters.includeAllTranslations
      if ('latitude' in filters && filters.latitude) params.latitude = filters.latitude
      if ('longitude' in filters && filters.longitude) params.longitude = filters.longitude
      if ('radius' in filters && filters.radius) params.radius = filters.radius
      if ('locationSort' in filters && filters.locationSort) params.locationSort = filters.locationSort
      if ('search' in filters && filters.search) params.search = filters.search
      if ('specialtyCode' in filters && filters.specialtyCode) params.specialtyCode = filters.specialtyCode
      if ('isActive' in filters && filters.isActive !== undefined) params.isActive = filters.isActive
    }

    return crud.fetchList(params)
  }

  // Get midwife by ID
  const getMidwifeById = async (id: number): Promise<Midwife | null> =>
    crud.getById(id)

  // Validate midwife — custom endpoint
  const validateMidwife = async (id: number): Promise<boolean> => {
    try {
      const response = await api.patch(`/clinicians/${id}/verification`, { verified: true })
      const { success } = handleApiResponse(response)

      if (success) {
        const midwifeIndex = crud._items.value.findIndex(m => m.id === id)
        if (midwifeIndex !== -1) {
          crud._items.value[midwifeIndex].verified = true
          crud._items.value[midwifeIndex].verifiedAt = new Date().toISOString()
        }
        return true
      }
      return false
    } catch {
      return false
    }
  }

  // Reject midwife validation — custom endpoint
  const rejectMidwife = async (id: number, reason: string): Promise<boolean> => {
    try {
      const response = await api.patch(`/clinicians/${id}/verification`, {
        verified: false,
        reason,
      })
      const { success } = handleApiResponse(response)

      if (success) {
        const midwifeIndex = crud._items.value.findIndex(m => m.id === id)
        if (midwifeIndex !== -1) {
          crud._items.value[midwifeIndex].verified = false
          crud._items.value[midwifeIndex].verifiedAt = null
          crud._items.value[midwifeIndex].rejectionReason = reason
        }
        return true
      }
      return false
    } catch {
      return false
    }
  }

  // Delete midwife
  const deleteMidwife = async (id: number): Promise<boolean> => {
    const result = await crud.remove(id)
    return result.success
  }

  // Bulk actions — custom verification endpoint
  const bulkValidateMidwives = async (ids: number[]): Promise<{
    success: boolean
    results: { success: number; failed: number }
  }> => {
    const results = { success: 0, failed: 0 }

    try {
      const promises = ids.map(async (id) => {
        try {
          const response = await api.patch(`/clinicians/${id}/verification`, { verified: true })
          const { success } = handleApiResponse(response)

          if (success) {
            const midwifeIndex = crud._items.value.findIndex(m => m.id === id)
            if (midwifeIndex !== -1) {
              crud._items.value[midwifeIndex].verified = true
              crud._items.value[midwifeIndex].verifiedAt = new Date().toISOString()
            }
            results.success++
          } else {
            results.failed++
          }
        } catch {
          results.failed++
        }
      })

      await Promise.all(promises)
      return { success: true, results }
    } catch {
      return { success: false, results }
    }
  }

  const bulkRejectMidwives = async (rejections: { id: number; reason: string }[]): Promise<{
    success: boolean
    results: { success: number; failed: number }
  }> => {
    const results = { success: 0, failed: 0 }

    try {
      const promises = rejections.map(async ({ id, reason }) => {
        try {
          const response = await api.patch(`/clinicians/${id}/verification`, {
            verified: false,
            reason,
          })
          const { success } = handleApiResponse(response)

          if (success) {
            const midwifeIndex = crud._items.value.findIndex(m => m.id === id)
            if (midwifeIndex !== -1) {
              crud._items.value[midwifeIndex].verified = false
              crud._items.value[midwifeIndex].verifiedAt = null
              crud._items.value[midwifeIndex].rejectionReason = reason
            }
            results.success++
          } else {
            results.failed++
          }
        } catch {
          results.failed++
        }
      })

      await Promise.all(promises)
      return { success: true, results }
    } catch {
      return { success: false, results }
    }
  }

  const bulkDeleteMidwives = async (ids: number[]): Promise<{
    success: boolean
    results: { success: number; failed: number }
  }> => {
    const results = { success: 0, failed: 0 }

    try {
      const promises = ids.map(async (id) => {
        try {
          const response = await api.delete(`/clinicians/${id}`)
          const { success } = handleApiResponse(response)

          if (success) {
            results.success++
          } else {
            results.failed++
          }
        } catch {
          results.failed++
        }
      })

      await Promise.all(promises)

      if (results.success > 0) {
        crud._items.value = crud._items.value.filter(m => !ids.includes(m.id))
        if (crud._pagination.value) {
          crud._pagination.value = {
            ...crud._pagination.value,
            total: Math.max(0, crud._pagination.value.total - results.success),
          }
        }
      }

      return { success: true, results }
    } catch {
      return { success: false, results }
    }
  }

  // Filter helpers
  const filterBySpecialty = (specialtyCode: string) =>
    crud._items.value.filter(midwife =>
      midwife.specialties.some(spec => spec.code === specialtyCode),
    )

  const filterByRate = (minRate?: number, maxRate?: number) =>
    crud._items.value.filter((midwife) => {
      const rate = parseFloat(midwife.conventionalRate)
      if (minRate !== undefined && rate < minRate) return false
      if (maxRate !== undefined && rate > maxRate) return false
      return true
    })

  const filterByActiveStatus = (isActive: boolean) =>
    crud._items.value.filter(midwife => midwife.user.isActive === isActive)

  const searchMidwives = (query: string) => {
    const searchLower = query.toLowerCase()
    return crud._items.value.filter(midwife =>
      midwife.user.firstName.toLowerCase().includes(searchLower)
      || midwife.user.lastName.toLowerCase().includes(searchLower)
      || midwife.user.email.toLowerCase().includes(searchLower)
      || midwife.user.phone.toLowerCase().includes(searchLower)
      || midwife.bio.toLowerCase().includes(searchLower)
      || midwife.specialties.some(spec =>
        spec.translations.some(translation =>
          translation.name.toLowerCase().includes(searchLower),
        ),
      ),
    )
  }

  // Computed properties
  const activeMidwives = computed(() => filterByActiveStatus(true))
  const inactiveMidwives = computed(() => filterByActiveStatus(false))
  const verifiedMidwives = computed(() => crud._items.value.filter(m => m.verified === true))
  const pendingMidwives = computed(() => crud._items.value.filter(m => m.verified !== true))

  const specialtyStats = computed(() => {
    const stats: Record<string, number> = {}
    crud._items.value.forEach((midwife) => {
      midwife.specialties.forEach((spec) => {
        const specialtyName = spec.translations[0]?.name || spec.code
        stats[specialtyName] = (stats[specialtyName] || 0) + 1
      })
    })
    return stats
  })

  const rateStats = computed(() => {
    const rates = crud._items.value.map(m => parseFloat(m.conventionalRate)).filter(rate => !isNaN(rate))
    if (rates.length === 0) return { min: 0, max: 0, average: 0 }

    const min = Math.min(...rates)
    const max = Math.max(...rates)
    const average = rates.reduce((sum, rate) => sum + rate, 0) / rates.length

    return { min, max, average: Math.round(average * 100) / 100 }
  })

  // Helper functions
  const getFullName = (midwife: Midwife): string =>
    `${midwife.user.firstName} ${midwife.user.lastName}`

  const formatRate = (rate: string): string => {
    const numRate = parseFloat(rate)
    return isNaN(numRate) ? 'Non défini' : `${numRate}€`
  }

  const getSpecialtyNames = (midwife: Midwife): string[] =>
    midwife.specialties.map(spec => spec.translations[0]?.name || spec.code)

  const formatSpecialties = (midwife: Midwife): string => {
    const names = getSpecialtyNames(midwife)
    return names.length > 0 ? names.join(', ') : 'Aucune spécialité'
  }

  const getStatusText = (midwife: Midwife): string =>
    midwife.user.isActive ? 'Actif' : 'Inactif'

  const getStatusVariant = (midwife: Midwife) =>
    midwife.user.isActive ? 'default' : 'secondary'

  const getVerificationStatusText = (midwife: Midwife): string => {
    if (midwife.verified === true) return 'Vérifié'
    if (midwife.verified === false) return 'Rejeté'
    return 'En attente'
  }

  const getVerificationStatusVariant = (midwife: Midwife) => {
    if (midwife.verified === true) return 'default'
    if (midwife.verified === false) return 'destructive'
    return 'secondary'
  }

  const getRejectionReason = (midwife: Midwife): string | null =>
    midwife.rejectionReason || null

  return {
    // State
    midwives: crud.items,
    isLoading: crud.isLoading,
    error: crud.error,
    total: crud.total,
    currentPage: crud.currentPage,
    totalPages: crud.totalPages,
    itemsPerPage: crud.itemsPerPage,

    // Methods
    fetchMidwives,
    getMidwifeById,
    validateMidwife,
    rejectMidwife,
    deleteMidwife,
    bulkValidateMidwives,
    bulkRejectMidwives,
    bulkDeleteMidwives,
    filterBySpecialty,
    filterByRate,
    filterByActiveStatus,
    searchMidwives,
    getFullName,
    formatRate,
    getSpecialtyNames,
    formatSpecialties,
    getStatusText,
    getStatusVariant,
    getVerificationStatusText,
    getVerificationStatusVariant,
    getRejectionReason,

    // Computed
    activeMidwives,
    inactiveMidwives,
    verifiedMidwives,
    pendingMidwives,
    specialtyStats,
    rateStats,
  }
}
