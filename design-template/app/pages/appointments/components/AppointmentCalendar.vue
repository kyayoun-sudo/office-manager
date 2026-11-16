<script setup lang="ts">
import type { Appointment } from '~~/shared/types/appointment'
import {
  format,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
  isToday,
} from 'date-fns'
import { fr } from 'date-fns/locale/fr'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'

const props = defineProps<{
  appointments: Appointment[]
  selectedDate: Date
  isLoading: boolean
}>()

const emit = defineEmits<{
  (e: 'select-date', date: Date): void
  (e: 'month-change', month: Date): void
}>()

const currentMonth = ref(startOfMonth(props.selectedDate))

const weekDays = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di']

const calendarDays = computed(() => {
  const monthStart = startOfMonth(currentMonth.value)
  const monthEnd = endOfMonth(currentMonth.value)
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })
  return eachDayOfInterval({ start: calStart, end: calEnd })
})

const appointmentsByDate = computed(() => {
  const map = new Map<string, Appointment[]>()
  for (const apt of props.appointments) {
    if (!apt.appointmentDate) continue
    const key = format(new Date(apt.appointmentDate), 'yyyy-MM-dd')
    const list = map.get(key) || []
    list.push(apt)
    map.set(key, list)
  }
  return map
})

const monthStats = computed(() => {
  const monthStart = startOfMonth(currentMonth.value)
  const monthEnd = endOfMonth(currentMonth.value)
  const monthAppointments = props.appointments.filter((apt) => {
    if (!apt.appointmentDate) return false
    const d = new Date(apt.appointmentDate)
    return d >= monthStart && d <= monthEnd
  })

  const byStatus: Record<string, number> = {}
  for (const apt of monthAppointments) {
    byStatus[apt.status] = (byStatus[apt.status] || 0) + 1
  }

  return { total: monthAppointments.length, byStatus }
})

const statusDotColor: Record<string, string> = {
  pending: 'bg-amber-400',
  scheduled: 'bg-blue-400',
  confirmed: 'bg-green-500',
  completed: 'bg-gray-400',
  cancelled: 'bg-red-400',
  in_progress: 'bg-amber-500',
  no_show: 'bg-red-500',
}

const statusLabel: Record<string, string> = {
  pending: 'En attente',
  scheduled: 'Planifié',
  confirmed: 'Confirmé',
  completed: 'Terminé',
  cancelled: 'Annulé',
  in_progress: 'En cours',
  no_show: 'Absent',
}

function getDotsForDay(day: Date) {
  const key = format(day, 'yyyy-MM-dd')
  const apts = appointmentsByDate.value.get(key) || []
  const uniqueStatuses = [...new Set(apts.map((a) => a.status))]
  return uniqueStatuses.slice(0, 3).map((s) => statusDotColor[s] || 'bg-gray-400')
}

function prevMonth() {
  currentMonth.value = subMonths(currentMonth.value, 1)
  emit('month-change', currentMonth.value)
}

function nextMonth() {
  currentMonth.value = addMonths(currentMonth.value, 1)
  emit('month-change', currentMonth.value)
}

function goToToday() {
  const today = new Date()
  const todayMonth = startOfMonth(today)
  const changed = !isSameMonth(todayMonth, currentMonth.value)
  currentMonth.value = todayMonth
  emit('select-date', today)
  if (changed) emit('month-change', currentMonth.value)
}

watch(
  () => props.selectedDate,
  (newDate) => {
    if (!isSameMonth(newDate, currentMonth.value)) {
      currentMonth.value = startOfMonth(newDate)
    }
  },
)
</script>

<template>
  <UiCard class="p-4">
    <div class="flex items-center justify-between mb-4">
      <UiButton variant="ghost" size="icon" @click="prevMonth">
        <ChevronLeft class="h-4 w-4" />
      </UiButton>
      <button
        class="text-sm font-semibold capitalize hover:text-primary transition-colors"
        @click="goToToday"
      >
        {{ format(currentMonth, 'MMMM yyyy', { locale: fr }) }}
      </button>
      <UiButton variant="ghost" size="icon" @click="nextMonth">
        <ChevronRight class="h-4 w-4" />
      </UiButton>
    </div>

    <div class="grid grid-cols-7 gap-1 mb-1">
      <div
        v-for="day in weekDays"
        :key="day"
        class="text-center text-xs font-medium text-muted-foreground py-1"
      >
        {{ day }}
      </div>
    </div>

    <div class="grid grid-cols-7 gap-1">
      <button
        v-for="day in calendarDays"
        :key="day.toISOString()"
        class="relative flex flex-col items-center justify-center rounded-md p-1 h-10 text-sm transition-colors"
        :class="[
          !isSameMonth(day, currentMonth)
            ? 'text-muted-foreground/40'
            : 'text-foreground',
          isSameDay(day, selectedDate)
            ? 'bg-primary text-primary-foreground font-semibold'
            : isToday(day)
              ? 'ring-1 ring-primary/30 font-medium'
              : 'hover:bg-muted',
        ]"
        @click="emit('select-date', day)"
      >
        <span class="leading-none">{{ format(day, 'd') }}</span>
        <div class="flex gap-0.5 mt-0.5 h-1.5">
          <span
            v-for="(color, i) in getDotsForDay(day)"
            :key="i"
            class="h-1.5 w-1.5 rounded-full"
            :class="[
              isSameDay(day, selectedDate)
                ? 'bg-primary-foreground/80'
                : color,
            ]"
          />
        </div>
      </button>
    </div>

    <p v-if="!isLoading" class="mt-3 pt-3 border-t text-xs text-muted-foreground">
      {{ monthStats.total }} rendez-vous ce mois
    </p>
  </UiCard>
</template>
