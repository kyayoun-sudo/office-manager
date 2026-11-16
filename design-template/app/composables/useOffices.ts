import type { 
  Office,
  OfficeAvailability,
  AvailableSlot,
  OfficeFilters,
  AvailabilityFilters,
  PaginatedOfficesResponse,
  PaginatedAvailabilitiesResponse,
  PaginatedAvailableSlotsResponse,
  OfficeApiResponse,
  CreateOfficeRequest,
  UpdateOfficeRequest,
  CreateOfficeAvailabilityRequest,
  UpdateOfficeAvailabilityRequest,
  OfficeStats,
  AvailabilityType
} from '~~/shared/types/office'
import { useApiResponse } from './useApiResponse'

export const useOffices = () => {
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const { handlePaginatedResponse, handleApiResponse } = useApiResponse()
  
  // State pour les données
  const offices = ref<Office[]>([])
  const selectedOffice = ref<Office | null>(null)
  const availabilities = ref<OfficeAvailability[]>([])
  const availableSlots = ref<AvailableSlot[]>([])
  const stats = ref<OfficeStats>({
    totalOffices: 0,
    activeOffices: 0,
    inactiveOffices: 0,
    officesWithAvailabilities: 0,
    totalAvailabilities: 0,
    averageAvailabilitiesPerOffice: 0,
    officesBySpecialty: {},
    officesCreatedThisMonth: 0
  })
  
  // Pagination state
  const pagination = ref({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
    hasNextPage: false,
    hasPrevPage: false
  })

  // === ENDPOINTS EN LECTURE SEULE POUR ADMIN/SUPPORT ===

  // Récupérer tous les offices avec pagination et filtres (lecture seule)
  const fetchOffices = async (filters: OfficeFilters = {}): Promise<PaginatedOfficesResponse | null> => {
    try {
      isLoading.value = true
      error.value = null

      const queryParams = new URLSearchParams()
      
      // Paramètres de pagination
      if (filters.page) queryParams.append('page', filters.page.toString())
      if (filters.limit) queryParams.append('limit', filters.limit.toString())
      if (filters.sortBy) queryParams.append('sortBy', filters.sortBy)
      if (filters.sortOrder) queryParams.append('sortOrder', filters.sortOrder)
      
      // Paramètres de filtres selon le contrôleur
      if (filters.search) queryParams.append('search', filters.search)
      if (filters.specialtyId) queryParams.append('specialtyId', filters.specialtyId.toString())
      if (filters.specialtyCode) queryParams.append('specialtyCode', filters.specialtyCode)
      if (filters.clinicianId) queryParams.append('clinicianId', filters.clinicianId.toString())
      if (filters.isActive !== undefined) queryParams.append('isActive', filters.isActive.toString())

      const response = await api.get<OfficeApiResponse<Office[]>>(`/offices?${queryParams.toString()}`)
      
      const { success, data, pagination: paginationData, error: apiError } = handlePaginatedResponse<Office>(response)
      
      if (success) {
        offices.value = data
        if (paginationData) {
          pagination.value = paginationData
        }
        return {
          data,
          pagination: paginationData || pagination.value
        }
      } else {
        error.value = apiError || 'Erreur lors du chargement des offices'
        return null
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors du chargement des offices'
      return null
    } finally {
      isLoading.value = false
    }
  }

  // Récupérer un office spécifique avec détails complets
  const fetchOffice = async (id: number): Promise<Office | null> => {
    try {
      isLoading.value = true
      error.value = null

      const response = await api.get<OfficeApiResponse<Office>>(`/offices/${id}`)
      
      if (response && response.success && response.data) {
        selectedOffice.value = response.data
        return response.data
      } else {
        error.value = 'Office non trouvé'
        return null
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors du chargement de l\'office'
      return null
    } finally {
      isLoading.value = false
    }
  }


  // === CONSULTATION DES DISPONIBILITÉS (LECTURE SEULE) ===

  // Récupérer les disponibilités d'un office (lecture seule)
  const fetchAvailabilities = async (officeId: number, filters: AvailabilityFilters = {}): Promise<PaginatedAvailabilitiesResponse | null> => {
    try {
      isLoading.value = true
      error.value = null

      const queryParams = new URLSearchParams()
      
      // Paramètres de pagination
      if (filters.page) queryParams.append('page', filters.page.toString())
      if (filters.limit) queryParams.append('limit', filters.limit.toString())
      if (filters.sortBy) queryParams.append('sortBy', filters.sortBy)
      if (filters.sortOrder) queryParams.append('sortOrder', filters.sortOrder)
      
      // Paramètres de filtres
      if (filters.startDate) queryParams.append('startDate', filters.startDate)
      if (filters.endDate) queryParams.append('endDate', filters.endDate)
      if (filters.dayOfWeek !== undefined) queryParams.append('dayOfWeek', filters.dayOfWeek.toString())
      if (filters.appointmentType) queryParams.append('appointmentType', filters.appointmentType)
      if (filters.bookableOnly !== undefined) queryParams.append('bookableOnly', filters.bookableOnly.toString())
      if (filters.isActive !== undefined) queryParams.append('isActive', filters.isActive.toString())
      if (filters.type) queryParams.append('type', filters.type)

      const response = await api.get<OfficeApiResponse<OfficeAvailability[]>>(`/offices/${officeId}/availabilities?${queryParams.toString()}`)
      
      if (response && response.success) {
        availabilities.value = response.data || []
        if (response.pagination) {
          pagination.value = response.pagination
        }
        return {
          data: response.data || [],
          pagination: response.pagination || pagination.value
        }
      } else {
        error.value = 'Erreur lors du chargement des disponibilités'
        return null
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors du chargement des disponibilités'
      return null
    } finally {
      isLoading.value = false
    }
  }


  // Récupérer les créneaux disponibles d'un office (public - pour components)
  const fetchAvailableSlots = async (officeId: number, filters: AvailabilityFilters = {}): Promise<PaginatedAvailableSlotsResponse | null> => {
    try {
      isLoading.value = true
      error.value = null

      const queryParams = new URLSearchParams()
      
      // Paramètres de pagination
      if (filters.page) queryParams.append('page', filters.page.toString())
      if (filters.limit) queryParams.append('limit', filters.limit.toString())
      if (filters.sortBy) queryParams.append('sortBy', filters.sortBy)
      if (filters.sortOrder) queryParams.append('sortOrder', filters.sortOrder)
      
      // Paramètres de filtres
      if (filters.startDate) queryParams.append('startDate', filters.startDate)
      if (filters.endDate) queryParams.append('endDate', filters.endDate)
      if (filters.appointmentType) queryParams.append('appointmentType', filters.appointmentType)

      const response = await api.get<OfficeApiResponse<AvailableSlot[]>>(`/offices/${officeId}/available-slots?${queryParams.toString()}`)
      
      if (response && response.success) {
        availableSlots.value = response.data || []
        if (response.pagination) {
          pagination.value = response.pagination
        }
        return {
          data: response.data || [],
          pagination: response.pagination || pagination.value
        }
      } else {
        error.value = 'Erreur lors du chargement des créneaux disponibles'
        return null
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors du chargement des créneaux disponibles'
      return null
    } finally {
      isLoading.value = false
    }
  }

  // Générer des statistiques pour admin (endpoint fictif - à implémenter côté backend)
  const fetchStats = async (): Promise<OfficeStats | null> => {
    try {
      isLoading.value = true
      error.value = null

      // Endpoint fictif - à implémenter côté backend
      const response = await api.get<OfficeApiResponse<OfficeStats>>('/offices/stats')
      
      if (response && response.success && response.data) {
        stats.value = response.data
        return response.data
      } else {
        // Calculer des stats basiques à partir des données chargées
        const totalOffices = offices.value.length
        const activeOffices = offices.value.filter(o => o.isActive).length
        const calculatedStats: OfficeStats = {
          totalOffices,
          activeOffices,
          inactiveOffices: totalOffices - activeOffices,
          officesWithAvailabilities: offices.value.filter(o => o.availabilities && o.availabilities.length > 0).length,
          totalAvailabilities: offices.value.reduce((sum, o) => sum + (o.availabilities?.length || 0), 0),
          averageAvailabilitiesPerOffice: totalOffices > 0 ? Math.round((offices.value.reduce((sum, o) => sum + (o.availabilities?.length || 0), 0) / totalOffices) * 100) / 100 : 0,
          officesBySpecialty: {},
          officesCreatedThisMonth: 0
        }
        stats.value = calculatedStats
        return calculatedStats
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors du chargement des statistiques'
      return null
    } finally {
      isLoading.value = false
    }
  }

  // Helper functions
  const getOfficeStatusLabel = (isActive: boolean): string => {
    return isActive ? 'Actif' : 'Inactif'
  }

  const getOfficeStatusColor = (isActive: boolean): string => {
    return isActive ? 'text-green-600' : 'text-red-600'
  }

  const getOfficeStatusVariant = (isActive: boolean): 'default' | 'destructive' => {
    return isActive ? 'default' : 'destructive'
  }

  const getAvailabilityTypeLabel = (type: AvailabilityType): string => {
    const labels: Record<AvailabilityType, string> = {
      'daily': 'Quotidien',
      'weekly': 'Hebdomadaire'
    }
    return labels[type] || type
  }

  const formatTimeSlot = (start: string, end: string): string => {
    return `${start} - ${end}`
  }

  const formatCoordinates = (latitude: number | null | undefined, longitude: number | null | undefined): string => {
    if (!latitude || !longitude) return 'Non défini'
    return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
  }

  const hasValidCoordinates = (office: Office): boolean => {
    return !!(office.latitude && office.longitude)
  }

  const isOfficeActive = (office: Office): boolean => {
    return office.isActive
  }

  const getSpecialtyNames = (office: Office): string => {
    if (!office.specialties || office.specialties.length === 0) return 'Aucune spécialité'
    return office.specialties.map(s => s.name).join(', ')
  }

  // Computed properties
  const activeOffices = computed(() => {
    return offices.value.filter(office => office.isActive)
  })

  const inactiveOffices = computed(() => {
    return offices.value.filter(office => !office.isActive)
  })

  const officesWithCoordinates = computed(() => {
    return offices.value.filter(office => hasValidCoordinates(office))
  })

  const recentOffices = computed(() => {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    return offices.value.filter(office => 
      office.createdAt && new Date(office.createdAt) >= oneWeekAgo
    )
  })

  return {
    // State
    isLoading: readonly(isLoading),
    error: readonly(error),
    offices: readonly(offices),
    selectedOffice: readonly(selectedOffice),
    availabilities: readonly(availabilities),
    availableSlots: readonly(availableSlots),
    stats: readonly(stats),
    pagination: readonly(pagination),

    // Methods de consultation pour offices (admin/support - lecture seule)
    fetchOffices,
    fetchOffice,

    // Methods de consultation pour availabilities (admin/support - lecture seule)
    fetchAvailabilities,

    // Methods de consultation
    fetchAvailableSlots,
    fetchStats,

    // Helpers
    getOfficeStatusLabel,
    getOfficeStatusColor,
    getOfficeStatusVariant,
    getAvailabilityTypeLabel,
    formatTimeSlot,
    formatCoordinates,
    hasValidCoordinates,
    isOfficeActive,
    getSpecialtyNames,

    // Computed
    activeOffices,
    inactiveOffices,
    officesWithCoordinates,
    recentOffices
  }
}