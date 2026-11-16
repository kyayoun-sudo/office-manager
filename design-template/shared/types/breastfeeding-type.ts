export interface BreastfeedingTypeTranslation {
  id: number
  name: string
  description?: string
  language: {
    id: number
    code: string
  }
}

export interface BreastfeedingType {
  id: number
  code: string
  name?: string
  description?: string
  isActive: boolean
  translations?: BreastfeedingTypeTranslation[]
  createdAt?: string
  updatedAt?: string
}

export interface BreastfeedingTypeListResponse {
  success: boolean
  data: BreastfeedingType[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNextPage: boolean
    hasPrevPage: boolean
  }
}

export interface CreateBreastfeedingTypeTranslationDto {
  languageCode: string
  name: string
  description?: string
}

export interface CreateBreastfeedingTypeDto {
  code: string
  isActive?: boolean
  translations: CreateBreastfeedingTypeTranslationDto[]
}

export interface UpdateBreastfeedingTypeDto {
  code?: string
  isActive?: boolean
  translations?: CreateBreastfeedingTypeTranslationDto[]
}

export interface BreastfeedingTypeQueryParams {
  page?: number
  limit?: number
  search?: string
  code?: string
  isActive?: boolean
  lang?: string
  sortBy?: string
  sortOrder?: 'ASC' | 'DESC'
}