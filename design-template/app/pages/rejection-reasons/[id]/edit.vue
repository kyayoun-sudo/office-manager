<script setup lang="ts">
import { ArrowLeft, Loader2 } from 'lucide-vue-next'
import type { RejectionReason, UpdateRejectionReasonDto } from '~~/shared/types/rejection-reason'

definePageMeta({})
useHead({ title: 'Modifier le motif de rejet - Modèle d’administration' })

const route = useRoute()
const reasonId = computed(() => Number(route.params.id))

const { getRejectionReasonById, updateRejectionReason } = useRejectionReasons()
const toast = useToast()

const rejectionReason = ref<RejectionReason | null>(null)
const isLoading = ref(true)
const isSubmitting = ref(false)

const loadReason = async () => {
  isLoading.value = true
  rejectionReason.value = await getRejectionReasonById(reasonId.value)
  isLoading.value = false
}

const handleSubmit = async (data: UpdateRejectionReasonDto & { id: number }) => {
  isSubmitting.value = true
  try {
    const result = await updateRejectionReason(data)
    if (result?.success) {
      toast.handleApiSuccess('Motif de rejet modifié avec succès')
      navigateTo('/rejection-reasons')
    } else {
      toast.handleApiError({ success: false, message: "Erreur lors de la modification" })
    }
  } catch (err: any) {
    toast.handleApiError({ success: false, message: err.message || "Erreur lors de la modification" })
  } finally {
    isSubmitting.value = false
  }
}

onMounted(() => loadReason())
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center gap-3">
      <UiButton variant="ghost" size="icon" @click="navigateTo('/rejection-reasons')">
        <ArrowLeft class="h-4 w-4" />
      </UiButton>
      <div>
        <h1 class="text-2xl font-bold tracking-tight">Modifier le motif de rejet</h1>
        <p class="text-sm text-muted-foreground">Modifiez les informations et traductions du motif</p>
      </div>
    </div>

    <div v-if="isLoading" class="flex items-center justify-center py-20">
      <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
    </div>

    <template v-else-if="rejectionReason">
      <UiCard class="p-6">
        <RejectionReasonForm
          :rejection-reason="rejectionReason"
          :is-loading="isSubmitting"
          @submit="handleSubmit"
          @cancel="navigateTo('/rejection-reasons')"
        />
      </UiCard>
    </template>

    <div v-else class="py-20 text-center">
      <p class="text-muted-foreground">Motif de rejet introuvable</p>
      <UiButton variant="outline" class="mt-4" @click="navigateTo('/rejection-reasons')">
        Retour à la liste
      </UiButton>
    </div>
  </div>
</template>
