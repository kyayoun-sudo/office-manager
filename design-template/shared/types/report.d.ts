import type { User } from './auth'

export type ReportType = 
  | 'inappropriate_behavior' 
  | 'harassment' 
  | 'fraud' 
  | 'spam'
  | 'fake_profile' 
  | 'safety_concern' 
  | 'technical_issue' 
  | 'other'

export type ReportStatus = 
  | 'pending' 
  | 'in_progress' 
  | 'resolved' 
  | 'rejected' 
  | 'escalated'

export type ReportPriority = 
  | 'low' 
  | 'medium' 
  | 'high' 
  | 'critical'

export type ReportCategory = 
  | 'messaging_abuse'
  | 'professional_conduct'
  | 'platform_abuse'
  | 'safety'
  | 'technical'

export interface Evidence {
  type: string
  content: string
  timestamp: string
}

export interface ReportTranslation {
  id: number
  title: string
  description: string
  adminNotes: string | null
  resolutionDetails: string | null
}

export interface Report {
  id: number
  reporterUser: User
  reportedUser: User
  reportType: ReportType
  status: ReportStatus
  priority: ReportPriority
  category: ReportCategory
  assignedTo: number | null
  resolvedBy: number | null
  evidence: Evidence[]
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
  translations: ReportTranslation[]
}

export interface ReportFilters {
  status?: ReportStatus
  priority?: ReportPriority
  reportType?: ReportType
  category?: ReportCategory
  page?: number
  itemsPerPage?: number
  search?: string
}

export interface ReportsResponse {
  data: Report[]
  total: number
  page: number
  itemsPerPage: number
}

export interface ResolveReportRequest {
  resolution_details: string
  admin_notes: string
  send_notification: boolean
}

export interface UpdateReportStatusRequest {
  status?: ReportStatus
  priority?: ReportPriority
  assigned_to?: number
  admin_notes?: string
}