import type { Timestampable } from './timestampable'

export type DocumentType = 'terms' | 'privacy' | 'sales_conditions'

export interface DocumentTranslation {
  id: number
  documentId: number
  languageId: number
  title: string
  content: string
  language: {
    id: number
    code: string
    name: string
  }
}

export interface Document extends Timestampable {
  id: number
  documentType: DocumentType
  version: string
  isActive: boolean
  translations: DocumentTranslation[]
}

export interface CreateDocumentData {
  documentType: DocumentType
  version: string
  isActive?: boolean
  translations: Array<{
    languageCode: string
    title: string
    content: string
  }>
}

export interface UpdateDocumentData extends Partial<CreateDocumentData> {
  id: number
}

export interface DocumentsResponse {
  success: boolean
  data: Document[]
  message?: string
}

export interface DocumentResponse {
  success: boolean
  data: Document
  message?: string
}

export interface DocumentFilters {
  type?: DocumentType | 'all'
  isActive?: boolean | 'all'
  search?: string
}

export interface DocumentStats {
  total: number
  active: number
  inactive: number
  byType: Record<DocumentType, number>
}

export interface SimpleDocumentsResponse {
  success: boolean
  data: Document[]
  message?: string
  pagination?: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNextPage: boolean
    hasPrevPage: boolean
  }
}