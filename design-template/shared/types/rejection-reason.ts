export interface RejectionReasonTranslation {
  id?: number
  languageCode: string
  name: string
  description?: string
}

export interface RejectionReason {
  id: number
  code: string
  isActive: boolean
  translations: RejectionReasonTranslation[]
  createdAt?: string
  updatedAt?: string
}

export interface CreateRejectionReasonDto {
  code: string
  isActive?: boolean
  translations: RejectionReasonTranslation[]
}

export interface UpdateRejectionReasonDto {
  code?: string
  isActive?: boolean
  translations?: RejectionReasonTranslation[]
}
