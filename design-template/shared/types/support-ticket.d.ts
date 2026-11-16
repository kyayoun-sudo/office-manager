import type { UserDetails } from './auth'

export interface ConversationAuthor {
  id: number
  name: string
  email: string
  type: 'admin' | 'user'
}

export interface ConversationMessage {
  id: number
  author: ConversationAuthor
  message: string
  type: 'response' | 'message' | 'note'
  timestamp: string
  created_at: string
}

export interface TicketAttachment {
  id: number
  filename: string
  url: string
  size: number
  contentType: string
  uploadedAt: string
}

export type TicketStatus = 
  | 'open' 
  | 'in_progress' 
  | 'waiting_user'
  | 'resolved' 
  | 'closed'

export type TicketPriority = 
  | 'low' 
  | 'medium' 
  | 'high' 
  | 'urgent'

export type TicketCategory = 
  | 'account_issue'
  | 'payment_problem'
  | 'technical_bug'
  | 'feature_request'
  | 'appointment_issue'
  | 'profile_problem'
  | 'login_difficulty'
  | 'general_question'
  | 'other'

export interface SupportTicket {
  id: number
  user: UserDetails
  subject: string
  description: string
  status: TicketStatus
  priority: TicketPriority
  category: TicketCategory
  assignedTo: UserDetails | null
  closedBy: UserDetails | null
  adminResponse: string | null
  conversation: ConversationMessage[]
  attachments: TicketAttachment[]
  internalNotes: string | null
  responseTimeMinutes: number | null
  satisfactionRating: number | null
  userFeedback: string | null
  firstResponseAt: string | null
  lastResponseAt: string | null
  closedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface TicketFilters {
  status?: TicketStatus
  priority?: TicketPriority
  category?: TicketCategory
  page?: number
  limit?: number
  search?: string
  assignedTo?: number
}

export interface SupportTicketsResponse {
  success: boolean
  data: SupportTicket[]
  message: string
  total?: number
  pagination?: {
    currentPage: number
    totalPages: number
    totalItems: number
    itemsPerPage: number
  }
}

export interface RespondToTicketRequest {
  message: string
  closeTicket?: boolean
  internalNotes?: string
  sendNotification?: boolean
}

export interface CloseTicketRequest {
  reason?: string
  sendNotification?: boolean
  internalNotes?: string
}

export interface UpdateTicketRequest {
  status?: TicketStatus
  priority?: TicketPriority
  assignedTo?: number
  internalNotes?: string
}