import type { Language } from './language'
import type { City } from './city'
import type { Category } from './category'

export interface Translation {
  id: number
  name: string
  description: string
  language: Language
}

export interface MidwifeSpecialty {
  id: number
  code: string
  translations: Translation[]
  category: Category
}

export interface MidwifeUser {
  id: number
  email: string
  firstName: string
  lastName: string
  phone: string
  isActive: boolean
  profilePhoto: string | null
  city: City | null
}

export interface Midwife {
  id: number
  user: MidwifeUser
  appliesConventionalRates: boolean
  verified: boolean | null
  travelFees: string | null
  bio: string
  specialties: MidwifeSpecialty[]
  inamiNumber?: string | null
  verifiedAt?: string | null
  rejectionReason?: string | null
  createdAt: string
}

export interface MidwivesResponse {
  success: boolean
  data: Midwife[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNextPage: boolean
    hasPrevPage: boolean
  }
}

export interface MidwifeFilters {
  // Pagination
  page?: number
  limit?: number
  sortBy?: 'createdAt' | 'firstName' | 'lastName' | 'conventionalRate'
  sortOrder?: 'ASC' | 'DESC'
  
  // Filtres
  search?: string
  specialtyCode?: string
  minRate?: number
  maxRate?: number
  isActive?: boolean
}