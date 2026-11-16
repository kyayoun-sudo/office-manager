export interface SpecialtyTranslation {
  id: number
  name: string
  description?: string
  language: {
    id: number
    code: string
  }
}

export interface SpecialtyCategory {
  id: number
  code: string
  name?: string
  description?: string
}

export interface Specialty {
  id: number
  code: string
  name?: string
  description?: string
  isActive: boolean
  isDefault: boolean
  clinicianSetsAppointmentDate: boolean
  category?: SpecialtyCategory
  translations?: SpecialtyTranslation[]
  createdAt?: string
  updatedAt?: string
}

export interface SpecialtyListResponse {
  success: boolean
  data: Specialty[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNextPage: boolean
    hasPrevPage: boolean
  }
}

export interface CreateSpecialtyTranslationDto {
  languageCode: string
  name: string
  description?: string
}

export interface CreateSpecialtyDto {
  code: string
  categoryId?: number
  isActive?: boolean
  isDefault?: boolean
  clinicianSetsAppointmentDate?: boolean
  translations: CreateSpecialtyTranslationDto[]
}

export interface UpdateSpecialtyDto {
  code?: string
  categoryId?: number
  isActive?: boolean
  isDefault?: boolean
  clinicianSetsAppointmentDate?: boolean
  translations?: CreateSpecialtyTranslationDto[]
}

export interface SpecialtyTranslationFormData {
  name: string
  description: string
}

export interface SpecialtyFormData {
  code: string
  category: string
  translations: Record<string, SpecialtyTranslationFormData>
}

export interface CreateSpecialtyData {
  specialty: {
    code: string
    category: string
  }
  translations: CreateSpecialtyTranslationDto[]
}

export interface SpecialtyQueryParams {
  page?: number
  limit?: number
  search?: string
  code?: string
  category?: number
  isActive?: boolean
  lang?: string
  includeAllTranslations?: boolean
  sortBy?: string
  sortOrder?: 'ASC' | 'DESC'
}