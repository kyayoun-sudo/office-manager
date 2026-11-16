// Types pour les langues

export interface Language {
  id: number
  code: string
  flag?: string
  enabled: boolean
  translations?: LanguageTranslation[]
  createdAt?: string
  updatedAt?: string
}

export interface LanguageTranslation {
  id: number
  name: string
  nativeName?: string
  targetLanguage?: Language
}

export interface CreateLanguageDto {
  code: string
  flag?: string
  enabled?: boolean
}

export interface UpdateLanguageDto {
  code?: string
  flag?: string
  enabled?: boolean
}

export interface LanguageListResponse {
  success: boolean
  data: Language[] | {
    data: Language[]
    pagination?: {
      total: number
      page: number
      limit: number
      totalPages: number
    }
  }
  error?: {
    message: string
  }
}
