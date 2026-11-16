import type { Appointment, AppointmentFilters, AppointmentsResponse, AppointmentStats } from '~~/shared/types/appointment'
import { useApiResponse } from './useApiResponse'

// Interface pour les paramètres de requête API
export interface AppointmentQueryParams {
  page?: number
  limit?: number
  sortBy?: string
  sortOrder?: 'ASC' | 'DESC'
  status?: string | string[]  // API accepte plusieurs statuts séparés par virgule
  categoryIds?: number | number[]  // API accepte plusieurs IDs séparés par virgule
  startDate?: string
  endDate?: string
}

// Interface pour les filtres côté client
export interface ClientFilters {
  search?: string
  status?: string[]
  categoryIds?: number[]
  specialtyIds?: number[]
  dateFrom?: string
  dateTo?: string
  isEmergency?: boolean
}

export const useAppointments = () => {
  const appointments = ref<Appointment[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const currentPage = ref(1)
  const itemsPerPage = ref(10)
  const clientFilters = ref<ClientFilters>({})
  const { handlePaginatedResponse, handleApiResponse } = useApiResponse()

  // Filtrage côté client
  const filteredAppointments = computed(() => {
    let result = [...appointments.value]
    const filters = clientFilters.value

    // Filtre par recherche (patient, clinicien, notes, cabinet)
    if (filters.search && filters.search.trim()) {
      const searchLower = filters.search.toLowerCase().trim()
      result = result.filter(appointment =>
        appointment.patient?.user?.firstName?.toLowerCase().includes(searchLower) ||
        appointment.patient?.user?.lastName?.toLowerCase().includes(searchLower) ||
        appointment.clinician?.firstName?.toLowerCase().includes(searchLower) ||
        appointment.clinician?.lastName?.toLowerCase().includes(searchLower) ||
        appointment.notes?.toLowerCase().includes(searchLower) ||
        appointment.office?.name?.toLowerCase().includes(searchLower)
      )
    }

    // Filtre par statut
    if (filters.status && filters.status.length > 0) {
      result = result.filter(appointment => filters.status!.includes(appointment.status))
    }

    // Filtre par catégorie
    if (filters.categoryIds && filters.categoryIds.length > 0) {
      result = result.filter(appointment =>
        appointment.category && filters.categoryIds!.includes(appointment.category.id)
      )
    }

    // Filtre par spécialité
    if (filters.specialtyIds && filters.specialtyIds.length > 0) {
      result = result.filter((appointment) => {
        const specId = appointment.specialty?.id
        return specId && filters.specialtyIds!.includes(specId)
      })
    }

    // Filtre par date de début
    if (filters.dateFrom) {
      const fromDate = new Date(filters.dateFrom)
      fromDate.setHours(0, 0, 0, 0)
      result = result.filter(appointment => {
        const appointmentDate = new Date(appointment.appointmentDate)
        return appointmentDate >= fromDate
      })
    }

    // Filtre par date de fin
    if (filters.dateTo) {
      const toDate = new Date(filters.dateTo)
      toDate.setHours(23, 59, 59, 999)
      result = result.filter(appointment => {
        const appointmentDate = new Date(appointment.appointmentDate)
        return appointmentDate <= toDate
      })
    }

    // Filtre par urgence
    if (filters.isEmergency !== undefined) {
      result = result.filter(appointment => appointment.isEmergency === filters.isEmergency)
    }

    return result
  })

  // Pagination côté client
  const total = computed(() => filteredAppointments.value.length)
  const totalPages = computed(() => Math.ceil(filteredAppointments.value.length / itemsPerPage.value) || 1)

  const paginatedAppointments = computed(() => {
    const start = (currentPage.value - 1) * itemsPerPage.value
    const end = start + itemsPerPage.value
    return filteredAppointments.value.slice(start, end)
  })

  // Fonctions de pagination
  const setPage = (page: number) => {
    if (page >= 1 && page <= totalPages.value) {
      currentPage.value = page
    }
  }

  const nextPage = () => {
    if (currentPage.value < totalPages.value) {
      currentPage.value++
    }
  }

  const prevPage = () => {
    if (currentPage.value > 1) {
      currentPage.value--
    }
  }

  // Fonctions de filtrage
  const setFilters = (filters: ClientFilters) => {
    clientFilters.value = { ...filters }
    currentPage.value = 1 // Reset à la première page quand on filtre
  }

  const clearFilters = () => {
    clientFilters.value = {}
    currentPage.value = 1
  }

  // Fetch all appointments with API pagination and filters
  const fetchAppointments = async (params?: AppointmentQueryParams | AppointmentFilters) => {
    isLoading.value = true
    error.value = null

    try {
      const queryParams: Record<string, any> = {}

      if (params) {
        // Tri (pagination non supportée par l'API)
        if ('sortBy' in params && params.sortBy) queryParams.sortBy = params.sortBy
        if ('sortOrder' in params && params.sortOrder) queryParams.sortOrder = params.sortOrder

        // Filtres API - status (peut être un tableau ou une chaîne avec virgules)
        if ('status' in params && params.status) {
          if (Array.isArray(params.status) && params.status.length > 0) {
            queryParams.status = params.status.join(',')
          } else if (typeof params.status === 'string' && params.status) {
            queryParams.status = params.status
          }
        }

        // Filtres API - categoryIds (peut être un tableau ou une chaîne avec virgules)
        if ('categoryIds' in params && params.categoryIds) {
          if (Array.isArray(params.categoryIds) && params.categoryIds.length > 0) {
            queryParams.categoryIds = params.categoryIds.join(',')
          } else if (typeof params.categoryIds === 'number') {
            queryParams.categoryIds = params.categoryIds.toString()
          }
        }

        // Filtres API - dates
        if ('startDate' in params && params.startDate) queryParams.startDate = params.startDate
        if ('endDate' in params && params.endDate) queryParams.endDate = params.endDate

        // Support pour l'ancien format AppointmentFilters
        if ('dateFrom' in params && params.dateFrom) queryParams.startDate = params.dateFrom
        if ('dateTo' in params && params.dateTo) queryParams.endDate = params.dateTo
      }

      console.log('Fetching appointments with params:', queryParams)

      const response = await api.get<any>('/appointments/admin', { params: queryParams })
      console.log('API Response:', response)

      const { success, data, pagination, error: apiError } = handlePaginatedResponse<Appointment>(response)

      if (success) {
        appointments.value = data
        currentPage.value = 1 // Reset à la première page
        console.log('Appointments loaded:', {
          count: data.length,
          total: total.value,
          totalPages: totalPages.value
        })
      } else {
        throw new Error(apiError || 'Erreur lors du chargement des rendez-vous')
      }

    } catch (err: any) {
      error.value = err.message || 'Erreur lors du chargement des rendez-vous'
      appointments.value = []
      currentPage.value = 1
      console.error('Error fetchAppointments:', err)
    } finally {
      isLoading.value = false
    }
  }
  
  // Get appointment by ID
  const getAppointmentById = async (id: number): Promise<Appointment | null> => {
    try {
      const response = await api.get<Appointment>(`/appointments/${id}`)
      const { success, data, error: apiError } = handleApiResponse<Appointment>(response)
      
      if (success && data) {
        return data
      } else {
        error.value = apiError || 'Erreur lors du chargement du rendez-vous'
        return null
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors du chargement du rendez-vous'
      return null
    }
  }
  
  // Update appointment status
  const updateAppointmentStatus = async (id: number, status: string, cancellationReason?: string): Promise<boolean> => {
    try {
      const payload: any = { status }
      if (cancellationReason) {
        payload.cancellationReason = cancellationReason
        payload.cancelledBy = 'admin'
      }
      
      const response = await api.patch(`/appointments/${id}`, payload)
      const { success, error: apiError } = handleApiResponse(response)
      
      if (success) {
        // Update local appointment
        const appointmentIndex = appointments.value.findIndex(a => a.id === id)
        if (appointmentIndex !== -1) {
          appointments.value[appointmentIndex].status = status as any
          if (cancellationReason) {
            appointments.value[appointmentIndex].cancellationReason = cancellationReason
            appointments.value[appointmentIndex].cancelledBy = 'admin'
            appointments.value[appointmentIndex].cancelledAt = new Date().toISOString()
          }
          if (status === 'completed') {
            appointments.value[appointmentIndex].completedAt = new Date().toISOString()
          }
        }
        return true
      } else {
        error.value = apiError || 'Erreur lors de la mise à jour du statut'
        return false
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors de la mise à jour du statut'
      return false
    }
  }
  
  // Cancel appointment
  const cancelAppointment = async (id: number, reason: string): Promise<boolean> => {
    return await updateAppointmentStatus(id, 'cancelled', reason)
  }
  
  // Complete appointment
  const completeAppointment = async (id: number, completionData?: {
    deliveryActualDate?: string
    deliveryType?: string
    deliveryLocation?: string
    babyGender?: string
    babyWeight?: number
    babyHeight?: number
    complications?: string
    followUpRequired?: boolean
    followUpNotes?: string
  }): Promise<boolean> => {
    try {
      const payload = {
        status: 'completed',
        completedAt: new Date().toISOString(),
        ...completionData
      }
      
      const response = await api.patch(`/appointments/${id}`, payload)
      const { success, error: apiError } = handleApiResponse(response)
      
      if (success) {
        // Update local appointment
        const appointmentIndex = appointments.value.findIndex(a => a.id === id)
        if (appointmentIndex !== -1) {
          Object.assign(appointments.value[appointmentIndex], payload)
        }
        return true
      } else {
        error.value = apiError || 'Erreur lors de la finalisation du rendez-vous'
        return false
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors de la finalisation du rendez-vous'
      return false
    }
  }
  
  // Delete appointment
  const deleteAppointment = async (id: number): Promise<boolean> => {
    try {
      const response = await api.delete(`/appointments/${id}`)
      const { success, error: apiError } = handleApiResponse(response)
      
      if (success) {
        // Remove from local state
        appointments.value = appointments.value.filter(a => a.id !== id)
        total.value = appointments.value.length
        return true
      } else {
        error.value = apiError || 'Erreur lors de la suppression'
        return false
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors de la suppression'
      return false
    }
  }
  
  // Filter helpers
  const filterByStatus = (status: string[]) => {
    return appointments.value.filter(appointment => 
      status.includes(appointment.status)
    )
  }
  
  const filterByPatient = (patientId: number) => {
    return appointments.value.filter(appointment => 
      appointment.patient.id === patientId
    )
  }
  
  const filterByClinician = (clinicianId: number) => {
    return appointments.value.filter(appointment => 
      appointment.clinician.id === clinicianId
    )
  }
  
  const filterByDateRange = (dateFrom: string, dateTo: string) => {
    return appointments.value.filter(appointment => {
      const appointmentDate = new Date(appointment.appointmentDate)
      const fromDate = new Date(dateFrom)
      const toDate = new Date(dateTo)
      return appointmentDate >= fromDate && appointmentDate <= toDate
    })
  }
  
  const filterByEmergency = (isEmergency: boolean) => {
    return appointments.value.filter(appointment => 
      appointment.isEmergency === isEmergency
    )
  }
  
  const searchAppointments = (query: string) => {
    const searchLower = query.toLowerCase()
    return appointments.value.filter(appointment => 
      appointment.patient?.user?.firstName?.toLowerCase().includes(searchLower) ||
      appointment.patient?.user?.lastName?.toLowerCase().includes(searchLower) ||
      appointment.clinician?.firstName?.toLowerCase().includes(searchLower) ||
      appointment.clinician?.lastName?.toLowerCase().includes(searchLower) ||
      appointment.notes?.toLowerCase().includes(searchLower) ||
      appointment.office?.name?.toLowerCase().includes(searchLower)
    )
  }
  
  // Computed properties
  const appointmentsByStatus = computed(() => {
    const statusCounts: Record<string, number> = {}
    appointments.value.forEach(appointment => {
      statusCounts[appointment.status] = (statusCounts[appointment.status] || 0) + 1
    })
    return statusCounts
  })
  
  const upcomingAppointments = computed(() => 
    appointments.value.filter(appointment => {
      const appointmentDateTime = new Date(appointment.appointmentDate)
      return appointmentDateTime > new Date() && ['scheduled', 'confirmed'].includes(appointment.status)
    })
  )
  
  const emergencyAppointments = computed(() => 
    appointments.value.filter(appointment => appointment.isEmergency)
  )
  
  const followUpRequired = computed(() => 
    appointments.value.filter(appointment => appointment.followUpRequired)
  )
  
  const appointmentStats = computed((): AppointmentStats => {
    const stats = appointmentsByStatus.value
    return {
      total: appointments.value.length,
      scheduled: stats.scheduled || 0,
      confirmed: stats.confirmed || 0,
      completed: stats.completed || 0,
      cancelled: stats.cancelled || 0,
      emergency: emergencyAppointments.value.length,
      followUpRequired: followUpRequired.value.length
    }
  })
  
  // Helper functions
  const formatDate = (dateString: string): string => {
    if (!dateString) return 'Date non disponible'
    try {
      return new Date(dateString).toLocaleDateString('fr-FR', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })
    } catch {
      return 'Date invalide'
    }
  }
  
  const formatTime = (appointmentDate: string): string => {
    if (!appointmentDate) return 'Heure non disponible'
    try {
      return new Date(appointmentDate).toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit'
      })
    } catch {
      return 'Heure invalide'
    }
  }
  
  const formatDateTime = (dateString: string, timeString: string): string => {
    const date = new Date(`${dateString}T${timeString}`)
    return date.toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }
  
  const getPatientFullName = (appointment: Appointment): string => {
    if (!appointment?.patient?.user?.firstName || !appointment?.patient?.user?.lastName) {
      return 'Patient inconnu'
    }
    return `${appointment.patient.user.firstName} ${appointment.patient.user.lastName}`
  }
  
  const getClinicianFullName = (appointment: Appointment): string => {
    if (!appointment?.clinician?.firstName || !appointment?.clinician?.lastName) {
      return 'Clinicien inconnu'
    }
    return `${appointment.clinician.firstName} ${appointment.clinician.lastName}`
  }
  
  const getStatusVariant = (status: string) => {
    if (!status) return 'secondary'
    
    switch (status) {
      case 'scheduled':
        return 'secondary'
      case 'confirmed':
        return 'default'
      case 'completed':
        return 'default'
      case 'cancelled':
        return 'destructive'
      case 'in_progress':
        return 'default'
      case 'no_show':
        return 'destructive'
      default:
        return 'secondary'
    }
  }
  
  const getStatusColor = (status: string) => {
    if (!status) return 'text-gray-600'
    
    switch (status) {
      case 'scheduled':
        return 'text-blue-600'
      case 'confirmed':
        return 'text-green-600'
      case 'completed':
        return 'text-gray-600'
      case 'cancelled':
        return 'text-red-600'
      case 'in_progress':
        return 'text-orange-600'
      case 'no_show':
        return 'text-red-600'
      default:
        return 'text-gray-600'
    }
  }
  
  const getStatusText = (status: string): string => {
    if (!status) return 'Statut inconnu'
    
    switch (status) {
      case 'scheduled':
        return 'Programmé'
      case 'confirmed':
        return 'Confirmé'
      case 'completed':
        return 'Terminé'
      case 'cancelled':
        return 'Annulé'
      case 'in_progress':
        return 'En cours'
      case 'no_show':
        return 'Absent'
      default:
        return status
    }
  }
  
  const getDurationText = (duration: number): string => {
    if (!duration || duration <= 0) return 'Durée non définie'
    
    const hours = Math.floor(duration / 60)
    const minutes = duration % 60
    
    if (hours > 0 && minutes > 0) {
      return `${hours}h ${minutes}min`
    } else if (hours > 0) {
      return `${hours}h`
    } else {
      return `${minutes}min`
    }
  }
  
  return {
    // State
    appointments: readonly(appointments),
    filteredAppointments,
    paginatedAppointments,
    isLoading: readonly(isLoading),
    error: readonly(error),
    total,
    currentPage: readonly(currentPage),
    totalPages,
    itemsPerPage: readonly(itemsPerPage),
    clientFilters: readonly(clientFilters),

    // Methods
    fetchAppointments,
    getAppointmentById,
    updateAppointmentStatus,
    cancelAppointment,
    completeAppointment,
    deleteAppointment,

    // Pagination côté client
    setPage,
    nextPage,
    prevPage,

    // Filtrage côté client
    setFilters,
    clearFilters,

    // Anciennes méthodes de filtrage (pour compatibilité)
    filterByStatus,
    filterByPatient,
    filterByClinician,
    filterByDateRange,
    filterByEmergency,
    searchAppointments,

    // Computed
    appointmentsByStatus,
    upcomingAppointments,
    emergencyAppointments,
    followUpRequired,
    appointmentStats,

    // Helpers
    formatDate,
    formatTime,
    formatDateTime,
    getPatientFullName,
    getClinicianFullName,
    getStatusVariant,
    getStatusColor,
    getStatusText,
    getDurationText
  }
}