import type { UserProfile, ProfileResponse, UpdateProfileRequest, City, Country } from '~~~/shared/types/profile'
import type { ApiResult } from '~~~/shared/types/api'
import { api } from '~/utils/api'

export const useProfile = () => {
  const profile = ref<UserProfile | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const cities = ref<City[]>([])
  const countries = ref<Country[]>([])

  const fetchProfile = async (): Promise<boolean> => {
    isLoading.value = true
    error.value = null

    const response = await api.get<UserProfile>('auth/profile')
    
    if (response.success && response.data) {
      profile.value = response.data
      isLoading.value = false
      return true
    } else {
      error.value = response.error?.message || 'Erreur lors de la récupération du profil'
      isLoading.value = false
      return false
    }
  }

  const updateProfile = async (data: UpdateProfileRequest): Promise<boolean> => {
    isLoading.value = true
    error.value = null

    const response = await api.put<UserProfile>('/profile', data)
    
    if (response.success && response.data) {
      profile.value = response.data
      isLoading.value = false
      return true
    } else {
      error.value = response.error?.message || 'Erreur lors de la mise à jour du profil'
      isLoading.value = false
      return false
    }
  }

  const fetchCities = async (): Promise<void> => {
    const response = await api.get<City[]>('/cities')
    if (response.success && response.data) {
      cities.value = response.data
    } else {
      console.error('Erreur lors de la récupération des villes:', response.error)
    }
  }

  const fetchCountries = async (): Promise<void> => {
    const response = await api.get<Country[]>('/countries')
    if (response.success && response.data) {
      countries.value = response.data
    } else {
      console.error('Erreur lors de la récupération des pays:', response.error)
    }
  }

  const toggleGoogleCalendar = async (): Promise<boolean> => {
    if (!profile.value) return false

    const newStatus = !profile.value.googleCalendarEnabled
    
    const response = await api.patch<UserProfile>('/profile/google-calendar', {
      googleCalendarEnabled: newStatus
    })
    
    if (response.success && response.data) {
      profile.value = response.data
      return true
    } else {
      error.value = response.error?.message || 'Erreur lors de la mise à jour des paramètres'
      return false
    }
  }

  return {
    // State
    profile: readonly(profile),
    isLoading: readonly(isLoading),
    error: readonly(error),
    cities: readonly(cities),
    countries: readonly(countries),

    // Actions
    fetchProfile,
    updateProfile,
    fetchCities,
    fetchCountries,
    toggleGoogleCalendar
  }
}