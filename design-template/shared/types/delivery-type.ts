// Types pour les types d'accouchement

export interface DeliveryTypeTranslation {
  id?: number
  languageCode?: string
  name: string
  description?: string
  language?: {
    id: number
    code: string
  }
}

export interface DeliveryType {
  id: number
  code: string
  isActive: boolean
  name?: string
  description?: string
  translations?: DeliveryTypeTranslation[]
  createdAt?: string
  updatedAt?: string
}

export interface CreateDeliveryTypeTranslationDto {
  languageCode: string
  name: string
  description?: string
}

export interface CreateDeliveryTypeDto {
  code: string
  isActive?: boolean
  translations: CreateDeliveryTypeTranslationDto[]
}

export interface UpdateDeliveryTypeTranslationDto {
  languageCode: string
  name?: string
  description?: string
}

export interface UpdateDeliveryTypeDto {
  code?: string
  isActive?: boolean
  translations?: UpdateDeliveryTypeTranslationDto[]
}

export interface DeliveryTypeListResponse {
  success: boolean
  data: DeliveryType[]
  pagination?: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNextPage: boolean
    hasPrevPage: boolean
  }
  error?: {
    message: string
  }
}

export interface DeliveryTypeQueryParams {
  page?: number
  limit?: number
  sortBy?: string
  sortOrder?: 'ASC' | 'DESC'
  code?: string
  isActive?: boolean
  search?: string
  lang?: string
  includeAllTranslations?: boolean
}
