<template>
  <UiDialog :open="open" @update:open="$emit('update:open', $event)">
    <UiDialogContent :prevent-outside-click="true" class="max-w-[90vw] sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
      <UiDialogHeader>
        <UiDialogTitle>Modifier le statut du signalement</UiDialogTitle>
        <UiDialogDescription>
          Mettre à jour le statut, la priorité et l'assignation du signalement #{{ report?.id }}
        </UiDialogDescription>
      </UiDialogHeader>
      
      <form class="space-y-4" @submit.prevent="handleSubmit">
        <div class="grid grid-cols-2 gap-4">
          <div class="space-y-2">
            <UiLabel for="status">Statut *</UiLabel>
            <UiSelect v-model="form.status">
              <UiSelectTrigger>
                <UiSelectValue placeholder="Sélectionner le statut" />
              </UiSelectTrigger>
              <UiSelectContent>
                <UiSelectItem value="pending">En attente</UiSelectItem>
                <UiSelectItem value="in_progress">En cours</UiSelectItem>
                <UiSelectItem value="resolved">Résolu</UiSelectItem>
                <UiSelectItem value="rejected">Rejeté</UiSelectItem>
                <UiSelectItem value="escalated">Escaladé</UiSelectItem>
              </UiSelectContent>
            </UiSelect>
            <p v-if="errors.status" class="text-sm text-red-500">{{ errors.status }}</p>
          </div>

          <div class="space-y-2">
            <UiLabel for="priority">Priorité *</UiLabel>
            <UiSelect v-model="form.priority">
              <UiSelectTrigger>
                <UiSelectValue placeholder="Sélectionner la priorité" />
              </UiSelectTrigger>
              <UiSelectContent>
                <UiSelectItem value="low">Faible</UiSelectItem>
                <UiSelectItem value="medium">Moyenne</UiSelectItem>
                <UiSelectItem value="high">Élevée</UiSelectItem>
                <UiSelectItem value="critical">Critique</UiSelectItem>
              </UiSelectContent>
            </UiSelect>
            <p v-if="errors.priority" class="text-sm text-red-500">{{ errors.priority }}</p>
          </div>
        </div>

        <div class="space-y-2">
          <UiLabel for="admin_notes">Notes administratives</UiLabel>
          <UiTextarea
            id="admin_notes"
            v-model="form.admin_notes"
            placeholder="Ajoutez des notes sur cette mise à jour..."
            class="min-h-[100px]"
            :class="{ 'border-red-500': errors.admin_notes }"
          />
          <p v-if="errors.admin_notes" class="text-sm text-red-500">{{ errors.admin_notes }}</p>
        </div>

        <UiDialogFooter class="flex flex-col sm:flex-row gap-2">
          <UiButton 
            type="button" 
            variant="outline" 
            class="w-full sm:w-auto"
            @click="$emit('update:open', false)"
          >
            <span class="truncate">Annuler</span>
          </UiButton>
          <UiButton 
            type="submit" 
            :disabled="loading"
            class="w-full sm:w-auto"
          >
            <AppSpinner v-if="loading" class="h-4 w-4 mr-2" />
            <span class="truncate">Mettre à jour</span>
          </UiButton>
        </UiDialogFooter>
      </form>
    </UiDialogContent>
  </UiDialog>
</template>

<script setup lang="ts">
import type { Report, UpdateReportStatusRequest, ReportStatus, ReportPriority } from '~~/shared/types/report'

interface Props {
  open: boolean
  report: Report | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'success': []
}>()

const { updateReportStatus } = useReports()
const toast = useToast()

const loading = ref(false)
const form = ref<UpdateReportStatusRequest>({
  status: undefined,
  priority: undefined,
  assigned_to: undefined,
  admin_notes: ''
})

const errors = ref<Record<string, string>>({})

const validateForm = () => {
  errors.value = {}
  
  if (!form.value.status) {
    errors.value.status = 'Le statut est requis'
  }
  
  if (!form.value.priority) {
    errors.value.priority = 'La priorité est requise'
  }
  
  return Object.keys(errors.value).length === 0
}

const handleSubmit = async () => {
  if (!validateForm() || !props.report) return
  
  try {
    loading.value = true
    
    const payload = { ...form.value }
    if (!payload.assigned_to) {
      delete payload.assigned_to
    }
    
    await updateReportStatus(props.report.id, payload)
    emit('success')
  } catch (error: any) {
    toast.handleApiError({ success: false, error: error.message || 'Impossible de mettre à jour le signalement' }, 'Erreur lors de la mise à jour')
  } finally {
    loading.value = false
  }
}

watch(() => props.report, (newReport) => {
  if (newReport) {
    form.value = {
      status: newReport.status as ReportStatus,
      priority: newReport.priority as ReportPriority,
      assigned_to: newReport.assignedTo,
      admin_notes: ''
    }
  }
}, { immediate: true })
</script>