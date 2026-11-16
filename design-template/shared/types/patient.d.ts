export interface PatientUser {
  id: number
  email: string
  firstName: string
  lastName: string
  address: string
  postalCode: string
  phone: string
  isActive: boolean
  lastLoginAt: string | null
  profilePhoto: string | null
}

export interface Patient {
  id: number
  user: PatientUser
  birthDate: string | null
  bio: string | null
  allergies: string | null
  numberOfChildren: number
}

export interface PatientsResponse {
  success: boolean
  message: string
  data: Patient[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNextPage: boolean
    hasPrevPage: boolean
  }
}

export interface PatientFilters {
  // Pagination
  page?: number
  limit?: number
  sortBy?: 'createdAt' | 'firstName' | 'lastName' | 'birthDate'
  sortOrder?: 'ASC' | 'DESC'
  
  // Filtres
  search?: string
  numberOfChildren?: number
}