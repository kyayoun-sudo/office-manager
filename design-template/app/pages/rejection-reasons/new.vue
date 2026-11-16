<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'
import type { CreateRejectionReasonDto } from '~~/shared/types/rejection-reason'

definePageMeta({})
useHead({ title: 'Nouveau motif de rejet - Modèle d’administration' })

const { createRejectionReason } = useRejectionReasons()
const toast = useToast()
const isSubmitting = ref(false)

const handleSubmit = async (data: CreateRejectionReasonDto) => {
  isSubmitting.value = true
  try {
    const result = await createRejectionReason(data)
    if (result?.success) {
      toast.handleApiSuccess('Motif de rejet créé avec succès')
      navigateTo('/rejection-reasons')
    } else {
      toast.handleApiError({ success: false, message: "Erreur lors de la création" })
    }
  } catch (err: any) {
    toast.handleApiError({ success: false, message: err.message || "Erreur lors de la création" })
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center gap-3">
      <UiButton variant="ghost" size="icon" @click="navigateTo('/rejection-reasons')">
        <ArrowLeft class="h-4 w-4" />
      </UiButton>
      <div>
        <h1 class="text-2xl font-bold tracking-tight">Nouveau motif de rejet</h1>
        <p class="text-sm text-muted-foreground">Créez un nouveau motif avec ses traductions</p>
      </div>
    </div>

    <UiCard class="p-6">
      <RejectionReasonForm
        :is-loading="isSubmitting"
        @submit="handleSubmit"
        @cancel="navigateTo('/rejection-reasons')"
      />
    </UiCard>
  </div>
</template>
