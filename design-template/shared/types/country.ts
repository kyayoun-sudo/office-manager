export interface CountryTranslation {
  id: number
  name: string
  language: {
    id: number
    code: string
  }
}

export interface Country {
  id: number
  code: string
  iso3: string
  phoneCode?: string
  isActive: boolean
  translations?: CountryTranslation[]
}
