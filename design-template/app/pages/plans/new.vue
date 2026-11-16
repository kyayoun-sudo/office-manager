<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'
import type { CreatePlanRequest } from '~~/shared/types/subscription-plan'

definePageMeta({})
useHead({ title: "Nouveau plan d'abonnement - Modèle d’administration" })

const { plans, createPlan, fetchPlans } = usePlans()
const toast = useToast()
const isSubmitting = ref(false)

const handleSubmit = async (data: CreatePlanRequest) => {
  isSubmitting.value = true
  try {
    const success = await createPlan(data)
    if (success) {
      toast.handleApiSuccess('Plan créé avec succès')
      navigateTo('/plans')
    } else {
      toast.handleApiError({ success: false, message: 'Impossible de créer le plan' })
    }
  } catch (err: any) {
    toast.handleApiError({ success: false, message: err.message || 'Erreur lors de la création' })
  } finally {
    isSubmitting.value = false
  }
}

onMounted(() => fetchPlans({ page: 1, limit: 100 }))
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center gap-3">
      <UiButton variant="ghost" size="icon" @click="navigateTo('/plans')">
        <ArrowLeft class="h-4 w-4" />
      </UiButton>
      <div>
        <h1 class="text-2xl font-bold tracking-tight">Nouveau plan d'abonnement</h1>
        <p class="text-sm text-muted-foreground">Créez un nouveau plan avec traductions et intégration Stripe</p>
      </div>
    </div>

    <UiCard class="p-6">
      <PlanForm
        :plans="plans"
        :is-loading="isSubmitting"
        @submit="handleSubmit"
        @cancel="navigateTo('/plans')"
      />
    </UiCard>
  </div>
</template>
