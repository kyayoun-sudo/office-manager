import type { DashboardResponse, DashboardData } from '~~~/shared/types/components'
import { api } from '~/utils/api'
import { useApiResponse } from './useApiResponse'

export const useDashboard = () => {
  const dashboardData = ref<DashboardData | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const lastUpdatedAt = ref<Date | null>(null)
  const { handleApiResponse } = useApiResponse()

  // Get components data with optional period filter
  const getDashboardData = async (period: number = 7) => {
    loading.value = true
    error.value = null
    
    try {
      const response = await api.get<any>(`/overview`)
      
      const { success, data, error: apiError } = handleApiResponse<DashboardData>(response)

      if (success && data) {
        dashboardData.value = data
        lastUpdatedAt.value = new Date()
      } else {
        error.value = apiError || 'Erreur lors du chargement du components'
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors du chargement du dashboard'
    }
    
    loading.value = false
    return dashboardData.value
  }

  // Alias for fetchDashboard (expected by index.vue)
  const fetchDashboard = getDashboardData

  // Format evolution percentage for display
  const formatEvolution = (percent: number, trend: 'up' | 'down' | 'stable'): string => {
    const sign = trend === 'up' ? '+' : trend === 'down' ? '-' : ''
    return `${sign}${Math.abs(percent)}%`
  }

  // Get trend icon based on trend value
  const getTrendIcon = (trend: 'up' | 'down' | 'stable'): string => {
    switch (trend) {
      case 'up':
        return 'TrendingUp'
      case 'down':
        return 'TrendingDown'
      case 'stable':
      default:
        return 'Minus'
    }
  }

  // Get trend color based on trend value
  const getTrendColor = (trend: 'up' | 'down' | 'stable'): string => {
    switch (trend) {
      case 'up':
        return 'text-green-600 dark:text-green-400'
      case 'down':
        return 'text-red-600 dark:text-red-400'
      case 'stable':
      default:
        return 'text-muted-foreground'
    }
  }

  // Get alert priority color
  const getAlertColor = (priority: 'urgent' | 'high' | 'medium' | 'low'): string => {
    switch (priority) {
      case 'urgent':
        return 'text-red-600 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-950/20 dark:border-red-800'
      case 'high':
        return 'text-orange-600 bg-orange-50 border-orange-200 dark:text-orange-400 dark:bg-orange-950/20 dark:border-orange-800'
      case 'medium':
        return 'text-yellow-600 bg-yellow-50 border-yellow-200 dark:text-yellow-400 dark:bg-yellow-950/20 dark:border-yellow-800'
      case 'low':
      default:
        return 'text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-950/20 dark:border-blue-800'
    }
  }

  // Get ticket priority badge variant
  const getTicketPriorityVariant = (priority: 'urgent' | 'high' | 'medium' | 'low') => {
    switch (priority) {
      case 'urgent':
        return 'destructive'
      case 'high':
        return 'secondary'
      case 'medium':
        return 'outline'
      case 'low':
      default:
        return 'default'
    }
  }

  // Format date for display
  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  // Format date for recent items (relative)
  const formatRelativeDate = (dateString: string): string => {
    const date = new Date(dateString)
    const now = new Date()
    const diffTime = Math.abs(now.getTime() - date.getTime())
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    
    if (diffDays === 1) {
      return 'Aujourd\'hui'
    } else if (diffDays === 2) {
      return 'Hier'
    } else if (diffDays <= 7) {
      return `Il y a ${diffDays - 1} jours`
    } else {
      return formatDate(dateString)
    }
  }

  // Get chart colors for consistency
  const getChartColors = () => ({
    primary: '#171717',
    secondary: '#737373',
    accent: '#d4d4d4',
    dark: '#000000',
    muted: '#F5F5F5'
  })

  // Helper functions for user types (now based on role names)
  const getUserTypeDisplayName = (userType: string): string => {
    switch (userType) {
      case 'admin':
        return 'Admin'
      case 'provider':
        return 'Clinicien'
      case 'patient':
        return 'Patient'
      default:
        return 'Utilisateur'
    }
  }

  const getUserTypeBadgeVariant = (userType: string) => {
    switch (userType) {
      case 'admin':
        return 'destructive'
      case 'provider':
        return 'secondary'
      case 'patient':
        return 'default'
      default:
        return 'outline'
    }
  }

  // Format currency
  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR'
    }).format(amount)
  }

  interface AppointmentStats {
    pending: number
    scheduled: number
    cancelled: number
    completed: number
  }

  const fetchAppointmentStats = async (startDate: string, endDate: string): Promise<AppointmentStats | null> => {
    try {
      const response = await api.get<any>('/appointments/stats', {
        params: { startDate, endDate },
      })
      const { success, data } = handleApiResponse<AppointmentStats>(response)
      if (success && data) return data
      return null
    } catch {
      return null
    }
  }

  // Computed values from components data
  const stats = computed(() => dashboardData.value?.stats || null)
  const activity = computed(() => dashboardData.value?.activity || null)
  const isLoading = computed(() => loading.value)

  // Computed stats values
  const totalUsers = computed(() => stats.value?.totalUsers || 0)
  const totalPatients = computed(() => stats.value?.totalPatients || 0)
  const totalClinicians = computed(() => stats.value?.totalClinicians || 0)
  const appointmentsThisMonth = computed(() => stats.value?.appointmentsThisMonth || 0)
  const appointmentsToday = computed(() => stats.value?.appointmentsToday || 0)
  const upcomingAppointments = computed(() => stats.value?.upcomingAppointments || 0)
  const revenueThisMonth = computed(() => stats.value?.revenueThisMonth || 0)
  const activeSubscriptions = computed(() => stats.value?.activeSubscriptions || 0)
  const availableTimeSlots = computed(() => stats.value?.availableTimeSlots || 0)
  const openSupportTickets = computed(() => stats.value?.openSupportTickets || 0)
  const pendingUserReports = computed(() => stats.value?.pendingUserReports || 0)
  const unsentAdminMessages = computed(() => stats.value?.unsentAdminMessages || 0)

  // Computed activity values
  const recentUsers = computed(() => activity.value?.recentUsers || [])

  const lastUpdatedLabel = computed(() => {
    if (!lastUpdatedAt.value) return ''
    return lastUpdatedAt.value.toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  })

  return {
    // State
    dashboardData: readonly(dashboardData),
    loading: readonly(loading),
    error: readonly(error),
    stats,
    activity,
    isLoading,
    lastUpdatedLabel,

    // API methods
    getDashboardData,
    fetchDashboard,
    fetchAppointmentStats,

    // Helper methods
    formatEvolution,
    getTrendIcon,
    getTrendColor,
    getAlertColor,
    getTicketPriorityVariant,
    formatDate,
    formatRelativeDate,
    getChartColors,
    getUserTypeDisplayName,
    getUserTypeBadgeVariant,
    formatCurrency,

    // Computed stats
    totalUsers,
    totalPatients,
    totalClinicians,
    appointmentsThisMonth,
    appointmentsToday,
    upcomingAppointments,
    revenueThisMonth,
    activeSubscriptions,
    availableTimeSlots,
    openSupportTickets,
    pendingUserReports,
    unsentAdminMessages,

    // Computed activity
    recentUsers
  }
}