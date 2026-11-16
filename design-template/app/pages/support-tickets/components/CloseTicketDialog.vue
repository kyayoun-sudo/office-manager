<template>
  <UiDialog :open="open" @update:open="$emit('update:open', $event)">
    <UiDialogContent :prevent-outside-click="true" class="max-w-[90vw] sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
      <UiDialogHeader>
        <UiDialogTitle>Fermer le ticket #{{ ticket?.id }}</UiDialogTitle>
        <UiDialogDescription>
          Fermer définitivement le ticket "{{ ticket?.subject }}" de {{ ticket?.user.firstName }} {{ ticket?.user.lastName }}
        </UiDialogDescription>
      </UiDialogHeader>
      
      <div v-if="ticket" class="space-y-4">
        <!-- Résumé du ticket -->
        <div class="p-4 bg-muted rounded-lg border">
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium">{{ ticket.subject }}</span>
              <div class="flex items-center gap-2 flex-wrap">
                <UiBadge :variant="getCategoryVariant(ticket.category)">
                  {{ getCategoryLabel(ticket.category) }}
                </UiBadge>
                <UiBadge :variant="getPriorityVariant(ticket.priority)">
                  {{ getPriorityLabel(ticket.priority) }}
                </UiBadge>
              </div>
            </div>
            <p class="text-xs text-muted-foreground">{{ truncateText(ticket.description, 150) }}</p>
          </div>
        </div>

        <form class="space-y-4" @submit.prevent="handleSubmit">
          <div class="space-y-2">
            <UiLabel for="reason">Raison de la fermeture *</UiLabel>
            <UiTextarea
              id="reason"
              v-model="form.reason"
              placeholder="Expliquez pourquoi le ticket est fermé..."
              class="min-h-[100px]"
              :class="{ 'border-red-500': errors.reason }"
            />
            <p v-if="errors.reason" class="text-sm text-red-500">{{ errors.reason }}</p>
          </div>

          <div class="space-y-2">
            <UiLabel for="internal_notes">Notes internes (optionnel)</UiLabel>
            <UiTextarea
              id="internal_notes"
              v-model="form.internalNotes"
              placeholder="Notes internes sur la fermeture..."
              class="min-h-[80px]"
            />
            <p class="text-sm text-muted-foreground">Ces notes ne seront pas visibles par l'utilisateur</p>
          </div>

          <div class="flex items-center gap-2">
            <UiCheckbox 
              id="send_notification" 
              v-model:checked="form.sendNotification"
            />
            <UiLabel for="send_notification" class="text-sm font-normal">
              Envoyer une notification de fermeture à l'utilisateur
            </UiLabel>
          </div>

          <div class="p-4 bg-red-50 dark:bg-red-950/20 rounded-lg border border-red-200 dark:border-red-800">
            <div class="flex items-start gap-3">
              <AlertTriangle class="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
              <div>
                <p class="text-sm font-medium text-red-800 dark:text-red-200">
                  Attention - Action irréversible
                </p>
                <p class="text-sm text-red-700 dark:text-red-300 mt-1">
                  Une fois fermé, ce ticket ne pourra plus être modifié. L'utilisateur ne pourra plus y répondre. 
                  Assurez-vous que le problème a été résolu avant de fermer.
                </p>
              </div>
            </div>
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
              variant="destructive"
              class="w-full sm:w-auto"
            >
              <AppSpinner v-if="loading" class="h-4 w-4 mr-2" />
              <span class="truncate">Fermer définitivement</span>
            </UiButton>
          </UiDialogFooter>
        </form>
      </div>
    </UiDialogContent>
  </UiDialog>
</template>

<script setup lang="ts">
import { AlertTriangle } from 'lucide-vue-next'
import type { SupportTicket, CloseTicketRequest } from '~~/shared/types/support-ticket'

interface Props {
  open: boolean
  ticket: SupportTicket | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'success': []
}>()

const { closeTicket, getCategoryLabel, getPriorityLabel, getCategoryVariant, getPriorityVariant } = useSupportTickets()
const toast = useToast()

const loading = ref(false)
const form = ref<CloseTicketRequest>({
  reason: '',
  sendNotification: true,
  internalNotes: ''
})

const errors = ref<Record<string, string>>({})

const validateForm = () => {
  errors.value = {}
  
  if (!form.value.reason || form.value.reason.length < 10) {
    errors.value.reason = 'La raison de fermeture est requise (minimum 10 caractères)'
  }
  
  return Object.keys(errors.value).length === 0
}

const handleSubmit = async () => {
  if (!validateForm() || !props.ticket) return
  
  try {
    loading.value = true
    
    const payload = {
      reason: form.value.reason,
      sendNotification: form.value.sendNotification
    }
    if (form.value.internalNotes) {
      payload.internalNotes = form.value.internalNotes
    }
    
    await closeTicket(props.ticket.id, payload)
    
    // Réinitialiser le formulaire
    form.value = {
      reason: '',
      sendNotification: true,
      internalNotes: ''
    }
    
    emit('success')
  } catch (error: any) {
    toast.handleApiError({ success: false, error: error.message || 'Impossible de fermer le ticket' }, 'Erreur lors de la fermeture')
  } finally {
    loading.value = false
  }
}

const truncateText = (text: string, maxLength: number) => {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength) + '...'
}

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    // Réinitialiser le formulaire quand le dialog s'ouvre
    form.value = {
      reason: '',
      sendNotification: true,
      internalNotes: ''
    }
    errors.value = {}
  }
})
</script>