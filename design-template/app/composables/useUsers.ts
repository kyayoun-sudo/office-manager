import type { AdminUser, AdminCreateUserPayload, UserFilters } from '~~~/shared/types/user'
import { api } from '~/utils/api'

export const useUsers = () => {
  const { handleApiResponse } = useApiResponse()
  const crud = useApiCrud<AdminUser>('/users', { limit: 20 })

  // Build params from filters
  const buildParams = (filters?: UserFilters | Record<string, any>): Record<string, any> => {
    const params: Record<string, any> = {}

    if (filters) {
      if ('role' in filters && filters.role) params.role = filters.role
      if ('isActive' in filters && filters.isActive !== undefined) params.isActive = filters.isActive
      if ('search' in filters && filters.search) params.search = filters.search
      if ('city' in filters && filters.city) params.city = filters.city
      if ('country' in filters && filters.country) params.country = filters.country
      if ('email' in filters && filters.email) params.email = filters.email
      if ('fullname' in filters && filters.fullname) params.fullname = filters.fullname
      if ('postalCode' in filters && filters.postalCode) params.postalCode = filters.postalCode
      if ('deletionRequested' in filters && filters.deletionRequested !== undefined) params.deletionRequested = filters.deletionRequested
      if ('page' in filters && filters.page) params.page = filters.page
      if ('limit' in filters && filters.limit) params.limit = filters.limit
      if ('sortBy' in filters && filters.sortBy) params.sortBy = filters.sortBy
      if ('sortOrder' in filters && filters.sortOrder) params.sortOrder = filters.sortOrder
    }

    return params
  }

  // Fetch all components
  const fetchUsers = async (filters?: UserFilters | Record<string, any>) => {
    const params = buildParams(filters)
    return crud.fetchList(params)
  }

  // Fetch more components (for infinite scroll)
  const fetchMoreUsers = () => crud.fetchMore()

  // Get user by ID
  const getUserById = async (id: number): Promise<AdminUser | null> =>
    crud.getById(id)

  // Update user status
  const updateUserStatus = async (id: number, isActive: boolean): Promise<{ success: boolean; message?: string; error?: string }> => {
    try {
      const response = await api.patch(`/users/${id}`, { isActive })
      const { success, error: apiError } = handleApiResponse(response)

      if (success) {
        const userIndex = crud._items.value.findIndex(u => u.id === id)
        if (userIndex !== -1) {
          crud._items.value[userIndex].isActive = isActive
        }
        const successMessage = (response as any)?.data?.message || (response as any)?.message || `Utilisateur ${isActive ? 'activé' : 'désactivé'} avec succès`
        return { success: true, message: successMessage }
      } else {
        return { success: false, error: apiError || 'Erreur lors de la mise à jour' }
      }
    } catch (err: any) {
      return { success: false, error: err.message || 'Erreur lors de la mise à jour du statut' }
    }
  }

  const createUser = async (userData: AdminCreateUserPayload): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await api.post<any>('/users', userData)
      const { success, data, error: apiError } = handleApiResponse<AdminUser>(response)

      if (success && data) {
        crud._items.value.push(data)
        if (crud._pagination.value) {
          crud._pagination.value = {
            ...crud._pagination.value,
            total: crud._pagination.value.total + 1,
          }
        }
        return { success: true }
      } else {
        return { success: false, error: apiError || 'Erreur lors de la création' }
      }
    } catch (err: any) {
      return { success: false, error: err.message || 'Erreur lors de la création' }
    }
  }

  // Update user
  const updateUser = async (id: number, userData: any): Promise<boolean> => {
    try {
      const response = await api.put<any>(`/users/${id}`, userData)
      const { success, data, error: apiError } = handleApiResponse<AdminUser>(response)

      if (success && data) {
        const userIndex = crud._items.value.findIndex(u => u.id === id)
        if (userIndex !== -1) {
          crud._items.value[userIndex] = data
        }
        return true
      } else {
        return false
      }
    } catch {
      return false
    }
  }

  // Delete user
  const deleteUser = async (id: number): Promise<{ success: boolean; message?: string; error?: string }> => {
    try {
      const response = await api.delete(`/users/${id}`)
      const { success, error: apiError } = handleApiResponse(response)

      if (success) {
        crud._items.value = crud._items.value.filter(u => u.id !== id)
        if (crud._pagination.value) {
          crud._pagination.value = {
            ...crud._pagination.value,
            total: Math.max(0, crud._pagination.value.total - 1),
          }
        }
        const successMessage = (response as any)?.data?.message || (response as any)?.message || 'Utilisateur supprimé avec succès'
        return { success: true, message: successMessage }
      } else {
        return { success: false, error: apiError || 'Erreur lors de la suppression' }
      }
    } catch (err: any) {
      return { success: false, error: err.message || 'Erreur lors de la suppression de l\'utilisateur' }
    }
  }

  // Bulk actions — keep the original detailed return type
  const bulkUpdateUserStatus = async (ids: number[], isActive: boolean): Promise<{
    success: boolean
    results: { success: number; failed: number }
    messages: { success: string[]; errors: string[] }
  }> => {
    const results = { success: 0, failed: 0 }
    const messages = { success: [] as string[], errors: [] as string[] }

    try {
      const promises = ids.map(async (id) => {
        try {
          const response = await api.patch(`/users/${id}`, { isActive })
          const { success, error: apiError } = handleApiResponse(response)

          if (success) {
            const userIndex = crud._items.value.findIndex(u => u.id === id)
            if (userIndex !== -1) {
              crud._items.value[userIndex].isActive = isActive
            }
            results.success++
            messages.success.push(
              (response as any)?.data?.message || (response as any)?.message || `Utilisateur ${id} ${isActive ? 'activé' : 'désactivé'} avec succès`,
            )
          } else {
            results.failed++
            messages.errors.push(apiError || `Erreur pour l'utilisateur ${id}`)
          }
        } catch (err: any) {
          results.failed++
          messages.errors.push(`Utilisateur ${id}: ${err.message || 'Erreur inconnue'}`)
        }
      })

      await Promise.all(promises)
      return { success: true, results, messages }
    } catch (err: any) {
      return { success: false, results, messages }
    }
  }

  const bulkDeleteUsers = async (ids: number[]): Promise<{
    success: boolean
    results: { success: number; failed: number }
    messages: { success: string[]; errors: string[] }
  }> => {
    const results = { success: 0, failed: 0 }
    const messages = { success: [] as string[], errors: [] as string[] }

    try {
      const promises = ids.map(async (id) => {
        try {
          const response = await api.delete(`/users/${id}`)
          const { success, error: apiError } = handleApiResponse(response)

          if (success) {
            results.success++
            messages.success.push(
              (response as any)?.data?.message || (response as any)?.message || `Utilisateur ${id} supprimé avec succès`,
            )
          } else {
            results.failed++
            messages.errors.push(apiError || `Erreur pour l'utilisateur ${id}`)
          }
        } catch (err: any) {
          results.failed++
          messages.errors.push(`Utilisateur ${id}: ${err.message || 'Erreur inconnue'}`)
        }
      })

      await Promise.all(promises)

      if (results.success > 0) {
        crud._items.value = crud._items.value.filter(u => !ids.includes(u.id))
        if (crud._pagination.value) {
          crud._pagination.value = {
            ...crud._pagination.value,
            total: Math.max(0, crud._pagination.value.total - results.success),
          }
        }
      }

      return { success: true, results, messages }
    } catch (err: any) {
      return { success: false, results, messages }
    }
  }

  // Helper functions
  const getUserRole = (user: AdminUser): string => {
    return user.role?.code || 'patient'
  }

  const getUserTypeDisplayName = (roleCode: string): string => {
    switch (roleCode) {
      case 'admin': return 'Admin'
      case 'clinician': return 'Professionnel de santé'
      case 'patient': return 'Patient'
      default: return 'Utilisateur'
    }
  }

  const getUserTypeBadgeVariant = (roleCode: string) => {
    switch (roleCode) {
      case 'admin': return 'destructive'
      case 'clinician': return 'secondary'
      case 'patient': return 'default'
      default: return 'outline'
    }
  }

  // Filter helpers
  const filterByRole = (role: string) =>
    crud._items.value.filter(user => getUserRole(user) === role)

  const filterByStatus = (isActive: boolean) =>
    crud._items.value.filter(user => user?.isActive === isActive)

  const searchUsers = (query: string) => {
    const searchLower = query.toLowerCase()
    return crud._items.value.filter(user =>
      user?.firstName?.toLowerCase().includes(searchLower)
      || user?.lastName?.toLowerCase().includes(searchLower)
      || user?.email?.toLowerCase().includes(searchLower),
    )
  }

  // Computed properties
  const activeUsers = computed(() => filterByStatus(true))
  const inactiveUsers = computed(() => filterByStatus(false))
  const adminUsers = computed(() => filterByRole('admin'))
  const patientUsers = computed(() => filterByRole('patient'))
  const clinicianUsers = computed(() => filterByRole('clinician'))

  const roleStats = computed(() => {
    const stats: Record<string, number> = {}
    crud._items.value.forEach((user) => {
      const role = getUserRole(user)
      stats[role] = (stats[role] || 0) + 1
    })
    return stats
  })

  const checkEmailAvailability = async (email: string): Promise<boolean> => {
    try {
      const response = await api.get<any>('/register/check-availability', { params: { email } })
      const { success } = handleApiResponse(response)
      return success
    } catch {
      return false
    }
  }

  const validateClinician = async (clinicianId: number): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await api.patch<any>(`/clinicians/${clinicianId}/verification`, { verified: true })
      const { success, error: apiError } = handleApiResponse(response)
      if (success) {
        const user = crud._items.value.find(u => u.clinician?.id === clinicianId)
        if (user?.clinician) user.clinician.verified = true as any
        return { success: true }
      }
      return { success: false, error: apiError || 'Erreur lors de la validation' }
    } catch (err: any) {
      return { success: false, error: err.message || 'Erreur lors de la validation' }
    }
  }

  const resendConfirmation = async (userId: number): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await api.post<any>(`/users/${userId}/resend-confirmation`)
      const { success, error: apiError } = handleApiResponse(response)
      if (success) return { success: true }
      return { success: false, error: apiError || "Erreur lors de l'envoi" }
    } catch (err: any) {
      return { success: false, error: err.message || "Erreur lors de l'envoi de l'email" }
    }
  }

  const activateAccount = async (code: string): Promise<{ success: boolean; message?: string; error?: string }> => {
    try {
      const response = await api.post<any>('/verification-codes', { code, type: 'email_verification' })
      const { success, error: apiError } = handleApiResponse(response)
      if (success) {
        const msg = (response as any)?.data?.message || (response as any)?.message || 'Compte activé avec succès'
        return { success: true, message: msg }
      }
      return { success: false, error: apiError || "Erreur lors de l'activation" }
    } catch (err: any) {
      return { success: false, error: err.message || "Erreur lors de l'activation du compte" }
    }
  }

  const rejectClinician = async (
    clinicianId: number,
    payload: { rejectionReasonId?: number; reason?: string; reasonLang?: string },
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await api.patch<any>(`/clinicians/${clinicianId}/verification`, {
        verified: false,
        ...payload,
      })
      const { success, error: apiError } = handleApiResponse(response)
      if (success) {
        const user = crud._items.value.find(u => u.clinician?.id === clinicianId)
        if (user?.clinician) {
          user.clinician.verified = false as any
          user.clinician.rejectionReason = payload.reason || ''
        }
        return { success: true }
      }
      return { success: false, error: apiError || 'Erreur lors du rejet' }
    } catch (err: any) {
      return { success: false, error: err.message || 'Erreur lors du rejet' }
    }
  }

  return {
    // State
    users: crud.items,
    isLoading: crud.isLoading,
    isLoadingMore: crud.isLoadingMore,
    hasMore: crud.hasMore,
    error: crud.error,
    total: crud.total,
    currentPage: crud.currentPage,
    totalPages: crud.totalPages,
    itemsPerPage: crud.itemsPerPage,

    // Methods
    fetchUsers,
    fetchMoreUsers,
    getUserById,
    createUser,
    updateUser,
    updateUserStatus,
    deleteUser,
    bulkUpdateUserStatus,
    bulkDeleteUsers,
    checkEmailAvailability,
    validateClinician,
    rejectClinician,
    resendConfirmation,
    activateAccount,
    filterByRole,
    filterByStatus,
    searchUsers,
    getUserRole,
    getUserTypeDisplayName,
    getUserTypeBadgeVariant,

    // Computed
    activeUsers,
    inactiveUsers,
    adminUsers,
    patientUsers,
    clinicianUsers,
    roleStats,
  }
}
