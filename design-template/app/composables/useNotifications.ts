import type {
  SendNotificationRequest,
  SendMultipleNotificationsRequest,
  SendTopicNotificationRequest,
  NotificationSendResponse,
  NotificationStats,
  NotificationHistory,
  NotificationHistoryFilters,
  NotificationTemplate,
  CreateNotificationTemplateRequest,
  UpdateNotificationTemplateRequest,
  I18nContentDto,
  FirebaseTopic
} from '~~/shared/types/notification'
import { useApiResponse } from './useApiResponse'

export const useNotifications = () => {
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const { handleApiResponse } = useApiResponse()

  // Notification history from real API
  const notificationHistory = ref<NotificationHistory[]>([])
  const templates = ref<NotificationTemplate[]>([])

  // Send single notification
  const sendNotification = async (notificationData: SendNotificationRequest): Promise<boolean> => {
    try {
      isLoading.value = true
      error.value = null

      const response = await api.post<NotificationSendResponse>('/notifications/send', notificationData)
      const { success, error: apiError } = handleApiResponse(response)

      if (success) {
        return true
      } else {
        error.value = apiError || 'Erreur lors de l\'envoi'
        return false
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors de l\'envoi'
      return false
    } finally {
      isLoading.value = false
    }
  }

  // Send multiple notifications
  const sendMultipleNotifications = async (notificationData: SendMultipleNotificationsRequest): Promise<boolean> => {
    try {
      isLoading.value = true
      error.value = null

      const response = await api.post<NotificationSendResponse>('/notifications/send-multiple', notificationData)
      const { success, error: apiError } = handleApiResponse(response)

      if (success) {
        return true
      } else {
        error.value = apiError || 'Erreur lors de l\'envoi multiple'
        return false
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors de l\'envoi multiple'
      return false
    } finally {
      isLoading.value = false
    }
  }

  // Send topic notification
  const sendTopicNotification = async (notificationData: SendTopicNotificationRequest): Promise<boolean> => {
    try {
      isLoading.value = true
      error.value = null

      const response = await api.post<NotificationSendResponse>('/notifications/send-topic', notificationData)
      const { success, error: apiError } = handleApiResponse(response)

      if (success) {
        return true
      } else {
        error.value = apiError || 'Erreur lors de l\'envoi par topic'
        return false
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors de l\'envoi par topic'
      return false
    } finally {
      isLoading.value = false
    }
  }

  // Load notification history from real API
  const loadNotificationHistory = async (filters?: { page?: number, limit?: number, type?: string, status?: string }) => {
    try {
      isLoading.value = true
      error.value = null

      const queryParams = new URLSearchParams()
      if (filters?.page) queryParams.append('page', filters.page.toString())
      if (filters?.limit) queryParams.append('limit', filters.limit.toString())
      if (filters?.type) queryParams.append('type', filters.type)
      if (filters?.status) queryParams.append('status', filters.status)

      const response = await api.get(`/notifications?${queryParams.toString()}`)

      if (response && response.success && response.data) {
        notificationHistory.value = response.data.data || response.data // Handle both possible response formats
        return response.data
      } else {
        error.value = 'Erreur lors du chargement des notifications'
        return null
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors du chargement des notifications'
      return null
    } finally {
      isLoading.value = false
    }
  }

  // Get unread count
  const getUnreadCount = async (): Promise<number> => {
    try {
      isLoading.value = true
      error.value = null

      const response = await api.get('/notifications/unread-count')

      if (response && response.success && response.unreadCount !== undefined) {
        return response.unreadCount
      } else {
        error.value = 'Erreur lors du chargement du nombre de notifications non lues'
        return 0
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors du chargement du nombre de notifications non lues'
      return 0
    } finally {
      isLoading.value = false
    }
  }

  // Mark all notifications as read
  const markAllAsRead = async (): Promise<boolean> => {
    try {
      isLoading.value = true
      error.value = null

      const response = await api.patch('/notifications/read-all')

      if (response && response.success) {
        // Refresh the notification history after marking all as read
        await loadNotificationHistory()
        return true
      } else {
        error.value = 'Erreur lors du marquage de toutes les notifications comme lues'
        return false
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors du marquage de toutes les notifications comme lues'
      return false
    } finally {
      isLoading.value = false
    }
  }

  // Mark single notification as read
  const markAsRead = async (id: number): Promise<boolean> => {
    try {
      isLoading.value = true
      error.value = null

      const response = await api.patch(`/notifications/${id}/read`)

      if (response && response.success) {
        // Update the notification in the local history
        const notification = notificationHistory.value.find(n => n.id === id.toString() || n.id === id)
        if (notification) {
          notification.isRead = true
        }
        return true
      } else {
        error.value = 'Erreur lors du marquage de la notification comme lue'
        return false
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors du marquage de la notification comme lue'
      return false
    } finally {
      isLoading.value = false
    }
  }

  // Delete notification
  const deleteNotification = async (id: number): Promise<boolean> => {
    try {
      isLoading.value = true
      error.value = null

      const response = await api.delete(`/notifications/${id}`)

      if (response && response.message) {
        // Remove from local history
        notificationHistory.value = notificationHistory.value.filter(n =>
          n.id !== id.toString() && n.id !== id
        )
        return true
      } else {
        error.value = 'Erreur lors de la suppression de la notification'
        return false
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors de la suppression de la notification'
      return false
    } finally {
      isLoading.value = false
    }
  }

  // Template management (mock for now - no backend endpoints available yet)
  const createTemplate = async (templateData: CreateNotificationTemplateRequest): Promise<boolean> => {
    try {
      const newTemplate: NotificationTemplate = {
        id: Date.now().toString(),
        name: templateData.name,
        type: templateData.type,
        title: templateData.title,
        body: templateData.body,
        defaultData: templateData.defaultData,
        isActive: templateData.isActive ?? true,
        createdAt: new Date().toISOString()
      }

      templates.value.push(newTemplate)
      return true
    } catch (err: any) {
      error.value = err.message || 'Erreur lors de la création du template'
      return false
    }
  }

  const updateTemplate = async (id: string, templateData: UpdateNotificationTemplateRequest): Promise<boolean> => {
    try {
      const index = templates.value.findIndex(t => t.id === id)
      if (index !== -1) {
        templates.value[index] = {
          ...templates.value[index],
          ...templateData,
          updatedAt: new Date().toISOString()
        }
        return true
      }
      return false
    } catch (err: any) {
      error.value = err.message || 'Erreur lors de la mise à jour du template'
      return false
    }
  }

  const deleteTemplate = async (id: string): Promise<boolean> => {
    try {
      templates.value = templates.value.filter(t => t.id !== id)
      return true
    } catch (err: any) {
      error.value = err.message || 'Erreur lors de la suppression du template'
      return false
    }
  }

  // Filter history (now operates on actual data)
  const filterHistory = (filters: NotificationHistoryFilters) => {
    let result = notificationHistory.value

    if (filters.type) {
      result = result.filter(h => h.type === filters.type)
    }

    if (filters.status) {
      result = result.filter(h => h.status === filters.status)
    }

    if (filters.searchQuery) {
      const query = filters.searchQuery.toLowerCase()
      result = result.filter(h => {
        const title = typeof h.title === 'string' ? h.title : (h.title as I18nContentDto).fr || (h.title as I18nContentDto).en || ''
        const body = typeof h.body === 'string' ? h.body : (h.body as I18nContentDto).fr || (h.body as I18nContentDto).en || ''
        return title.toLowerCase().includes(query) || body.toLowerCase().includes(query)
      })
    }

    if (filters.dateFrom) {
      result = result.filter(h => new Date(h.sentAt) >= new Date(filters.dateFrom!))
    }

    if (filters.dateTo) {
      result = result.filter(h => new Date(h.sentAt) <= new Date(filters.dateTo!))
    }

    return result
  }

  // Computed properties based on real data
  const notificationStats = computed((): NotificationStats => {
    const today = new Date()
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const weekStart = new Date(today)
    weekStart.setDate(today.getDate() - 7)

    const todaysNotifications = notificationHistory.value.filter(h =>
      new Date(h.sentAt) >= todayStart
    )

    const weekNotifications = notificationHistory.value.filter(h =>
      new Date(h.sentAt) >= weekStart
    )

    const totalSent = notificationHistory.value.reduce((sum, h) => sum + (h.successCount || h.recipientCount || 1), 0)
    const totalFailed = notificationHistory.value.reduce((sum, h) => sum + (h.failureCount || 0), 0)
    const successRate = totalSent + totalFailed > 0 ? (totalSent / (totalSent + totalFailed)) * 100 : 100

    const byTopic: Record<FirebaseTopic, number> = {
      all_users: 0,
      clinicians: 0,
      patients: 0
    }

    notificationHistory.value.forEach(h => {
      if (h.type === 'topic' && typeof h.target === 'string') {
        const topic = h.target as FirebaseTopic
        if (byTopic[topic] !== undefined) {
          byTopic[topic] += h.successCount || h.recipientCount || 1
        }
      }
    })

    const byLanguage: Record<string, number> = {
      fr: 0,
      en: 0,
      nl: 0
    }

    notificationHistory.value.forEach(h => {
      if (typeof h.title === 'object') {
        const i18nTitle = h.title as I18nContentDto
        if (i18nTitle.fr) byLanguage.fr += h.successCount || h.recipientCount || 1
        if (i18nTitle.en) byLanguage.en += h.successCount || h.recipientCount || 1
        if (i18nTitle.nl) byLanguage.nl += h.successCount || h.recipientCount || 1
      } else {
        byLanguage.fr += h.successCount || h.recipientCount || 1 // Default to french for simple strings
      }
    })

    return {
      totalSent: totalSent,
      todaysSent: todaysNotifications.reduce((sum, h) => sum + (h.successCount || h.recipientCount || 1), 0),
      thisWeekSent: weekNotifications.reduce((sum, h) => sum + (h.successCount || h.recipientCount || 1), 0),
      successRate: Math.round(successRate),
      byTopic,
      byLanguage
    }
  })

  // Helper functions
  const getEstimatedTopicUsers = (topic: FirebaseTopic): number => {
    switch (topic) {
      case 'all_users': return 1250
      case 'clinicians': return 45
      case 'patients': return 1200
      default: return 0
    }
  }

  const getNotificationTypeLabel = (type: 'single' | 'multiple' | 'topic'): string => {
    switch (type) {
      case 'single': return 'Individuelle'
      case 'multiple': return 'Multiple'
      case 'topic': return 'Topic'
      default: return type
    }
  }

  const getNotificationStatusLabel = (status: 'sent' | 'pending' | 'failed'): string => {
    switch (status) {
      case 'sent': return 'Envoyée'
      case 'pending': return 'En cours'
      case 'failed': return 'Échec'
      default: return status
    }
  }

  const getNotificationStatusColor = (status: 'sent' | 'pending' | 'failed'): string => {
    switch (status) {
      case 'sent': return 'text-green-600'
      case 'pending': return 'text-orange-600'
      case 'failed': return 'text-red-600'
      default: return 'text-gray-600'
    }
  }

  const formatTitle = (title: string | I18nContentDto, lang: string = 'fr'): string => {
    if (typeof title === 'string') return title
    return title[lang as keyof I18nContentDto] || title.fr || title.en || title.nl || ''
  }

  const formatBody = (body: string | I18nContentDto, lang: string = 'fr'): string => {
    if (typeof body === 'string') return body
    return body[lang as keyof I18nContentDto] || body.fr || body.en || body.nl || ''
  }

  const formatTarget = (target: string | number | number[], type: 'single' | 'multiple' | 'topic'): string => {
    switch (type) {
      case 'single':
        return `Utilisateur #${target}`
      case 'multiple':
        return `${Array.isArray(target) ? target.length : 0} utilisateurs`
      case 'topic':
        return `Topic: ${target}`
      default:
        return String(target)
    }
  }

  const formatDateTime = (dateString: string): string => {
    return new Intl.DateTimeFormat('fr-FR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(dateString))
  }

  // Initialize - no longer needed since we use real data
  const initializeMockData = () => {
    // No initialization needed since we fetch real data
  }

  return {
    // State
    isLoading: readonly(isLoading),
    error: readonly(error),
    notificationHistory: readonly(notificationHistory),
    templates: readonly(templates),

    // Methods
    sendNotification,
    sendMultipleNotifications,
    sendTopicNotification,
    loadNotificationHistory,
    getUnreadCount,
    markAllAsRead,
    markAsRead,
    deleteNotification,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    filterHistory,
    initializeMockData,

    // Computed
    notificationStats,

    // Helpers
    getEstimatedTopicUsers,
    getNotificationTypeLabel,
    getNotificationStatusLabel,
    getNotificationStatusColor,
    formatTitle,
    formatBody,
    formatTarget,
    formatDateTime
  }
}