import type {
  SubscriptionPlan,
  CreateSubscriptionPlanData,
  SimpleSubscriptionPlansResponse,
  SubscriptionPlanFormData,
} from '~~/shared/types/subscription-plan'
import { api } from '~/utils/api'

export const useSubscriptionPlans = () => {
  const plans = ref<SubscriptionPlan[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const total = ref(0)

  const fetchSubscriptionPlans = async () => {
    try {
      loading.value = true
      error.value = null
      const response = await api.get<SimpleSubscriptionPlansResponse>('/subscription-plans/all-languages')
      
      console.log('Subscription Plans API Response:', response)
      
      if (response.success && response.data) {
        plans.value = Array.isArray(response.data) ? response.data : []
        total.value = plans.value.length
        console.log('Subscription plans loaded successfully:', plans.value.length, 'plans')
      } else {
        error.value = 'Aucune donnée reçue du serveur'
        plans.value = []
        total.value = 0
        console.log('No data received or API error:', error.value)
      }

    } catch (err: any) {
      error.value = err.message || 'Erreur lors du chargement des plans d\'abonnement'
      plans.value = []
      total.value = 0
      console.error('Erreur fetchSubscriptionPlans:', err)
    } finally {
      loading.value = false
    }
  }

  const createSubscriptionPlan = async (data: CreateSubscriptionPlanData) => {
    loading.value = true
    error.value = null
    const response = await api.post<SubscriptionPlan>('/subscription-plans', data)
    
    if (response.success) {
      await fetchSubscriptionPlans()
    } else {
      error.value = response.error.message || 'Failed to create subscription plan'
    }
    
    loading.value = false
    return response
  }

  const updateSubscriptionPlan = async (id: number, data: Partial<SubscriptionPlan>) => {
    loading.value = true
    error.value = null
    console.log('Update Subscription Plan API Data:', data)
    const response = await api.patch<SubscriptionPlan>(`/subscription-plans/${id}`, data)
    
    if (response.success) {
      await fetchSubscriptionPlans()
    } else {
      error.value = response.error.message || 'Failed to update subscription plan'
    }
    
    loading.value = false
    return response
  }

  const deleteSubscriptionPlan = async (id: number) => {
    loading.value = true
    error.value = null
    const response = await api.delete(`/subscription-plans/${id}`)
    
    if (response.success) {
      await fetchSubscriptionPlans()
    } else {
      error.value = response.error.message || 'Failed to delete subscription plan'
    }
    
    loading.value = false
    return response
  }

  const toggleSubscriptionPlanStatus = async (id: number, isActive: boolean) => {
    loading.value = true
    error.value = null
    const response = await api.patch(`/subscription-plans/${id}`, { isActive })
    
    if (response.success) {
      await fetchSubscriptionPlans()
    } else {
      error.value = response.error.message || 'Failed to toggle subscription plan status'
    }
    
    loading.value = false
    return response
  }

  const toggleSubscriptionPlanVisibility = async (id: number, isPublic: boolean) => {
    loading.value = true
    error.value = null
    const response = await api.patch(`/subscription-plans/${id}`, { isPublic })
    
    if (response.success) {
      await fetchSubscriptionPlans()
    } else {
      error.value = response.error.message || 'Failed to toggle subscription plan visibility'
    }
    
    loading.value = false
    return response
  }

  // Bulk activate subscription plans
  const bulkActivateSubscriptionPlans = async (planIds: number[]): Promise<{ success: boolean; results: any[] }> => {
    const results = await Promise.allSettled(
      planIds.map(id => api.patch(`/subscription-plans/${id}`, { isActive: true }))
    )

    const successCount = results.filter(result => result.status === 'fulfilled').length
    const failedCount = results.length - successCount

    if (successCount > 0) {
      await fetchSubscriptionPlans()
    }

    return {
      success: failedCount === 0,
      results: results.map((result, index) => ({
        id: planIds[index],
        success: result.status === 'fulfilled',
        error: result.status === 'rejected' ? result.reason : null
      }))
    }
  }

  // Bulk deactivate subscription plans
  const bulkDeactivateSubscriptionPlans = async (planIds: number[]): Promise<{ success: boolean; results: any[] }> => {
    const results = await Promise.allSettled(
      planIds.map(id => api.patch(`/subscription-plans/${id}`, { isActive: false }))
    )

    const successCount = results.filter(result => result.status === 'fulfilled').length
    const failedCount = results.length - successCount

    if (successCount > 0) {
      await fetchSubscriptionPlans()
    }

    return {
      success: failedCount === 0,
      results: results.map((result, index) => ({
        id: planIds[index],
        success: result.status === 'fulfilled',
        error: result.status === 'rejected' ? result.reason : null
      }))
    }
  }

  // Bulk delete subscription plans
  const bulkDeleteSubscriptionPlans = async (planIds: number[]): Promise<{ success: boolean; results: any[] }> => {
    const results = await Promise.allSettled(
      planIds.map(id => api.delete(`/subscription-plans/${id}`))
    )

    const successCount = results.filter(result => result.status === 'fulfilled').length
    const failedCount = results.length - successCount

    if (successCount > 0) {
      await fetchSubscriptionPlans()
    }

    return {
      success: failedCount === 0,
      results: results.map((result, index) => ({
        id: planIds[index],
        success: result.status === 'fulfilled',
        error: result.status === 'rejected' ? result.reason : null
      }))
    }
  }

  // Transform form data to API format
  const transformToApiData = (data: SubscriptionPlanFormData): CreateSubscriptionPlanData => {
    return {
      plan: {
        code: data.code.toUpperCase(),
        price: data.price,
        currency: data.currency,
        duration: data.billingInterval,
        billingInterval: data.billingInterval,
        trialPeriodDays: data.trialPeriodDays,
        isActive: data.isActive,
        isPublic: data.isPublic,
        displayOrder: data.displayOrder
      },
      translations: SUPPORTED_LANGUAGES.map(lang => ({
        languageCode: lang.code,
        name: data.translations[lang.code as keyof typeof data.translations].name.trim(),
        description: data.translations[lang.code as keyof typeof data.translations].description.trim(),
        features: data.translations[lang.code as keyof typeof data.translations].features.filter(f => f.trim() !== '')
      }))
    }
  }

  // Helper functions for multilingual support
  const getTranslation = (plan: SubscriptionPlan, languageCode: string) => {
    const translation = plan.translations?.find(t => t.language?.code === languageCode)
    return translation || plan.translations?.[0] // Fallback to first available translation
  }

  const getPlanName = (plan: SubscriptionPlan, languageCode?: string) => {
    const translation = getTranslation(plan, languageCode || 'fr')
    return translation?.name || plan.code
  }

  const getPlanDescription = (plan: SubscriptionPlan, languageCode?: string) => {
    const translation = getTranslation(plan, languageCode || 'fr')
    return translation?.description || ''
  }

  const getPlanFeatures = (plan: SubscriptionPlan, languageCode?: string) => {
    const translation = getTranslation(plan, languageCode || 'fr')
    return translation?.features || []
  }

  return {
    plans: readonly(plans),
    loading: readonly(loading),
    error: readonly(error),
    total: readonly(total),
    fetchSubscriptionPlans,
    createSubscriptionPlan,
    updateSubscriptionPlan,
    deleteSubscriptionPlan,
    toggleSubscriptionPlanStatus,
    toggleSubscriptionPlanVisibility,
    bulkActivateSubscriptionPlans,
    bulkDeactivateSubscriptionPlans,
    bulkDeleteSubscriptionPlans,
    transformToApiData,
    getTranslation,
    getPlanName,
    getPlanDescription,
    getPlanFeatures
  }
}