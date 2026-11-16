import type { UserDetails } from './auth'
import type { Language } from './language'

export interface AnnouncementMessageTranslation {
  id: number
  language: Language
  title: string
  content: string
  summary: string
}

export interface AnnouncementMessage {
  id: number
  targetType: 'all' | 'midwives' | 'patients' | 'provider' | 'clinician' | 'patient'
  priority: 'info' | 'medium' | 'high' | 'urgent' | 'normal'
  type: 'feature' | 'maintenance' | 'security' | 'billing_system' | 'general' | 'promotion' | 'update'
  createdBy: UserDetails
  isActive: boolean
  isSent: boolean
  recipientsCount: number | null
  sentCount: number | null
  scheduledAt: string | null
  sentAt: string | null
  createdAt: string
  updatedAt: string
  translations: AnnouncementMessageTranslation[]
}

export interface MessageTranslationInput {
  languageCode: string
  title: string
  content: string
  summary: string
}

export interface CreateAnnouncementMessageRequest {
  message: {
    type: 'feature' | 'maintenance' | 'security' | 'billing_system' | 'general' | 'promotion' | 'update'
    priority: 'info' | 'medium' | 'high' | 'urgent' | 'normal'
    isActive: boolean
    targetType?: 'all' | 'midwives' | 'patients' | 'provider' | 'clinician' | 'patient'
    scheduledAt?: string
  }
  translations: MessageTranslationInput[]
}

export interface UpdateAnnouncementMessageRequest {
  message?: {
    type?: 'feature' | 'maintenance' | 'security' | 'billing_system' | 'general' | 'promotion' | 'update'
    priority?: 'info' | 'medium' | 'high' | 'urgent' | 'normal'
    isActive?: boolean
    targetType?: 'all' | 'midwives' | 'patients' | 'provider' | 'clinician' | 'patient'
    scheduledAt?: string
  }
  translations?: MessageTranslationInput[]
}

export interface PaginationMeta {
  total: number
  page: number
  limit: number
  totalPages: number
  hasNextPage: boolean
  hasPrevPage: boolean
}

export interface AnnouncementMessageApiResponse {
  success: boolean
  data: AnnouncementMessage[]
  meta: PaginationMeta
  message: string
}

export interface AnnouncementMessageQueryParams {
  page?: number
  limit?: number
  search?: string
  targetType?: 'all' | 'midwives' | 'patients' | 'provider' | 'clinician' | 'patient'
  priority?: 'info' | 'medium' | 'high' | 'urgent' | 'normal'
  type?: 'feature' | 'maintenance' | 'security' | 'billing_system' | 'general' | 'promotion' | 'update'
  isSent?: boolean
  isActive?: boolean
}

export interface BulkActionRequest {
  messageIds: number[]
  action: 'activate' | 'deactivate' | 'delete' | 'send'
}