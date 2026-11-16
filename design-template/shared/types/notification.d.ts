// Interface pour le contenu i18n selon le controller
export interface I18nContentDto {
  fr?: string
  en?: string
  nl?: string
}

// Interface pour l'envoi de notification unique
export interface SendNotificationRequest {
  userId: number
  title: string | I18nContentDto
  body: string | I18nContentDto
  data?: Record<string, string>
}

// Interface pour l'envoi de notifications multiples
export interface SendMultipleNotificationsRequest {
  userIds: number[]
  title: string | I18nContentDto
  body: string | I18nContentDto
  data?: Record<string, string>
}

// Interface pour l'envoi de notification par topic
export interface SendTopicNotificationRequest {
  topic: string
  title: string | I18nContentDto
  body: string | I18nContentDto
  data?: Record<string, string>
}

// Interface pour les réponses d'envoi
export interface NotificationSendResponse {
  message: string
}

// Types pour les topics disponibles
export type FirebaseTopic = 'all_users' | 'clinicians' | 'patients'

// Interface pour les statistiques (mock pour UI)
export interface NotificationStats {
  totalSent: number
  todaysSent: number
  thisWeekSent: number
  successRate: number
  byTopic: Record<FirebaseTopic, number>
  byLanguage: Record<string, number>
}

// Interface pour l'historique des notifications (mock)
export interface NotificationHistory {
  id: string
  type: 'single' | 'multiple' | 'topic'
  target: string | number | number[]
  title: string | I18nContentDto
  body: string | I18nContentDto
  status: 'sent' | 'pending' | 'failed'
  sentAt: string
  recipientCount?: number
  successCount?: number
  failureCount?: number
}

// Interface pour les filtres de l'historique
export interface NotificationHistoryFilters {
  type?: 'single' | 'multiple' | 'topic'
  status?: 'sent' | 'pending' | 'failed'
  dateFrom?: string
  dateTo?: string
  searchQuery?: string
}

// Types d'erreur pour les notifications
export interface NotificationError {
  message: string
  code?: string
  details?: any
}

// Interface pour les templates de notifications (pour UI)
export interface NotificationTemplate {
  id: string
  name: string
  type: 'single' | 'multiple' | 'topic'
  title: string | I18nContentDto
  body: string | I18nContentDto
  defaultData?: Record<string, string>
  isActive: boolean
  createdAt: string
  updatedAt?: string
}

// Interface pour créer un template
export interface CreateNotificationTemplateRequest {
  name: string
  type: 'single' | 'multiple' | 'topic'
  title: string | I18nContentDto
  body: string | I18nContentDto
  defaultData?: Record<string, string>
  isActive?: boolean
}

// Interface pour mettre à jour un template
export interface UpdateNotificationTemplateRequest {
  name?: string
  title?: string | I18nContentDto
  body?: string | I18nContentDto
  defaultData?: Record<string, string>
  isActive?: boolean
}