import type { 
  SubscriptionResponseDto,
  SubscriptionStats,
  SubscriptionFilters,
  UpdateSubscriptionRequest,
  CancelSubscriptionRequest,
  PaginatedSubscriptionsResponse,
  SubscriptionApiResponse,
  SubscriptionStatus,
  CancelType
} from '~~/shared/types/subscription'
import { useApiResponse } from './useApiResponse'

export const useSubscriptions = () => {
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const { handlePaginatedResponse, handleApiResponse } = useApiResponse()
  
  // State pour les données
  const subscriptions = ref<SubscriptionResponseDto[]>([])
  const stats = ref<SubscriptionStats>({
    total: 0,
    active: 0,
    trialing: 0,
    cancelled: 0,
    expired: 0,
    inactive: 0,
    withStripeIntegration: 0,
    withoutStripeIntegration: 0,
    mrr: 0
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

  // Récupérer tous les abonnements avec pagination
  const fetchSubscriptions = async (filters: SubscriptionFilters = {}): Promise<PaginatedSubscriptionsResponse | null> => {
    try {
      isLoading.value = true
      error.value = null

      const queryParams = new URLSearchParams()
      
      // Paramètres de pagination
      if (filters.page) queryParams.append('page', filters.page.toString())
      if (filters.limit) queryParams.append('limit', filters.limit.toString())
      if (filters.sortBy) queryParams.append('sortBy', filters.sortBy)
      if (filters.sortOrder) queryParams.append('sortOrder', filters.sortOrder)

      const response = await api.get<PaginatedSubscriptionsResponse>(`/subscriptions?${queryParams.toString()}`)
      
      const { success, data, pagination: paginationData, error: apiError } = handlePaginatedResponse<SubscriptionResponseDto>(response)
      
      if (success) {
        subscriptions.value = data
        pagination.value = paginationData || { page: 1, limit: 10, total: data.length, totalPages: 1, hasNextPage: false, hasPrevPage: false }
        return { success: true, data, pagination: paginationData }
      } else {
        error.value = apiError || 'Erreur lors du chargement des abonnements'
        return null
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors du chargement des abonnements'
      return null
    } finally {
      isLoading.value = false
    }
  }

  // Récupérer les statistiques des abonnements
  const fetchStats = async (): Promise<SubscriptionStats | null> => {
    try {
      isLoading.value = true
      error.value = null

      const response = await api.get<SubscriptionStats>('/subscriptions/stats')
      
      const { success, data, error: apiError } = handleApiResponse<SubscriptionStats>(response)
      
      if (success && data) {
        stats.value = data
        return data
      } else if (response && !response.success) {
        error.value = response.message || 'Erreur lors du chargement des statistiques'
        return null
      } else {
        error.value = 'Erreur lors du chargement des statistiques'
        return null
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors du chargement des statistiques'
      return null
    } finally {
      isLoading.value = false
    }
  }

  // Récupérer un abonnement spécifique
  const fetchSubscription = async (id: number): Promise<SubscriptionResponseDto | null> => {
    try {
      isLoading.value = true
      error.value = null

      const response = await api.get<SubscriptionApiResponse<SubscriptionResponseDto>>(`/subscriptions/${id}`)
      
      if (response && response.data) {
        return response.data
      } else {
        error.value = 'Abonnement non trouvé'
        return null
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors du chargement de l\'abonnement'
      return null
    } finally {
      isLoading.value = false
    }
  }

  // Mettre à jour un abonnement
  const updateSubscription = async (id: number, updateData: UpdateSubscriptionRequest): Promise<boolean> => {
    try {
      isLoading.value = true
      error.value = null

      const response = await api.patch<SubscriptionApiResponse<SubscriptionResponseDto>>(`/subscriptions/${id}`, updateData)
      
      if (response && response.success) {
        // Mettre à jour dans la liste locale
        const index = subscriptions.value.findIndex(sub => sub.id === id)
        if (index !== -1 && response.data) {
          subscriptions.value[index] = response.data
        }
        return true
      } else {
        error.value = response?.message || 'Erreur lors de la mise à jour'
        return false
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors de la mise à jour'
      return false
    } finally {
      isLoading.value = false
    }
  }

  // Annuler un abonnement
  const cancelSubscription = async (id: number, cancelData: CancelSubscriptionRequest): Promise<boolean> => {
    try {
      isLoading.value = true
      error.value = null

      const response = await api.post<SubscriptionApiResponse<SubscriptionResponseDto>>(`/subscriptions/${id}/cancel`, cancelData)
      
      if (response && response.success) {
        // Mettre à jour dans la liste locale
        const index = subscriptions.value.findIndex(sub => sub.id === id)
        if (index !== -1 && response.data) {
          subscriptions.value[index] = response.data
        }
        return true
      } else {
        error.value = response?.message || 'Erreur lors de l\'annulation'
        return false
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors de l\'annulation'
      return false
    } finally {
      isLoading.value = false
    }
  }

  // Filtrer les abonnements localement
  const filterSubscriptions = (filters: SubscriptionFilters) => {
    let filtered = [...(subscriptions.value || [])]

    if (filters.status) {
      filtered = filtered.filter(sub => sub.status === filters.status)
    }

    if (filters.searchQuery) {
      const query = filters.searchQuery.toLowerCase()
      filtered = filtered.filter(sub => 
        sub.plan.name.toLowerCase().includes(query) ||
        sub.plan.code.toLowerCase().includes(query) ||
        sub.userId.toString().includes(query)
      )
    }

    if (filters.userId) {
      filtered = filtered.filter(sub => sub.userId === filters.userId)
    }

    if (filters.planId) {
      filtered = filtered.filter(sub => sub.planId === filters.planId)
    }

    if (filters.dateFrom) {
      const fromDate = new Date(filters.dateFrom)
      filtered = filtered.filter(sub => new Date(sub.createdAt) >= fromDate)
    }

    if (filters.dateTo) {
      const toDate = new Date(filters.dateTo)
      filtered = filtered.filter(sub => new Date(sub.createdAt) <= toDate)
    }

    return filtered
  }

  // Helper functions
  const getStatusLabel = (status: SubscriptionStatus): string => {
    const labels: Record<SubscriptionStatus, string> = {
      'active': 'Actif',
      'trialing': 'Période d\'essai',
      'cancelled': 'Annulé',
      'expired': 'Expiré',
      'suspended': 'Suspendu',
      'inactive': 'Inactif',
      'past_due': 'Impayé'
    }
    return labels[status] || status
  }

  const getStatusColor = (status: SubscriptionStatus): string => {
    const colors: Record<SubscriptionStatus, string> = {
      'active': 'text-green-600',
      'trialing': 'text-blue-600',
      'cancelled': 'text-red-600',
      'expired': 'text-gray-600',
      'suspended': 'text-orange-600',
      'inactive': 'text-gray-500',
      'past_due': 'text-red-500'
    }
    return colors[status] || 'text-gray-600'
  }

  const getStatusVariant = (status: SubscriptionStatus): 'default' | 'secondary' | 'destructive' | 'outline' => {
    const variants: Record<SubscriptionStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      'active': 'default',
      'trialing': 'secondary',
      'cancelled': 'destructive',
      'expired': 'destructive',
      'suspended': 'destructive',
      'inactive': 'outline',
      'past_due': 'destructive'
    }
    return variants[status] || 'outline'
  }

  const formatCurrency = (amount: string | number, currency: string = 'EUR'): string => {
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: currency
    }).format(numAmount)
  }

  const formatDate = (dateString: string | Date): string => {
    const date = typeof dateString === 'string' ? new Date(dateString) : dateString
    return new Intl.DateTimeFormat('fr-FR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date)
  }

  const formatDateOnly = (dateString: string | Date): string => {
    const date = typeof dateString === 'string' ? new Date(dateString) : dateString
    return new Intl.DateTimeFormat('fr-FR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(date)
  }

  const getBillingIntervalLabel = (interval: string): string => {
    const labels: Record<string, string> = {
      'month': 'Mensuel',
      'year': 'Annuel',
      'week': 'Hebdomadaire',
      'day': 'Quotidien'
    }
    return labels[interval] || interval
  }

  const isExpiringSoon = (subscription: SubscriptionResponseDto, days: number = 7): boolean => {
    if (!subscription.endDate) return false
    const endDate = new Date(subscription.endDate)
    const now = new Date()
    const daysUntilExpiry = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    return daysUntilExpiry <= days && daysUntilExpiry > 0
  }

  const getCancelTypeLabel = (type: CancelType): string => {
    return type === 'immediately' ? 'Immédiate' : 'Fin de période'
  }

  // Computed properties
  const totalRevenue = computed(() => {
    return (subscriptions.value || [])
      .filter(sub => sub.status === 'active')
      .reduce((total, sub) => total + parseFloat(sub.price), 0)
  })

  const activeSubscriptionsCount = computed(() => {
    return subscriptions.value?.filter(sub => sub.isActive).length || 0
  })

  const expiringSoonCount = computed(() => {
    return subscriptions.value?.filter(sub => isExpiringSoon(sub)).length || 0
  })

  return {
    // State
    isLoading: readonly(isLoading),
    error: readonly(error),
    subscriptions: readonly(subscriptions),
    stats: readonly(stats),
    pagination: readonly(pagination),

    // Methods
    fetchSubscriptions,
    fetchStats,
    fetchSubscription,
    updateSubscription,
    cancelSubscription,
    filterSubscriptions,

    // Helpers
    getStatusLabel,
    getStatusColor,
    getStatusVariant,
    formatCurrency,
    formatDate,
    formatDateOnly,
    getBillingIntervalLabel,
    isExpiringSoon,
    getCancelTypeLabel,

    // Computed
    totalRevenue,
    activeSubscriptionsCount,
    expiringSoonCount
  }
}