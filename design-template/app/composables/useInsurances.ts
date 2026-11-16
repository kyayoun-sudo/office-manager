import type {
  Insurance,
  InsuranceFilters,
  InsurancesResponse,
  CreateInsuranceRequest,
  UpdateInsuranceRequest,
  InsuranceStats
} from '~~/shared/types/insurance'
import { useApiResponse } from './useApiResponse'
import { api } from '~/utils/api'

export const useInsurances = () => {
  const insurances = ref<Insurance[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const total = ref(0)
  const currentPage = ref(1)
  const totalPages = ref(1)
  const itemsPerPage = ref(20)
  const { handlePaginatedResponse, handleApiResponse } = useApiResponse()

  // Fetch all insurances
  const fetchInsurances = async (filters?: InsuranceFilters | Record<string, any>) => {
    isLoading.value = true
    error.value = null

    try {
      const params: Record<string, any> = {}

      // Support for both InsuranceFilters and direct API parameters
      if (filters) {
        // Handle InsuranceFilters interface
        if ('type' in filters && filters.type) params.type = filters.type
        if ('search' in filters && filters.search) params.search = filters.search
        if ('page' in filters && filters.page) params.page = filters.page
        if ('limit' in filters && filters.limit) params.limit = filters.limit

        // Handle direct API parameters
        if ('sortBy' in filters && filters.sortBy) params.sortBy = filters.sortBy
        if ('sortOrder' in filters && filters.sortOrder) params.sortOrder = filters.sortOrder
      }

      console.log('Fetching insurances with params:', params)
      const response = await api.get<any>('/insurances', { params })
      console.log('API Response raw:', response)

      const { success, data, pagination, error: apiError } = handlePaginatedResponse<Insurance>(response)
      console.log('Parsed response:', { success, dataLength: data?.length, pagination, error: apiError })

      if (success) {
        insurances.value = data
        total.value = pagination?.total || data.length
        currentPage.value = pagination?.page || pagination?.currentPage || 1
        totalPages.value = pagination?.totalPages || Math.ceil((pagination?.total || data.length) / (pagination?.limit || 20))
        itemsPerPage.value = pagination?.limit || 20
        console.log('Insurances loaded successfully:', {
          dataLength: data.length,
          total: total.value,
          currentPage: currentPage.value,
          totalPages: totalPages.value,
          itemsPerPage: itemsPerPage.value,
          pagination: pagination
        })
      } else {
        error.value = apiError || 'Erreur lors du chargement des assurances'
        insurances.value = []
        total.value = 0
        currentPage.value = 1
        totalPages.value = 1
      }

    } catch (err: any) {
      error.value = err.message || 'Erreur lors du chargement des assurances'
      insurances.value = []
      total.value = 0
      currentPage.value = 1
      totalPages.value = 1
      console.error('Erreur fetchInsurances:', err)
    } finally {
      isLoading.value = false
    }
  }

  // Get insurance by ID
  const getInsuranceById = async (id: number): Promise<Insurance | null> => {
    try {
      const response = await api.get<any>(`/insurances/${id}`)
      const { success, data, error: apiError } = handleApiResponse<Insurance>(response)

      if (success && data) {
        return data
      } else {
        error.value = apiError || 'Assurance non trouvée'
        return null
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors du chargement de l\'assurance'
      return null
    }
  }

  // Create insurance
  const createInsurance = async (insuranceData: CreateInsuranceRequest): Promise<{ success: boolean, message?: string, error?: string }> => {
    try {
      console.log('🔍 DEBUG - Données envoyées:', insuranceData)
      const response = await api.post('/insurances', insuranceData)
      console.log('🔍 DEBUG - Réponse brute:', response)

      const { success, data, error: apiError } = handleApiResponse<Insurance>(response)
      console.log('🔍 DEBUG - Après handleApiResponse:', { success, apiError })

      if (success && data) {
        // Ajouter l'assurance créée à la liste locale
        insurances.value.push(data)
        total.value = insurances.value.length

        // Retourner le message de succès de l'API
        const successMessage = response?.data?.message || response?.message || 'Assurance créée avec succès'
        return { success: true, message: successMessage }
      } else {
        const errorMessage = apiError || 'Erreur lors de la création'
        console.log('🔍 DEBUG - Message d\'erreur final:', errorMessage)
        error.value = errorMessage
        return { success: false, error: errorMessage }
      }
    } catch (err: any) {
      console.log('🔍 DEBUG - Erreur catch:', err)
      const errorMessage = err.message || 'Erreur lors de la création'
      error.value = errorMessage
      return { success: false, error: errorMessage }
    }
  }

  // Update insurance
  const updateInsurance = async (id: number, insuranceData: UpdateInsuranceRequest): Promise<{ success: boolean, message?: string, error?: string }> => {
    try {
      const response = await api.patch(`/insurances/${id}`, insuranceData)
      const { success, data, error: apiError } = handleApiResponse<Insurance>(response)

      if (success && data) {
        // Update local state
        const index = insurances.value.findIndex(i => i.id === id)
        if (index !== -1) {
          insurances.value[index] = data
        }

        // Retourner le message de succès de l'API
        const successMessage = response?.data?.message || response?.message || 'Assurance mise à jour avec succès'
        return { success: true, message: successMessage }
      } else {
        const errorMessage = apiError || 'Erreur lors de la mise à jour'
        error.value = errorMessage
        return { success: false, error: errorMessage }
      }
    } catch (err: any) {
      const errorMessage = err.message || 'Erreur lors de la mise à jour'
      error.value = errorMessage
      return { success: false, error: errorMessage }
    }
  }

  // Delete insurance
  const deleteInsurance = async (id: number): Promise<{ success: boolean, message?: string, error?: string }> => {
    try {
      const response = await api.delete(`/insurances/${id}`)
      const { success, error: apiError } = handleApiResponse(response)

      if (success) {
        // Remove from local state
        insurances.value = insurances.value.filter(i => i.id !== id)
        total.value = insurances.value.length

        // Retourner le message de succès de l'API
        const successMessage = response?.data?.message || response?.message || 'Assurance supprimée avec succès'
        return { success: true, message: successMessage }
      } else {
        const errorMessage = apiError || 'Erreur lors de la suppression'
        error.value = errorMessage
        return { success: false, error: errorMessage }
      }
    } catch (err: any) {
      const errorMessage = err.message || 'Erreur lors de la suppression'
      error.value = errorMessage
      return { success: false, error: errorMessage }
    }
  }

  // Bulk actions
  const bulkUpdateInsuranceStatus = async (ids: number[], isActive: boolean): Promise<{success: boolean, results: {success: number, failed: number}, messages: {success: string[], errors: string[]}}> => {
    const results = { success: 0, failed: 0 }
    const messages = { success: [] as string[], errors: [] as string[] }

    try {
      // Process in parallel for better performance
      const promises = ids.map(async (id) => {
        try {
          const response = await api.patch(`/insurances/${id}`, { isActive })
          const { success, error: apiError } = handleApiResponse(response)

          if (success) {
            // Update local insurance
            const insuranceIndex = insurances.value.findIndex(i => i.id === id)
            if (insuranceIndex !== -1) {
              insurances.value[insuranceIndex].isActive = isActive
            }
            results.success++
            const successMessage = response?.data?.message || response?.message || `Assurance ${id} ${isActive ? 'activée' : 'désactivée'} avec succès`
            messages.success.push(successMessage)
          } else {
            results.failed++
            const errorMessage = apiError || `Erreur pour l'assurance ${id}`
            messages.errors.push(errorMessage)
          }
        } catch (err: any) {
          results.failed++
          messages.errors.push(`Assurance ${id}: ${err.message || 'Erreur inconnue'}`)
        }
      })

      await Promise.all(promises)

      return { success: true, results, messages }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors de la mise à jour en lot'
      return { success: false, results, messages }
    }
  }

  const bulkDeleteInsurances = async (ids: number[]): Promise<{success: boolean, results: {success: number, failed: number}, messages: {success: string[], errors: string[]}}> => {
    const results = { success: 0, failed: 0 }
    const messages = { success: [] as string[], errors: [] as string[] }

    try {
      // Process in parallel for better performance
      const promises = ids.map(async (id) => {
        try {
          const response = await api.delete(`/insurances/${id}`)
          const { success, error: apiError } = handleApiResponse(response)

          if (success) {
            results.success++
            const successMessage = response?.data?.message || response?.message || `Assurance ${id} supprimée avec succès`
            messages.success.push(successMessage)
          } else {
            results.failed++
            const errorMessage = apiError || `Erreur pour l'assurance ${id}`
            messages.errors.push(errorMessage)
          }
        } catch (err: any) {
          results.failed++
          messages.errors.push(`Assurance ${id}: ${err.message || 'Erreur inconnue'}`)
        }
      })

      await Promise.all(promises)

      // Remove successfully deleted insurances from local state
      if (results.success > 0) {
        insurances.value = insurances.value.filter(i => !ids.includes(i.id))
        total.value = insurances.value.length
      }

      return { success: true, results, messages }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors de la suppression en lot'
      return { success: false, results, messages }
    }
  }

  // Filter helpers
  const filterByType = (type: string) => {
    return insurances.value.filter(insurance => insurance.type === type)
  }

  const filterByActive = (isActive: boolean) => {
    return insurances.value.filter(insurance => insurance.isActive === isActive)
  }

  const searchInsurances = (query: string) => {
    const searchLower = query.toLowerCase()
    return insurances.value.filter(insurance =>
      insurance.libelle.toLowerCase().includes(searchLower) ||
      insurance.code.toLowerCase().includes(searchLower) ||
      insurance.description?.toLowerCase().includes(searchLower)
    )
  }

  // Computed properties
  const insuranceStats = computed((): InsuranceStats => {
    const activeInsurances = insurances.value.filter(i => i.isActive)
    const inactiveInsurances = insurances.value.filter(i => !i.isActive)

    return {
      total: insurances.value.length,
      active: activeInsurances.length,
      inactive: inactiveInsurances.length,
      public: insurances.value.filter(i => i.type === 'PUBLIC').length,
      mutual: insurances.value.filter(i => i.type === 'mutual').length,
      hospital: insurances.value.filter(i => i.type === 'hospital').length,
      private: insurances.value.filter(i => i.type === 'PRIVATE').length,
      hybrid: insurances.value.filter(i => i.type === 'HYBRID').length
    }
  })

  const activeInsurances = computed(() =>
    insurances.value.filter(insurance => insurance.isActive)
  )

  // Helper functions
  const getTypeLabel = (type: string): string => {
    switch (type) {
      case 'PUBLIC':
        return 'Publique'
      case 'PRIVATE':
        return 'Privée'
      case 'HYBRID':
        return 'Hybride'
      case 'hospital':
        return 'Hospitalisation'
      case 'mutual':
        return 'Mutuelle'
      default:
        return type || 'Non défini'
    }
  }

  const getTypeColor = (type: string): string => {
    switch (type) {
      case 'PUBLIC':
        return 'text-blue-600'
      case 'PRIVATE':
        return 'text-green-600'
      case 'HYBRID':
        return 'text-purple-600'
      case 'hospital':
        return 'text-orange-600'
      case 'mutual':
        return 'text-indigo-600'
      default:
        return 'text-gray-600'
    }
  }

  const getTypeVariant = (type: string) => {
    switch (type) {
      case 'PUBLIC':
        return 'default'
      case 'PRIVATE':
        return 'secondary'
      case 'HYBRID':
        return 'outline'
      case 'hospital':
        return 'default'
      case 'mutual':
        return 'secondary'
      default:
        return 'secondary'
    }
  }

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR'
    }).format(amount)
  }

  const formatPercentage = (percentage: number): string => {
    return `${percentage}%`
  }

  return {
    // State
    insurances: readonly(insurances),
    isLoading: readonly(isLoading),
    error: readonly(error),
    total: readonly(total),
    currentPage: readonly(currentPage),
    totalPages: readonly(totalPages),
    itemsPerPage: readonly(itemsPerPage),

    // Methods
    fetchInsurances,
    getInsuranceById,
    createInsurance,
    updateInsurance,
    deleteInsurance,
    bulkUpdateInsuranceStatus,
    bulkDeleteInsurances,
    filterByType,
    filterByActive,
    searchInsurances,

    // Computed
    insuranceStats,
    activeInsurances,

    // Helpers
    getTypeLabel,
    getTypeColor,
    getTypeVariant,
    formatCurrency,
    formatPercentage
  }
}