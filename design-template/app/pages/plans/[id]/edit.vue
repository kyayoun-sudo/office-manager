<script setup lang="ts">
import { ArrowLeft, Loader2 } from 'lucide-vue-next'
import type { Plan, UpdatePlanRequest } from '~~/shared/types/subscription-plan'

definePageMeta({})
useHead({ title: "Modifier le plan - Modèle d’administration" })

const route = useRoute()
const planId = computed(() => Number(route.params.id))

const { getPlanById, updatePlan } = usePlans()
const toast = useToast()

const plan = ref<Plan | null>(null)
const isLoading = ref(true)
const isSubmitting = ref(false)

const loadPlan = async () => {
  isLoading.value = true
  plan.value = await getPlanById(planId.value, true)
  isLoading.value = false
}

const handleSubmit = async (data: UpdatePlanRequest) => {
  if (!plan.value) return
  isSubmitting.value = true
  try {
    const success = await updatePlan(plan.value.id, data)
    if (success) {
      toast.handleApiSuccess('Plan mis à jour avec succès')
      navigateTo('/plans')
    } else {
      toast.handleApiError({ success: false, message: 'Impossible de mettre à jour le plan' })
    }
  } catch (err: any) {
    toast.handleApiError({ success: false, message: err.message || 'Erreur lors de la modification' })
  } finally {
    isSubmitting.value = false
  }
}

onMounted(() => loadPlan())
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center gap-3">
      <UiButton variant="ghost" size="icon" @click="navigateTo('/plans')">
        <ArrowLeft class="h-4 w-4" />
      </UiButton>
      <div>
        <h1 class="text-2xl font-bold tracking-tight">Modifier le plan</h1>
        <p class="text-sm text-muted-foreground">Modifiez les informations et traductions du plan</p>
      </div>
    </div>

    <div v-if="isLoading" class="flex items-center justify-center py-20">
      <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
    </div>

    <template v-else-if="plan">
      <UiCard class="p-6">
        <PlanForm
          :plan="plan"
          :is-loading="isSubmitting"
          @submit="handleSubmit"
          @cancel="navigateTo('/plans')"
        />
      </UiCard>
    </template>

    <div v-else class="py-20 text-center">
      <p class="text-muted-foreground">Plan introuvable</p>
      <UiButton variant="outline" class="mt-4" @click="navigateTo('/plans')">
        Retour à la liste
      </UiButton>
    </div>
  </div>
</template>
