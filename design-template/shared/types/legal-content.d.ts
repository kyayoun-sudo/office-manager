export type LegalContentType = 'terms' | 'privacy' | 'about'

export interface LegalContent {
  id: number
  contentType: LegalContentType
  title: string
  content: string
  version: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateLegalContentRequest {
  contentType: LegalContentType
  title: string
  content: string
  version: string
}

export interface UpdateLegalContentRequest {
  title?: string
  content?: string
  version?: string
}

export interface LegalContentFilters {
  contentType?: LegalContentType | 'all'
  isActive?: boolean | 'all'
  search?: string
}

export interface LegalContentApiResponse {
  success: boolean
  data: LegalContent[]
  message: string
}

export interface LegalContentStats {
  total: number
  active: number
  inactive: number
  byType: Record<LegalContentType, number>
}