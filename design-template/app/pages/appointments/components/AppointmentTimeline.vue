<script setup lang="ts">
import type { Appointment } from '~~/shared/types/appointment'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale/fr'
import { CalendarDays, MapPin } from 'lucide-vue-next'

const props = defineProps<{
  appointments: Appointment[]
  selectedDate: Date
  isLoading: boolean
}>()

const emit = defineEmits<{
  (e: 'view-appointment', appointment: Appointment): void
}>()

const sortedAppointments = computed(() =>
  [...props.appointments].sort((a, b) => {
    const timeA = a.appointmentTime || a.appointmentDate
    const timeB = b.appointmentTime || b.appointmentDate
    return timeA.localeCompare(timeB)
  }),
)

const statusLabel: Record<string, string> = {
  pending: 'En attente',
  scheduled: 'Planifie',
  confirmed: 'Confirme',
  completed: 'Termine',
  cancelled: 'Annule',
  in_progress: 'En cours',
  no_show: 'Absent',
}

const statusDot: Record<string, string> = {
  pending: 'bg-amber-400',
  scheduled: 'bg-blue-400',
  confirmed: 'bg-emerald-500',
  completed: 'bg-muted-foreground/40',
  cancelled: 'bg-red-400',
  in_progress: 'bg-amber-500',
  no_show: 'bg-red-500',
}

function getTime(apt: Appointment): string {
  if (apt.appointmentTime) return apt.appointmentTime.slice(0, 5)
  try { return format(new Date(apt.appointmentDate), 'HH:mm') }
  catch { return '--:--' }
}

function getDuration(apt: Appointment): string {
  if (!apt.duration || apt.duration <= 0) return '-'
  const h = Math.floor(apt.duration / 60)
  const m = apt.duration % 60
  if (h > 0 && m > 0) return `${h}h${m}`
  if (h > 0) return `${h}h`
  return `${m}min`
}

function patientName(apt: Appointment): string {
  const u = apt.patient?.user
  if (u?.firstName && u?.lastName) return `${u.firstName} ${u.lastName}`
  const p = apt.patient as any
  if (p?.firstName && p?.lastName) return `${p.firstName} ${p.lastName}`
  return '-'
}

function midwifeName(apt: Appointment): string {
  const c = apt.clinician
  if (c?.firstName && c?.lastName) return `${c.firstName} ${c.lastName}`
  const cu = (apt as any).clinicianUser
  if (cu?.firstName && cu?.lastName) return `${cu.firstName} ${cu.lastName}`
  return '-'
}

function categoryName(apt: Appointment): string {
  if (apt.category?.name) return apt.category.name
  const translations = (apt.category as any)?.translations
  if (translations?.length) {
    const fr = translations.find((t: any) => t.language?.code === 'fr' || t.languageCode === 'fr')
    return fr?.name || translations[0]?.name || apt.category?.code || '-'
  }
  return apt.category?.code || '-'
}

const dateLabel = computed(() =>
  format(props.selectedDate, 'EEEE d MMMM yyyy', { locale: fr }),
)
</script>

<template>
  <div>
    <div class="mb-4 flex items-baseline justify-between">
      <h2 class="text-[15px] font-semibold capitalize">{{ dateLabel }}</h2>
      <span class="text-xs text-muted-foreground">{{ sortedAppointments.length }} rendez-vous</span>
    </div>

    <div v-if="isLoading" class="space-y-2">
      <UiSkeleton v-for="i in 5" :key="i" class="h-10 rounded-md" />
    </div>

    <div
      v-else-if="sortedAppointments.length === 0"
      class="flex flex-col items-center justify-center rounded-md border border-dashed py-14 text-center"
    >
      <CalendarDays class="h-5 w-5 text-muted-foreground/40" />
      <p class="mt-2 text-[13px] text-muted-foreground">Aucun rendez-vous</p>
    </div>

    <div v-else class="rounded-md border overflow-hidden">
      <div class="grid grid-cols-[56px_minmax(0,1fr)_minmax(0,1fr)_90px_60px_80px] gap-x-3 px-4 py-2 border-b bg-muted/50 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <span>Heure</span>
        <span>Patient</span>
        <span>Sage-femme</span>
        <span>Categorie</span>
        <span>Duree</span>
        <span class="text-right">Statut</span>
      </div>

      <div class="divide-y">
        <button
          v-for="apt in sortedAppointments" :key="apt.id"
          class="grid w-full grid-cols-[56px_minmax(0,1fr)_minmax(0,1fr)_90px_60px_80px] items-center gap-x-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50"
          @click="emit('view-appointment', apt)"
        >
          <span class="text-[13px] font-semibold tabular-nums">{{ getTime(apt) }}</span>

          <div class="min-w-0">
            <p class="text-[13px] truncate">{{ patientName(apt) }}</p>
          </div>

          <div class="min-w-0">
            <p class="text-[13px] text-muted-foreground truncate">{{ midwifeName(apt) }}</p>
          </div>

          <span class="text-[12px] text-muted-foreground truncate">{{ categoryName(apt) }}</span>

          <span class="text-[12px] text-muted-foreground tabular-nums">{{ getDuration(apt) }}</span>

          <div class="flex items-center justify-end gap-1.5">
            <span :class="statusDot[apt.status] || 'bg-muted-foreground/40'" class="h-1.5 w-1.5 shrink-0 rounded-full" />
            <span class="text-[11px] text-muted-foreground">{{ statusLabel[apt.status] || apt.status }}</span>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>
