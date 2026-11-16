import type { Patient, PatientFilters, PatientsResponse } from '~~~/shared/types/patient'
import { useApiResponse } from './useApiResponse'

export const usePatients = () => {
  const patients = ref<Patient[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const total = ref(0)
  const { handlePaginatedResponse, handleApiResponse } = useApiResponse()
  
  // Fetch all components
  const fetchPatients = async (filters?: PatientFilters) => {
    isLoading.value = true
    error.value = null
    
    try {
      const params: Record<string, any> = {}
      
      // Pagination
      if (filters?.page) params.page = filters.page
      if (filters?.limit) params.limit = filters.limit
      if (filters?.sortBy) params.sortBy = filters.sortBy
      if (filters?.sortOrder) params.sortOrder = filters.sortOrder
      
      // Filtres
      if (filters?.search) params.search = filters.search
      if (filters?.numberOfChildren !== undefined) params.numberOfChildren = filters.numberOfChildren
      
      console.log('Fetching components with params:', params)
      const response = await api.get<PatientsResponse>('/patients', { params })
      console.log('Patients API Response:', response)
      
      const { success, data, pagination, error: apiError } = handlePaginatedResponse<Patient>(response)
      
      if (success) {
        patients.value = data
        total.value = pagination?.total || data.length
        console.log('Patients loaded successfully:', data.length, 'patients')
      } else {
        error.value = apiError || 'Erreur lors du chargement des components'
        patients.value = []
        total.value = 0
        console.log('No data received or API error:', error.value)
      }
      
    } catch (err: any) {
      error.value = err.message || 'Erreur lors du chargement des components'
      patients.value = []
      total.value = 0
      console.error('Erreur fetchPatients:', err)
    } finally {
      isLoading.value = false
    }
  }
  
  // Get patient by ID
  const getPatientById = async (id: number): Promise<Patient | null> => {
    const response = await api.get<Patient>(`/patients/${id}`)
    const { success, data, error: apiError } = handleApiResponse<Patient>(response)
    
    if (success && data) {
      return data
    } else {
      error.value = apiError || 'Erreur lors du chargement du patient'
      return null
    }
  }
  
  // Filter helpers
  const filterByNumberOfChildren = (numberOfChildren: number) => {
    return patients.value.filter(patient => patient.numberOfChildren === numberOfChildren)
  }
  
  const searchPatients = (query: string) => {
    const searchLower = query.toLowerCase()
    return patients.value.filter(patient => 
      patient.user.firstName.toLowerCase().includes(searchLower) ||
      patient.user.lastName.toLowerCase().includes(searchLower) ||
      patient.user.email.toLowerCase().includes(searchLower) ||
      patient.user.phone.toLowerCase().includes(searchLower) ||
      patient.user.address.toLowerCase().includes(searchLower) ||
      (patient.bio && patient.bio.toLowerCase().includes(searchLower)) ||
      (patient.allergies && patient.allergies.toLowerCase().includes(searchLower))
    )
  }
  
  // Computed properties
  const patientsWithBio = computed(() => patients.value.filter(p => p.bio && p.bio.trim() !== ''))
  const patientsWithAllergies = computed(() => patients.value.filter(p => p.allergies && p.allergies.trim() !== ''))
  
  const childrenStats = computed(() => {
    const stats = {
      none: 0,
      one: 0,
      two: 0,
      threeOrMore: 0
    }
    patients.value.forEach(patient => {
      const children = patient.numberOfChildren || 0
      if (children === 0) stats.none++
      else if (children === 1) stats.one++
      else if (children === 2) stats.two++
      else stats.threeOrMore++
    })
    return stats
  })

  // Helper functions
  const getFullName = (patient: Patient): string => {
    return `${patient.user.firstName} ${patient.user.lastName}`
  }

  const formatBirthDate = (birthDate: string): string => {
    return new Date(birthDate).toLocaleDateString('fr-FR')
  }

  const calculateAge = (birthDate: string | null): number => {
    if (!birthDate) return 0
    const today = new Date()
    const birth = new Date(birthDate)
    let age = today.getFullYear() - birth.getFullYear()
    const monthDiff = today.getMonth() - birth.getMonth()
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--
    }
    return age
  }
  
  const getChildrenDisplayText = (numberOfChildren: number): string => {
    if (numberOfChildren === 0) return 'Aucun enfant'
    if (numberOfChildren === 1) return '1 enfant'
    return `${numberOfChildren} enfants`
  }
  
  return {
    // State
    patients: readonly(patients),
    isLoading: readonly(isLoading),
    error: readonly(error),
    total: readonly(total),
    
    // Methods
    fetchPatients,
    getPatientById,
    filterByNumberOfChildren,
    searchPatients,
    getFullName,
    formatBirthDate,
    calculateAge,
    getChildrenDisplayText,
    
    // Computed
    patientsWithBio,
    patientsWithAllergies,
    childrenStats
  }
}