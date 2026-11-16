<script setup lang="ts">
import type { Appointment } from '~~/shared/types/appointment'
import { isSameDay, startOfMonth, endOfMonth, format, isToday } from 'date-fns'
import { RotateCcw } from 'lucide-vue-next'

definePageMeta({})
useHead({ title: 'Rendez-vous - Modèle d’administration' })

const {
  appointments,
  filteredAppointments,
  isLoading,
  error,
  fetchAppointments,
  setFilters,
} = useAppointments()

const toast = useToast()

const selectedDate = ref(new Date())
const currentMonth = ref(startOfMonth(new Date()))
const statusFilter = ref('all')
const categoryFilter = ref('all')
const specialtyFilter = ref('all')
const viewDialogOpen = ref(false)
const selectedAppointment = ref<Appointment | null>(null)

const statusOptions = [
  { value: 'all', label: 'Tous les statuts' },
  { value: 'pending', label: 'En attente' },
  { value: 'scheduled', label: 'Planifie' },
  { value: 'confirmed', label: 'Confirme' },
  { value: 'completed', label: 'Termine' },
  { value: 'cancelled', label: 'Annule' },
  { value: 'in_progress', label: 'En cours' },
  { value: 'no_show', label: 'Absent' },
]

function getCategoryLabel(cat: any): string {
  if (cat?.name) return cat.name
  if (cat?.translations?.length) {
    const fr = cat.translations.find((t: any) => t.language?.code === 'fr' || t.languageCode === 'fr')
    return fr?.name || cat.translations[0]?.name || cat.code
  }
  return cat?.code || '-'
}

function getSpecialtyLabel(spec: any): string {
  if (!spec) return '-'
  if (spec.translations?.length) {
    const fr = spec.translations.find((t: any) => t.language?.code === 'fr' || t.languageCode === 'fr')
    if (fr?.name) return fr.name
    if (spec.translations[0]?.name) return spec.translations[0].name
  }
  return spec.name || spec.code || '-'
}

const availableCategories = computed(() => {
  const map = new Map<number, { id: number; label: string }>()
  appointments.value.forEach((apt) => {
    if (apt.category?.id) {
      map.set(apt.category.id, {
        id: apt.category.id,
        label: getCategoryLabel(apt.category),
      })
    }
  })
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label))
})

const categoryOptions = computed(() => [
  { value: 'all', label: 'Toutes les categories' },
  ...availableCategories.value.map((c) => ({ value: c.id.toString(), label: c.label })),
])

const availableSpecialties = computed(() => {
  const map = new Map<number, { id: number; label: string }>()
  appointments.value.forEach((apt) => {
    if (apt.specialty?.id) {
      map.set(apt.specialty.id, {
        id: apt.specialty.id,
        label: getSpecialtyLabel(apt.specialty),
      })
    }
  })
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label))
})

const specialtyOptions = computed(() => [
  { value: 'all', label: 'Toutes les specialites' },
  ...availableSpecialties.value.map((s) => ({ value: s.id.toString(), label: s.label })),
])

watch([statusFilter, categoryFilter, specialtyFilter], () => {
  setFilters({
    status: statusFilter.value !== 'all' ? [statusFilter.value] : undefined,
    categoryIds: categoryFilter.value !== 'all' ? [parseInt(categoryFilter.value)] : undefined,
    specialtyIds: specialtyFilter.value !== 'all' ? [parseInt(specialtyFilter.value)] : undefined,
  })
})

const appointmentsForSelectedDate = computed(() =>
  filteredAppointments.value.filter(
    (apt) => apt?.appointmentDate && isSameDay(new Date(apt.appointmentDate), selectedDate.value),
  ),
)

const todayCount = computed(() =>
  appointments.value.filter(
    (apt) => apt?.appointmentDate && isToday(new Date(apt.appointmentDate)),
  ).length,
)

const monthTotal = computed(() => appointments.value.length)

const pendingCount = computed(() =>
  appointments.value.filter((a) => a.status === 'pending').length,
)

async function fetchForMonth(month: Date) {
  currentMonth.value = month
  await fetchAppointments({
    startDate: format(startOfMonth(month), 'yyyy-MM-dd'),
    endDate: format(endOfMonth(month), 'yyyy-MM-dd'),
  })
}

function onSelectDate(date: Date) {
  selectedDate.value = date
}

function onMonthChange(month: Date) {
  fetchForMonth(month)
}

function onViewAppointment(apt: Appointment) {
  selectedAppointment.value = apt
  viewDialogOpen.value = true
}

async function refresh() {
  await fetchForMonth(currentMonth.value)
}

onMounted(() => fetchForMonth(currentMonth.value))

watch(error, (newError) => {
  if (newError) toast.handleApiError({ success: false, error: newError }, 'Erreur')
})
</script>

<template>
  <div class="space-y-5">
    <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">Rendez-vous</h1>
        <p class="text-[13px] text-muted-foreground mt-0.5">
          {{ todayCount }} aujourd'hui · {{ monthTotal }} ce mois · {{ pendingCount }} en attente
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <UiSelect v-model="statusFilter">
          <UiSelectTrigger class="w-[155px] h-8 text-[13px]">
            <UiSelectValue placeholder="Statut" />
          </UiSelectTrigger>
          <UiSelectContent>
            <UiSelectItem v-for="opt in statusOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </UiSelectItem>
          </UiSelectContent>
        </UiSelect>

        <UiSelect v-model="categoryFilter">
          <UiSelectTrigger class="w-[175px] h-8 text-[13px]">
            <UiSelectValue placeholder="Categorie" />
          </UiSelectTrigger>
          <UiSelectContent>
            <UiSelectItem v-for="opt in categoryOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </UiSelectItem>
          </UiSelectContent>
        </UiSelect>

        <UiSelect v-model="specialtyFilter">
          <UiSelectTrigger class="w-[185px] h-8 text-[13px]">
            <UiSelectValue placeholder="Specialite" />
          </UiSelectTrigger>
          <UiSelectContent>
            <UiSelectItem v-for="opt in specialtyOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </UiSelectItem>
          </UiSelectContent>
        </UiSelect>

        <UiButton variant="outline" size="sm" class="h-8" :disabled="isLoading" @click="refresh">
          <RotateCcw class="mr-1.5 h-3.5 w-3.5" :class="{ 'animate-spin': isLoading }" />
          Actualiser
        </UiButton>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(270px,340px)_1fr]">
      <div class="lg:sticky lg:top-4 lg:self-start">
        <AppointmentCalendar
          :appointments="filteredAppointments"
          :selected-date="selectedDate"
          :is-loading="isLoading"
          @select-date="onSelectDate"
          @month-change="onMonthChange"
        />
      </div>

      <AppointmentTimeline
        :appointments="appointmentsForSelectedDate"
        :selected-date="selectedDate"
        :is-loading="isLoading"
        @view-appointment="onViewAppointment"
      />
    </div>

    <ViewAppointmentDialog
      v-model:open="viewDialogOpen"
      :appointment="selectedAppointment"
    />
  </div>
</template>
