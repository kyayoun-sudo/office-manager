<template>
  <UiDialog :open="open" @update:open="$emit('update:open', $event)">
    <UiDialogContent :prevent-outside-click="true" class="max-w-[90vw] sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
      <UiDialogHeader>
        <UiDialogTitle>Répondre au ticket #{{ ticket?.id }}</UiDialogTitle>
        <UiDialogDescription>
          Envoyer une réponse à {{ ticket?.user.firstName }} {{ ticket?.user.lastName }} pour le ticket "{{ ticket?.subject }}"
        </UiDialogDescription>
      </UiDialogHeader>
      
      <div v-if="ticket" class="space-y-4">
        <!-- Résumé du ticket -->
        <div class="p-4 bg-gray-50 rounded-lg border">
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium">{{ ticket.subject }}</span>
              <UiBadge :variant="getPriorityVariant(ticket.priority)">
                {{ getPriorityLabel(ticket.priority) }}
              </UiBadge>
            </div>
            <p class="text-xs text-muted-foreground">{{ truncateText(ticket.description, 150) }}</p>
          </div>
        </div>

        <form class="space-y-4" @submit.prevent="handleSubmit">
          <div class="space-y-2">
            <UiLabel for="response">Réponse *</UiLabel>
            <UiTextarea
              id="response"
              v-model="form.message"
              placeholder="Votre réponse à l'utilisateur..."
              class="min-h-[120px]"
              :class="{ 'border-red-500': errors.message }"
            />
            <p v-if="errors.message" class="text-sm text-red-500">{{ errors.message }}</p>
          </div>

          <div class="space-y-2">
            <UiLabel for="internal_notes">Notes internes (optionnel)</UiLabel>
            <UiTextarea
              id="internal_notes"
              v-model="form.internalNotes"
              placeholder="Notes internes visibles uniquement par l'équipe support..."
              class="min-h-[80px]"
            />
            <p class="text-sm text-gray-500">Ces notes ne seront pas visibles par l'utilisateur</p>
          </div>

          <div class="space-y-3">
            <div class="flex items-center gap-2">
              <UiCheckbox 
                id="send_email" 
                v-model:checked="form.sendNotification"
              />
              <UiLabel for="send_email" class="text-sm font-normal">
                Envoyer un email de notification à l'utilisateur
              </UiLabel>
            </div>

            <div class="flex items-center gap-2">
              <UiCheckbox 
                id="close_ticket" 
                v-model:checked="form.closeTicket"
              />
              <UiLabel for="close_ticket" class="text-sm font-normal">
                Fermer le ticket après avoir envoyé la réponse
              </UiLabel>
            </div>
          </div>

          <div v-if="form.closeTicket" class="p-4 bg-yellow-50 rounded-lg border border-yellow-200">
            <div class="flex items-start gap-3">
              <AlertTriangle class="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
              <div>
                <p class="text-sm font-medium text-yellow-800">
                  Fermeture automatique
                </p>
                <p class="text-sm text-yellow-700 mt-1">
                  Le ticket sera automatiquement fermé après l'envoi de cette réponse. 
                  L'utilisateur ne pourra plus y répondre.
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
              class="w-full sm:w-auto"
            >
              <AppSpinner v-if="loading" class="h-4 w-4 mr-2" />
              <span class="truncate">{{ form.closeTicket ? 'Répondre et fermer' : 'Envoyer la réponse' }}</span>
            </UiButton>
          </UiDialogFooter>
        </form>
      </div>
    </UiDialogContent>
  </UiDialog>
</template>

<script setup lang="ts">
import { AlertTriangle } from 'lucide-vue-next'
import type { SupportTicket, RespondToTicketRequest } from '~~/shared/types/support-ticket'

interface Props {
  open: boolean
  ticket: SupportTicket | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'success': []
}>()

const { respondToTicket, getPriorityLabel, getPriorityVariant } = useSupportTickets()
const toast = useToast()

const loading = ref(false)
const form = ref<RespondToTicketRequest & { sendNotification: boolean }>({
  message: '',
  closeTicket: false,
  internalNotes: '',
  sendNotification: true
})

const errors = ref<Record<string, string>>({})

const validateForm = () => {
  errors.value = {}
  
  if (!form.value.message || form.value.message.length < 10) {
    errors.value.message = 'La réponse est requise (minimum 10 caractères)'
  }
  
  return Object.keys(errors.value).length === 0
}

const handleSubmit = async () => {
  if (!validateForm() || !props.ticket) return
  
  try {
    loading.value = true
    
    const payload = {
      message: form.value.message,
      closeTicket: form.value.closeTicket,
      sendNotification: form.value.sendNotification
    }
    if (form.value.internalNotes) {
      payload.internalNotes = form.value.internalNotes
    }
    
    await respondToTicket(props.ticket.id, payload)
    
    // Réinitialiser le formulaire
    form.value = {
      message: '',
      closeTicket: false,
      internalNotes: '',
      sendNotification: true
    }
    
    emit('success')
  } catch (error: any) {
    toast.handleApiError({ success: false, error: error.message || 'Impossible d\'envoyer la réponse' }, 'Erreur lors de l\'envoi')
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
      message: '',
      closeTicket: false,
      internalNotes: '',
      sendNotification: true
    }
    errors.value = {}
  }
})
</script>