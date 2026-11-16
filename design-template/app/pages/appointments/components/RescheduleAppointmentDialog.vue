<template>
  <UiDialog :open="open" @update:open="$emit('update:open', $event)">
    <UiDialogContent class="sm:max-w-[400px]">
      <UiDialogHeader>
        <UiDialogTitle>Reprogrammer le rendez-vous</UiDialogTitle>
        <UiDialogDescription>
          Choisissez une nouvelle date et heure pour ce rendez-vous
        </UiDialogDescription>
      </UiDialogHeader>

      <div v-if="appointment" class="space-y-4">
        <div class="bg-muted p-4 rounded-lg">
          <h4 class="font-medium mb-2">Rendez-vous actuel</h4>
          <div class="text-sm space-y-1">
            <p><strong>Patient:</strong> {{ `${appointment.patient.user.firstName} ${appointment.patient.user.lastName}` }}</p>
            <p><strong>Praticien:</strong> {{ `${appointment.provider.firstName} ${appointment.provider.lastName}` }}</p>
            <p><strong>Date actuelle:</strong> {{ formatDateTime(appointment.appointmentDate) }}</p>
            <p><strong>Durée:</strong> {{ appointment.duration }} minutes</p>
          </div>
        </div>

        <form class="space-y-4" @submit.prevent="onSubmit">
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-2">
              <UiLabel for="newDate">Nouvelle date *</UiLabel>
              <UiInput
                id="newDate"
                v-model="form.date"
                type="date"
                required
                :min="minDate"
              />
            </div>
            <div class="space-y-2">
              <UiLabel for="newTime">Nouvelle heure *</UiLabel>
              <UiInput
                id="newTime"
                v-model="form.time"
                type="time"
                required
              />
            </div>
          </div>

          <div v-if="form.date && form.time" class="bg-green-50 p-3 rounded-lg">
            <p class="text-sm font-medium text-green-800">
              <Calendar class="inline mr-1 h-4 w-4" />
              Nouveau rendez-vous: {{ formatNewDateTime() }}
            </p>
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
              :disabled="loading || !form.date || !form.time"
            >
              <AppSpinner v-if="loading" class="mr-2 h-4 w-4" />
              Reprogrammer
            </UiButton>
          </UiDialogFooter>
        </form>
      </div>
    </UiDialogContent>
  </UiDialog>
</template>

<script setup lang="ts">
import { Calendar } from 'lucide-vue-next'
import type { Appointment } from '~~/shared/types/appointment'

interface Props {
  open: boolean
  appointment: Appointment | null
  loading?: boolean
}

interface Emits {
  (e: 'update:open', value: boolean): void
  (e: 'submit', data: { appointmentId: number; newDate: string }): void
}

const props = withDefaults(defineProps<Props>(), {
  loading: false
})

const emit = defineEmits<Emits>()

const form = reactive({
  date: '',
  time: ''
})

const minDate = computed(() => {
  const today = new Date()
  return today.toISOString().split('T')[0]
})

const onSubmit = () => {
  if (!props.appointment || !form.date || !form.time) {
    return
  }

  const newDate = new Date(`${form.date}T${form.time}:00.000Z`)
  
  emit('submit', {
    appointmentId: props.appointment.id,
    newDate: newDate.toISOString()
  })
}

const formatDateTime = (dateString: string) => {
  return new Date(dateString).toLocaleString('fr-FR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const formatNewDateTime = () => {
  if (!form.date || !form.time) return ''
  
  const newDate = new Date(`${form.date}T${form.time}:00`)
  return newDate.toLocaleString('fr-FR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

watch(() => props.open, (newValue) => {
  if (!newValue) {
    form.date = ''
    form.time = ''
  } else if (props.appointment) {
    const currentDate = new Date(props.appointment.appointmentDate)
    form.date = currentDate.toISOString().split('T')[0]
    form.time = currentDate.toTimeString().slice(0, 5)
  }
})
</script>