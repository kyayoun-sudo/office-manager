export enum TicketStatus {
  OPEN = 'open',
  IN_PROGRESS = 'in_progress',
  RESOLVED = 'resolved',
  CLOSED = 'closed'
}

export enum TicketPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent'
}

export enum TicketCategory {
  TECHNICAL = 'technical',
  BILLING = 'billing',
  ACCOUNT = 'account',
  APPOINTMENT = 'appointment',
  OTHER = 'other'
}

export interface TicketUser {
  id: number
  firstName: string
  lastName: string
  email: string
  phone?: string
}

export interface TicketAssignedTo {
  id: number
  firstName: string
  lastName: string
}

export interface Ticket {
  id: number
  subject: string
  description: string
  status: TicketStatus
  priority: TicketPriority
  category: TicketCategory
  adminNote?: string
  user: TicketUser
  assignedTo?: TicketAssignedTo
  createdAt: string
  updatedAt: string
}

export interface TicketListResponse {
  success: boolean
  data: Ticket[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNextPage: boolean
    hasPrevPage: boolean
  }
}

export interface CreateTicketDto {
  subject: string
  description: string
  priority?: TicketPriority
  category?: TicketCategory
}

export interface UpdateTicketStatusDto {
  status: TicketStatus
  adminNote?: string
  assignedToId?: number
}

export interface TicketQueryParams {
  page?: number
  limit?: number
  status?: TicketStatus
  priority?: TicketPriority
  category?: TicketCategory
  userId?: number
  sortBy?: string
  sortOrder?: 'ASC' | 'DESC'
}

// Mappings pour les labels
export const TicketStatusLabels: Record<TicketStatus, string> = {
  [TicketStatus.OPEN]: 'Ouvert',
  [TicketStatus.IN_PROGRESS]: 'En cours',
  [TicketStatus.RESOLVED]: 'Résolu',
  [TicketStatus.CLOSED]: 'Fermé'
}

export const TicketPriorityLabels: Record<TicketPriority, string> = {
  [TicketPriority.LOW]: 'Basse',
  [TicketPriority.MEDIUM]: 'Moyenne',
  [TicketPriority.HIGH]: 'Haute',
  [TicketPriority.URGENT]: 'Urgente'
}

export const TicketCategoryLabels: Record<TicketCategory, string> = {
  [TicketCategory.TECHNICAL]: 'Technique',
  [TicketCategory.BILLING]: 'Facturation',
  [TicketCategory.ACCOUNT]: 'Compte',
  [TicketCategory.APPOINTMENT]: 'Rendez-vous',
  [TicketCategory.OTHER]: 'Autre'
}