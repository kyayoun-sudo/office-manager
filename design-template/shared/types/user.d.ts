import type { Patient } from './patient'
import type { Clinician } from './subscription'
import type { City } from './city'
import type { Country } from './country'

export interface AdminUser {
  id: number
  email: string
  firstName: string
  lastName: string
  phone: string
  address?: string
  postalCode?: string
  isActive: boolean
  preferredLanguages: string[]
  confirmedAt: string | null
  createdAt: string
  lastLoginAt: string | null
  googleCalendarEnabled: boolean
  iCloudCalendarEnabled: boolean
  role: Role
  city: City
  patient: Patient | null
  clinician: Clinician | null
}

// Helper types for backward compatibility
export interface Role {
  id: number
  code: string
  name: string
  description: string
}

export interface UsersResponse {
  data: AdminUser[]
  total?: number
  page?: number
  limit?: number
}

export interface UserFilters {
  role?: string
  isActive?: boolean
  search?: string
  city?: string
  country?: string
}

export interface UserTableColumn {
  key: string
  label: string
  sortable?: boolean
  filterable?: boolean
}

export interface AdminCreateUserPayload {
  email: string
  password: string
  firstName: string
  lastName: string
  phone: string
  postalCode: string
  address?: string
  preferredLanguages?: string[]
}