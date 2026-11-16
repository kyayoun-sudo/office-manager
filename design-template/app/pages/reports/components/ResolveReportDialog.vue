<template>
  <UiDialog :open="open" @update:open="$emit('update:open', $event)">
    <UiDialogContent :prevent-outside-click="true" class="sm:max-w-[600px]">
      <UiDialogHeader>
        <UiDialogTitle>Résoudre le signalement</UiDialogTitle>
        <UiDialogDescription>
          Marquer le signalement #{{ report?.id }} comme résolu et ajouter les détails de résolution
        </UiDialogDescription>
      </UiDialogHeader>
      
      <form class="space-y-4" @submit.prevent="handleSubmit">
        <div class="space-y-2">
          <UiLabel for="resolution_details">Détails de résolution *</UiLabel>
          <UiTextarea
            id="resolution_details"
            v-model="form.resolution_details"
            placeholder="Décrivez comment le signalement a été résolu..."
            class="min-h-[120px]"
            :class="{ 'border-red-500': errors.resolution_details }"
          />
          <p v-if="errors.resolution_details" class="text-sm text-red-500">{{ errors.resolution_details }}</p>
        </div>

        <div class="space-y-2">
          <UiLabel for="admin_notes">Notes administratives *</UiLabel>
          <UiTextarea
            id="admin_notes"
            v-model="form.admin_notes"
            placeholder="Notes internes sur la résolution du signalement..."
            class="min-h-[100px]"
            :class="{ 'border-red-500': errors.admin_notes }"
          />
          <p v-if="errors.admin_notes" class="text-sm text-red-500">{{ errors.admin_notes }}</p>
        </div>

        <div class="flex items-center space-x-2">
          <UiCheckbox 
            id="send_notification" 
            v-model:checked="form.send_notification"
          />
          <UiLabel for="send_notification" class="text-sm font-normal">
            Envoyer une notification aux parties concernées
          </UiLabel>
        </div>

        <div class="p-4 bg-yellow-50 rounded-lg border border-yellow-200">
          <div class="flex items-start space-x-3">
            <AlertTriangle class="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
            <div>
              <p class="text-sm font-medium text-yellow-800">
                Attention
              </p>
              <p class="text-sm text-yellow-700 mt-1">
                Une fois marqué comme résolu, ce signalement ne pourra plus être modifié. 
                Assurez-vous que toutes les actions nécessaires ont été prises.
              </p>
            </div>
          </div>
        </div>

        <UiDialogFooter>
          <UiButton 
            type="button" 
            variant="outline" 
            @click="$emit('update:open', false)"
          >
            Annuler
          </UiButton>
          <UiButton
            type="submit"
            :disabled="loading"
          >
            <AppSpinner v-if="loading" class="h-4 w-4 mr-2" />
            Marquer comme résolu
          </UiButton>
        </UiDialogFooter>
      </form>
    </UiDialogContent>
  </UiDialog>
</template>

<script setup lang="ts">
import { AlertTriangle } from 'lucide-vue-next'
import type { Report, ResolveReportRequest } from '~~/shared/types/report'

interface Props {
  open: boolean
  report: Report | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'success': []
}>()

const { resolveReport } = useReports()
const toast = useToast()

const loading = ref(false)
const form = ref<ResolveReportRequest>({
  resolution_details: '',
  admin_notes: '',
  send_notification: true
})

const errors = ref<Record<string, string>>({})

const validateForm = () => {
  errors.value = {}
  
  if (!form.value.resolution_details || form.value.resolution_details.length < 10) {
    errors.value.resolution_details = 'Les détails de résolution sont requis (minimum 10 caractères)'
  }
  
  if (!form.value.admin_notes || form.value.admin_notes.length < 10) {
    errors.value.admin_notes = 'Les notes administratives sont requises (minimum 10 caractères)'
  }
  
  return Object.keys(errors.value).length === 0
}

const handleSubmit = async () => {
  if (!validateForm() || !props.report) return
  
  try {
    loading.value = true
    
    await resolveReport(props.report.id, form.value)
    
    // Réinitialiser le formulaire
    form.value = {
      resolution_details: '',
      admin_notes: '',
      send_notification: true
    }
    
    emit('success')
  } catch (error: any) {
    toast.handleApiError({ success: false, error: error.message || 'Impossible de résoudre le signalement' }, 'Erreur lors de la résolution')
  } finally {
    loading.value = false
  }
}

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    // Réinitialiser le formulaire quand le dialog s'ouvre
    form.value = {
      resolution_details: '',
      admin_notes: '',
      send_notification: true
    }
    errors.value = {}
  }
})
</script>