<script setup lang="ts">
import { z } from 'zod'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm, useField } from 'vee-validate'
import type { Ticket, UpdateTicketStatusDto, TicketStatus } from '#shared/types/ticket'
import { TicketStatus as TS } from '#shared/types/ticket'

interface Props {
  ticket?: Ticket | null
  isOpen: boolean
  isLoading?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'submit': [data: UpdateTicketStatusDto]
  'cancel': []
}>()

const validationSchema = toTypedSchema(z.object({
  status: z.nativeEnum(TS),
  adminNote: z.string().optional(),
  assignedToId: z.number().optional()
}))

const { handleSubmit, resetForm, errors } = useForm({
  validationSchema,
  initialValues: {
    status: props.ticket?.status || TS.OPEN,
    adminNote: '',
    assignedToId: props.ticket?.assignedTo?.id || undefined
  }
})

// Utiliser useField pour chaque champ
const { value: status } = useField<TicketStatus>('status')
const { value: adminNote } = useField<string>('adminNote')

// Computed pour afficher le label du statut sélectionné
const selectedStatusLabel = computed(() => {
  if (!status.value) return ''
  const option = statusOptions.find(opt => opt.value === status.value)
  return option ? option.label : status.value
})

const statusOptions = [
  { value: TS.OPEN, label: 'Ouvert', description: 'Ticket ouvert, en attente de traitement' },
  { value: TS.IN_PROGRESS, label: 'En cours', description: 'Ticket en cours de traitement' },
  { value: TS.RESOLVED, label: 'Résolu', description: 'Problème résolu' },
  { value: TS.CLOSED, label: 'Fermé', description: 'Ticket fermé définitivement' }
]

const onSubmit = handleSubmit(() => {
  const formData = {
    status: status.value,
    adminNote: adminNote.value || undefined,
    assignedToId: undefined // À implémenter plus tard
  }
  emit('submit', formData as UpdateTicketStatusDto)
})

const onCancel = () => {
  status.value = TS.OPEN
  adminNote.value = ''
  resetForm()
  emit('cancel')
}

watch(() => props.ticket, (newTicket) => {
  if (newTicket) {
    status.value = newTicket.status || TS.OPEN
    adminNote.value = ''
  }
}, { immediate: true })

watch(() => props.isOpen, (isOpen) => {
  if (!isOpen) {
    status.value = TS.OPEN
    adminNote.value = ''
    resetForm()
  }
})
</script>

<template>
  <UiDialog :open="isOpen" @update:open="$event || onCancel()">
    <UiDialogContent class="max-w-lg">
      <UiDialogHeader>
        <UiDialogTitle>Mettre à jour le ticket</UiDialogTitle>
        <UiDialogDescription>
          Modifiez le statut du ticket et ajoutez une note interne si nécessaire.
        </UiDialogDescription>
      </UiDialogHeader>

      <form class="space-y-6" @submit="onSubmit">
        <div class="space-y-4">
          <!-- Informations du ticket -->
          <div v-if="ticket" class="border border-border bg-card text-card-foreground shadow-sm rounded-lg p-4 space-y-2">
            <h4 class="font-medium text-sm">{{ ticket.subject }}</h4>
            <p class="text-xs text-muted-foreground line-clamp-2">{{ ticket.description }}</p>
            <div class="flex gap-2">
              <UiBadge variant="outline" class="text-xs">{{ ticket.user.firstName }} {{ ticket.user.lastName }}</UiBadge>
              <UiBadge variant="secondary" class="text-xs">{{ ticket.category }}</UiBadge>
              <UiBadge variant="destructive" class="text-xs">{{ ticket.priority }}</UiBadge>
            </div>
          </div>

          <!-- Statut -->
          <div class="space-y-2">
            <UiLabel>Nouveau statut</UiLabel>
            <UiSelect v-model="status">
              <UiSelectTrigger>
                <UiSelectValue placeholder="Sélectionner un statut">
                  {{ selectedStatusLabel || 'Sélectionner un statut' }}
                </UiSelectValue>
              </UiSelectTrigger>
              <UiSelectContent>
                <UiSelectItem v-for="statusOption in statusOptions" :key="statusOption.value" :value="statusOption.value">
                  <div class="space-y-1">
                    <div class="font-medium">{{ statusOption.label }}</div>
                    <div class="text-xs text-muted-foreground">{{ statusOption.description }}</div>
                  </div>
                </UiSelectItem>
              </UiSelectContent>
            </UiSelect>
            <p v-if="errors.status" class="text-sm text-destructive">{{ errors.status }}</p>
          </div>

          <!-- Note admin -->
          <div class="space-y-2">
            <UiLabel>Note interne (optionnelle)</UiLabel>
            <UiTextarea 
              v-model="adminNote"
              placeholder="Ajouter une note interne sur les actions effectuées..."
              class="min-h-[100px]"
            />
            <p class="text-xs text-muted-foreground">
              Cette note sera visible uniquement par les administrateurs
            </p>
            <p v-if="errors.adminNote" class="text-sm text-destructive">{{ errors.adminNote }}</p>
          </div>

          <!-- Assignation (placeholder pour fonctionnalité future) -->
          <div v-if="status === TS.IN_PROGRESS" class="p-4 bg-muted/50 rounded-lg">
            <p class="text-sm text-muted-foreground">
              💡 Fonctionnalité future : Assignation du ticket à un membre de l'équipe support
            </p>
          </div>
        </div>

        <UiDialogFooter>
          <UiButton type="button" variant="outline" @click="onCancel">
            Annuler
          </UiButton>
          <UiButton type="submit" :disabled="isLoading">
            <AppSpinner v-if="isLoading" class="mr-2 h-4 w-4" />
            Mettre à jour
          </UiButton>
        </UiDialogFooter>
      </form>
    </UiDialogContent>
  </UiDialog>
</template>