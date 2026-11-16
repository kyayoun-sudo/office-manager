import type { Country } from './country'

export interface CityTranslation {
  id: number
  name: string
  language: {
    id: number
    code: string
  }
}

export interface City {
  id: number
  postalCode?: string
  name?: string
  isActive: boolean
  country?: Country
  translations?: CityTranslation[]
}

export interface CreateCityTranslationDto {
  languageId: number
  name: string
}

export interface CreateCityDto {
  postalCode: string
  countryId: number
  isActive?: boolean
  translations: CreateCityTranslationDto[]
}

export interface UpdateCityDto {
  postalCode?: string
  countryId?: number
  isActive?: boolean
  translations?: CreateCityTranslationDto[]
}
