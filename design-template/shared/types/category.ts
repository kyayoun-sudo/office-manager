export interface CategoryTranslation {
  id: number
  name: string
  description?: string
  language: {
    id: number
    code: string
  }
}

export interface Category {
  id: number
  code: string
  name?: string
  description?: string
  isActive: boolean
  translations?: CategoryTranslation[]
  createdAt?: string
  updatedAt?: string
}

export interface CategoryListResponse {
  success: boolean
  data: Category[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNextPage: boolean
    hasPrevPage: boolean
  }
}

export interface CreateCategoryTranslationDto {
  languageCode: string
  name: string
  description?: string
}

export interface CreateCategoryDto {
  code: string
  isActive?: boolean
  translations: CreateCategoryTranslationDto[]
}

export interface UpdateCategoryDto {
  code?: string
  isActive?: boolean
  translations?: CreateCategoryTranslationDto[]
}

export interface CategoryQueryParams {
  page?: number
  limit?: number
  search?: string
  code?: string
  active?: boolean
  lang?: string
  sortBy?: string
  sortOrder?: 'ASC' | 'DESC'
  includeAllTranslations?: boolean
}
