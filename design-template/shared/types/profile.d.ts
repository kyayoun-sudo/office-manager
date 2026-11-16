import type { Role } from './user'
import type { City } from './city'
import type { Country } from './country'

export interface UserProfile {
  id: number
  email: string
  role: Role
  firstName: string
  lastName: string
  city: City
  country: Country
  phone: string
  isActive: boolean
  preferredLanguage: string
  createdAt: string
  googleCalendarEnabled: boolean
  patient: any | null
  clinician: any | null
}

export interface ProfileResponse {
  success: boolean
  data: UserProfile
  message: string
}

export interface UpdateProfileRequest {
  firstName: string
  lastName: string
  phone: string
  cityId: number
  countryId: number
  preferredLanguage: string
  googleCalendarEnabled: boolean
}