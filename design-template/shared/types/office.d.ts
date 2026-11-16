import type { Timestampable } from './timestampable'
import type { UserDetails } from './auth'
import type { Specialty, SpecialtyTranslation } from './specialty'

// Interfaces de base pour les offices
export interface Office extends Timestampable {
  id: number
  name: string
  address?: string
  street?: string
  postalCode?: string
  cityId?: number
  additionalInfo?: string
  mapLink?: string
  color?: string
  latitude?: number
  longitude?: number
  phone?: string
  email?: string
  description?: string
  isActive: boolean
  clinician?: {
    id: number
    user: UserDetails
  }
  specialties?: Specialty[]
  specialtyIds?: number[]
  availabilities?: OfficeAvailability[]
}


// Types pour les disponibilités
export type AvailabilityType = 'daily' | 'weekly'

export interface TimeSlot {
  start: string // Format "HHhMM" (ex: "09h00")
  end: string   // Format "HHhMM" (ex: "17h00")
}

export interface DaySchedule {
  day: number // 0-6 (dimanche à samedi)
  slots: TimeSlot[]
  consultationDuration?: number
}

export interface OfficeAvailability extends Timestampable {
  id: number
  type: AvailabilityType
  consultationDuration: number
  days?: DaySchedule[]
  date?: string // Pour type 'daily' avec date spécifique
  office?: Office
}

// DTOs pour les requêtes
export interface CreateOfficeRequest {
  name: string
  address?: string
  street?: string
  postalCode?: string
  cityId?: number
  additionalInfo?: string
  mapLink?: string
  color?: string
  latitude?: number
  longitude?: number
  phone?: string
  email?: string
  description?: string
  specialtyIds: number[]
  isActive?: boolean
}

export interface UpdateOfficeRequest {
  name?: string
  address?: string
  street?: string
  postalCode?: string
  cityId?: number
  additionalInfo?: string
  mapLink?: string
  color?: string
  latitude?: number
  longitude?: number
  phone?: string
  email?: string
  description?: string
  specialtyIds?: number[]
  isActive?: boolean
}

export interface CreateOfficeAvailabilityRequest {
  type: AvailabilityType
  consultationDuration?: number
  days?: DaySchedule[]
  date?: string // Pour type 'daily'
  timeSlots?: TimeSlot[] // Legacy support
  slots?: TimeSlot[] // Legacy support
}

export interface UpdateOfficeAvailabilityRequest {
  type?: AvailabilityType
  consultationDuration?: number
  days?: DaySchedule[]
  date?: string
  timeSlots?: TimeSlot[]
  slots?: TimeSlot[]
}

// Filtres pour les requêtes
export interface OfficeFilters {
  page?: number
  limit?: number
  sortBy?: string
  sortOrder?: 'ASC' | 'DESC'
  search?: string
  specialtyId?: number
  specialtyCode?: string
  clinicianId?: number
  isActive?: boolean
}

export interface AvailabilityFilters {
  page?: number
  limit?: number
  sortBy?: string
  sortOrder?: 'ASC' | 'DESC'
  startDate?: string
  endDate?: string
  dayOfWeek?: number
  appointmentType?: string
  bookableOnly?: boolean
  isActive?: boolean
  type?: AvailabilityType
}

// Réponses paginées
export interface PaginatedOfficesResponse {
  data: Office[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNextPage: boolean
    hasPrevPage: boolean
  }
}

export interface PaginatedAvailabilitiesResponse {
  data: OfficeAvailability[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNextPage: boolean
    hasPrevPage: boolean
  }
}

// Réponses d'API standardisées
export interface OfficeApiResponse<T = any> {
  success: boolean
  message: string
  data?: T
  pagination?: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNextPage: boolean
    hasPrevPage: boolean
  }
}

// Types pour les créneaux disponibles
export interface AvailableSlot {
  id: number
  officeId: number
  startTime: string
  endTime: string
  date: string
  appointmentType?: string
  isAvailable: boolean
  consultationDuration: number
}

export interface PaginatedAvailableSlotsResponse {
  data: AvailableSlot[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNextPage: boolean
    hasPrevPage: boolean
  }
}

// Statistiques des offices (pour admin)
export interface OfficeStats {
  totalOffices: number
  activeOffices: number
  inactiveOffices: number
  officesWithAvailabilities: number
  totalAvailabilities: number
  averageAvailabilitiesPerOffice: number
  officesBySpecialty: Record<string, number>
  officesCreatedThisMonth: number
}