export interface DeliveryParityTranslation {
  id: number
  name: string
  description?: string
  language: {
    id: number
    code: string
  }
}

export interface DeliveryParity {
  id: number
  code: string
  name?: string
  description?: string
  translations?: DeliveryParityTranslation[]
}

export interface CreateDeliveryParityTranslationDto {
  languageCode: string
  name: string
  description?: string
}

export interface CreateDeliveryParityDto {
  code: string
  translations: CreateDeliveryParityTranslationDto[]
}

export interface UpdateDeliveryParityDto {
  code?: string
  translations?: CreateDeliveryParityTranslationDto[]
}
