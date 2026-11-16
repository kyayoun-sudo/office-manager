export interface AppointmentPatient {
  id: number
  user: {
    id: number
    email: string
    firstName: string
    lastName: string
    address: string
    street: string | null
    houseNumber: string | null
    postalCode: string
    latitude: string
    longitude: string
    phone: string
    birthDate: string
    profilePhoto: string | null
    isActive: boolean
    preferredLanguages: string[]
    createdAt: string
    updatedAt: string
    lastLoginAt: string | null
    passwordResetCount: number | null
    confirmedAt: string | null
    googleCalendarEnabled: boolean
    googleLinkedAt: string | null
    appleLinkedAt: string | null
    iCloudCalendarEnabled: boolean
    deletionRequestedAt: string | null
    deletionRequestReason: string | null
    deletionRequestStatus: string | null
  }
  bio: string
  allergies: string | null
  numberOfChildren: number
  createdAt: string
  updatedAt: string
}

export interface AppointmentClinician {
  id: number
  email: string
  firstName: string
  lastName: string
  address: string
  street: string | null
  houseNumber: string | null
  postalCode: string
  latitude: string
  longitude: string
  phone: string
  birthDate: string | null
  profilePhoto: string | null
  isActive: boolean
  preferredLanguages: string[]
  createdAt: string
  updatedAt: string
  lastLoginAt: string | null
  passwordResetCount: number | null
  confirmedAt: string | null
  googleCalendarEnabled: boolean
  googleLinkedAt: string | null
  appleLinkedAt: string | null
  iCloudCalendarEnabled: boolean
  deletionRequestedAt: string | null
  deletionRequestReason: string | null
  deletionRequestStatus: string | null
}

export interface AppointmentOffice {
  id: number
  name: string
  address: string
  street: string | null
  houseNumber: string | null
  postalCode: string
  additionalInfo: string | null
  mapLink: string | null
  color: string
  latitude: string
  longitude: string
  phone: string
  email: string
  description: string
  isActive: boolean
  defaultDuration: number
  createdAt: string
  updatedAt: string
}

export interface AppointmentCategory {
  id: number
  code: string
  name?: string
  isActive?: boolean
}

export interface Appointment {
  id: number
  patient: AppointmentPatient
  clinician: AppointmentClinician
  office: AppointmentOffice
  specialty: any | null
  category: AppointmentCategory
  appointmentDate: string
  isDateSetByClinician: boolean
  duration: number
  status: 'pending' | 'scheduled' | 'confirmed' | 'cancelled' | 'completed' | 'in_progress' | 'no_show'
  notes: string
  isAdditional: boolean
  consultationLocation: string | null
  expectedDeliveryDate: string | null
  appointmentTime: string | null
  deliveryDate: string | null
  deliveryTermWeeks: number | null
  deliveryTermDays: number | null
  deliveryParity: any | null
  specialNotes: string | null
  perineum: string | null
  deliveryLocation: string | null
  pregnancySpecifics: string | null
  cancelledAt: string | null
  patientAddress: string | null
  patientHouseNumber: string | null
  patientPostalCode: string | null
  patientPhone: string | null
  createdAt: string
  updatedAt: string
}

export interface AppointmentsResponse {
  success: boolean
  data: Appointment[] | {
    data: Appointment[]
    pagination: {
      page: number
      limit: number
      total: number
      totalPages: number
      hasNextPage: boolean
      hasPrevPage: boolean
    }
  }
}

export interface AppointmentFilters {
  // Pagination
  page?: number
  limit?: number
  sortBy?: 'appointmentDate' | 'appointmentTime' | 'createdAt' | 'status'
  sortOrder?: 'ASC' | 'DESC'
  
  // Filters
  search?: string
  patientId?: number
  clinicianId?: number
  officeId?: number
  status?: string[]
  dateFrom?: string
  dateTo?: string
  isEmergency?: boolean
  followUpRequired?: boolean
  deliveryType?: string
}

export interface AppointmentStats {
  total: number
  pending: number
  scheduled: number
  confirmed: number
  completed: number
  cancelled: number
  emergency: number
  followUpRequired: number
}

export interface CreateAppointmentRequest {
  patientId: number
  clinicianId: number
  officeId?: number
  appointmentDate: string
  appointmentTime: string
  duration: number
  status?: string
  notes?: string
  reason?: string
  isEmergency?: boolean
}

export interface UpdateAppointmentRequest {
  patientId?: number
  clinicianId?: number
  officeId?: number
  appointmentDate?: string
  appointmentTime?: string
  duration?: number
  status?: string
  notes?: string
  reason?: string
  isEmergency?: boolean
  cancellationReason?: string
  cancelledBy?: 'patient' | 'clinician' | 'admin'
  deliveryExpectedDate?: string
  deliveryActualDate?: string
  deliveryType?: string
  deliveryLocation?: string
  babyGender?: string
  babyWeight?: number
  babyHeight?: number
  complications?: string
  followUpRequired?: boolean
  followUpNotes?: string
}