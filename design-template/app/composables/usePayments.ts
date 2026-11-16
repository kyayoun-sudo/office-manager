import type { 
  Payment,
  PaymentStats,
  PaymentFilters,
  PaginatedPaymentsResponse,
  PaymentApiResponse,
  PaymentStatus
} from '~~/shared/types/payment'
import { useApiResponse } from './useApiResponse'

export const usePayments = () => {
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const { handlePaginatedResponse, handleApiResponse } = useApiResponse()
  
  // State pour les données
  const payments = ref<Payment[]>([])
  const stats = ref<PaymentStats>({
    total: 0,
    pending: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    refunded: 0,
    withStripePaymentLink: 0,
    withStripePaymentIntent: 0,
    totalRevenue: 0,
    revenueByCurrency: {}
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

  // Récupérer tous les paiements avec pagination et filtres
  const fetchPayments = async (filters: PaymentFilters = {}): Promise<PaginatedPaymentsResponse | null> => {
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
      // includeRefunded n'est ajouté que s'il est explicitement true (car false est la valeur par défaut côté backend)
      if (filters.includeRefunded === true) queryParams.append('includeRefunded', 'true')
      if (filters.status) queryParams.append('status', filters.status)
      if (filters.subscriptionId) queryParams.append('subscriptionId', filters.subscriptionId.toString())

      const response = await api.get<PaginatedPaymentsResponse>(`/payments?${queryParams.toString()}`)
      
      const { success, data, pagination: paginationData, error: apiError } = handlePaginatedResponse<Payment>(response)
      
      if (success) {
        payments.value = data
        pagination.value = paginationData || { page: 1, limit: 10, total: data.length, totalPages: 1, hasNextPage: false, hasPrevPage: false }
        return { success: true, data, pagination: paginationData }
      } else {
        error.value = apiError || 'Erreur lors du chargement des paiements'
        return null
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors du chargement des paiements'
      return null
    } finally {
      isLoading.value = false
    }
  }

  // Récupérer les statistiques des paiements
  const fetchStats = async (): Promise<PaymentStats | null> => {
    try {
      isLoading.value = true
      error.value = null

      const response = await api.get<PaymentStats>('/payments/stats')
      
      if (response && response.success && response.data) {
        stats.value = response.data
        return response.data
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

  // Récupérer un paiement spécifique en utilisant l'API avec un filtre spécifique
  const fetchPayment = async (id: number): Promise<Payment | null> => {
    try {
      // Chercher le paiement dans les données existantes en premier
      const existingPayment = payments.value.find(payment => payment.id === id)
      if (existingPayment) {
        return existingPayment
      }

      // Si le paiement n'est pas trouvé dans les données existantes,
      // récupérer une page spécifique qui contient ce paiement
      const response = await api.get<PaginatedPaymentsResponse>(
        `/payments?page=1&limit=1&id=${id}&sortBy=paymentDate&sortOrder=DESC`
      )

      if (response && response.success) {
        if (Array.isArray(response.data) && response.data.length > 0) {
          // Format simple: { success: true, data: [...] }
          return response.data[0]
        } else if (response.data?.data && Array.isArray(response.data.data) && response.data.data.length > 0) {
          // Format paginé: { success: true, data: { data: [...], pagination: {...} } }
          return response.data.data[0]
        }
      }

      console.warn(`Payment with id ${id} not found in API response`)
      return null
    } catch (err: any) {
      error.value = err.message || 'Erreur lors du chargement du paiement'
      return null
    }
  }

  const cancelPayment = async (id: number): Promise<boolean> => {
    try {
      const response = await api.patch(`/payments/${id}/cancel`)
      const { success } = handleApiResponse(response)
      if (success) {
        const index = payments.value.findIndex(p => p.id === id)
        if (index !== -1) {
          payments.value[index] = { ...payments.value[index], status: 'cancelled' }
        }
        return true
      }
      return false
    } catch {
      return false
    }
  }

  // Filtrer les paiements localement
  const filterPayments = (filters: PaymentFilters) => {
    let filtered = [...payments.value]

    if (filters.status) {
      filtered = filtered.filter(payment => payment.status === filters.status)
    }

    if (filters.searchQuery) {
      const query = filters.searchQuery.toLowerCase()
      filtered = filtered.filter(payment =>
        payment.subscription.user.firstName?.toLowerCase().includes(query) ||
        payment.subscription.user.lastName?.toLowerCase().includes(query) ||
        payment.subscription.user.email?.toLowerCase().includes(query) ||
        payment.subscription.plan.name?.toLowerCase().includes(query) ||
        payment.amount.toString().includes(query) ||
        payment.stripePaymentIntentId?.toLowerCase().includes(query)
      )
    }

    if (filters.userId) {
      filtered = filtered.filter(payment => payment.subscription.user.id === filters.userId)
    }

    if (filters.subscriptionId) {
      filtered = filtered.filter(payment => payment.subscription.id === filters.subscriptionId)
    }

    if (filters.dateFrom) {
      const fromDate = new Date(filters.dateFrom)
      filtered = filtered.filter(payment => new Date(payment.paymentDate) >= fromDate)
    }

    if (filters.dateTo) {
      const toDate = new Date(filters.dateTo)
      filtered = filtered.filter(payment => new Date(payment.paymentDate) <= toDate)
    }

    return filtered
  }

  // Helper functions
  const getStatusLabel = (status: PaymentStatus): string => {
    const labels: Record<PaymentStatus, string> = {
      'pending': 'En attente',
      'succeeded': 'Réussi',
      'failed': 'Échoué',
      'cancelled': 'Annulé',
      'refunded': 'Remboursé'
    }
    return labels[status] || status
  }

  const getStatusColor = (status: PaymentStatus): string => {
    const colors: Record<PaymentStatus, string> = {
      'pending': 'text-orange-600',
      'succeeded': 'text-green-600',
      'failed': 'text-red-600',
      'cancelled': 'text-gray-600',
      'refunded': 'text-purple-600'
    }
    return colors[status] || 'text-gray-600'
  }

  const getStatusVariant = (status: PaymentStatus): 'default' | 'secondary' | 'destructive' | 'outline' => {
    const variants: Record<PaymentStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      'pending': 'outline',
      'succeeded': 'default',
      'failed': 'destructive',
      'cancelled': 'secondary',
      'refunded': 'outline'
    }
    return variants[status] || 'outline'
  }

  const formatCurrency = (amount: string | number, currency: string = 'EUR'): string => {
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: currency.toUpperCase()
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

  const isRecentPayment = (payment: Payment, days: number = 30): boolean => {
    const paymentDate = new Date(payment.paymentDate)
    const now = new Date()
    const diffInDays = Math.ceil((now.getTime() - paymentDate.getTime()) / (1000 * 60 * 60 * 24))
    return diffInDays <= days
  }

  const getPaymentMethodLabel = (method: string): string => {
    const labels: Record<string, string> = {
      'stripe': 'Stripe',
      'card': 'Carte bancaire',
      'paypal': 'PayPal',
      'sepa': 'SEPA',
      'manual': 'Manuel'
    }
    return labels[method] || method
  }

  const hasStripeIntegration = (payment: Payment): boolean => {
    return !!(payment.stripePaymentIntentId || payment.stripePaymentLinkId)
  }

  const getFailureReasonLabel = (reason: string | null): string => {
    if (!reason) return 'Aucune raison spécifiée'
    
    const reasons: Record<string, string> = {
      'insufficient_funds': 'Fonds insuffisants',
      'card_declined': 'Carte refusée',
      'expired_card': 'Carte expirée',
      'incorrect_cvc': 'Code CVC incorrect',
      'processing_error': 'Erreur de traitement',
      'authentication_required': 'Authentification requise'
    }
    return reasons[reason] || reason
  }

  // Computed properties
  const totalRevenue = computed(() => {
    return payments.value
      .filter(payment => payment.status === 'succeeded')
      .reduce((total, payment) => total + parseFloat(payment.amount), 0)
  })

  const recentPayments = computed(() => {
    return payments.value.filter(payment => isRecentPayment(payment, 7))
  })

  const failedPaymentsCount = computed(() => {
    return payments.value.filter(payment => payment.status === 'failed').length
  })

  const pendingPaymentsCount = computed(() => {
    return payments.value.filter(payment => payment.status === 'pending').length
  })

  const successRate = computed(() => {
    const total = payments.value.length
    if (total === 0) return 100
    const succeeded = payments.value.filter(payment => payment.status === 'succeeded').length
    return Math.round((succeeded / total) * 100)
  })

  // Grouped by currency
  const revenuesByCurrency = computed(() => {
    const revenues: Record<string, number> = {}
    
    payments.value
      .filter(payment => payment.status === 'succeeded')
      .forEach(payment => {
        const currency = payment.currency.toUpperCase()
        if (!revenues[currency]) {
          revenues[currency] = 0
        }
        revenues[currency] += parseFloat(payment.amount)
      })

    return revenues
  })

  return {
    // State
    isLoading: readonly(isLoading),
    error: readonly(error),
    payments: readonly(payments),
    stats: readonly(stats),
    pagination: readonly(pagination),

    // Methods
    fetchPayments,
    fetchStats,
    fetchPayment,
    filterPayments,
    cancelPayment,

    // Helpers
    getStatusLabel,
    getStatusColor,
    getStatusVariant,
    formatCurrency,
    formatDate,
    formatDateOnly,
    isRecentPayment,
    getPaymentMethodLabel,
    hasStripeIntegration,
    getFailureReasonLabel,

    // Computed
    totalRevenue,
    recentPayments,
    failedPaymentsCount,
    pendingPaymentsCount,
    successRate,
    revenuesByCurrency
  }
}