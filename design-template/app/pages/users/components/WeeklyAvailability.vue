<script setup lang="ts">
import { Loader2, Building2 } from 'lucide-vue-next'

interface TimeSlot {
  startTime: string
  endTime: string
}

interface DaySlots {
  date: string
  slots: TimeSlot[]
}

interface Office {
  id: number
  name: string
  color?: string
}

interface Props {
  clinicianId: number
  offices: Office[]
}

const props = defineProps<Props>()

const slotsByOffice = ref<Record<number, DaySlots[]>>({})
const isLoading = ref(false)

const dayLabels = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

const getMonday = (d: Date) => {
  const date = new Date(d)
  const day = date.getDay()
  const diff = date.getDate() - day + (day === 0 ? -6 : 1)
  date.setDate(diff)
  date.setHours(0, 0, 0, 0)
  return date
}

const formatDateISO = (d: Date) => {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const monday = computed(() => getMonday(new Date()))

const weekDays = computed(() => {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday.value)
    d.setDate(monday.value.getDate() + i)
    return {
      date: formatDateISO(d),
      dayNumber: d.getDate(),
      isToday: formatDateISO(d) === formatDateISO(new Date()),
    }
  })
})

const weekLabel = computed(() => {
  const sun = new Date(monday.value)
  sun.setDate(monday.value.getDate() + 6)
  const fmt = (d: Date) => `${d.getDate()} ${d.toLocaleDateString('fr-FR', { month: 'short' })}`
  return `${fmt(monday.value)} — ${fmt(sun)}`
})

const getSlotsByDate = (officeId: number) => {
  const map: Record<string, TimeSlot[]> = {}
  for (const ds of (slotsByOffice.value[officeId] || [])) {
    map[ds.date] = ds.slots
  }
  return map
}

const getTotalSlots = (officeId: number) => {
  return Object.values(getSlotsByDate(officeId)).reduce((sum, slots) => sum + slots.length, 0)
}

const loadAvailability = async () => {
  if (!props.offices.length) return
  isLoading.value = true
  try {
    const sun = new Date(monday.value)
    sun.setDate(monday.value.getDate() + 6)
    const startDate = formatDateISO(monday.value)
    const endDate = formatDateISO(sun)

    const results = await Promise.allSettled(
      props.offices.map(async (office) => {
        const response = await api.get<any>(
          `/available-slots?clinicianId=${props.clinicianId}&officeId=${office.id}&startDate=${startDate}&endDate=${endDate}`,
        )
        let slots: DaySlots[] = []
        if (response?.success && response.data?.availableSlots) {
          slots = response.data.availableSlots
        } else if (response?.success && Array.isArray(response.data)) {
          slots = response.data
        }
        return { officeId: office.id, slots }
      }),
    )

    const map: Record<number, DaySlots[]> = {}
    for (const result of results) {
      if (result.status === 'fulfilled') {
        map[result.value.officeId] = result.value.slots
      }
    }
    slotsByOffice.value = map
  } catch {
    slotsByOffice.value = {}
  } finally {
    isLoading.value = false
  }
}

onMounted(() => {
  loadAvailability()
})
</script>

<template>
  <div>
    <div class="mb-4 flex items-baseline justify-between">
      <h3 class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Disponibilites
      </h3>
      <span class="text-[12px] tabular-nums text-muted-foreground">{{ weekLabel }}</span>
    </div>

    <div v-if="isLoading" class="flex items-center justify-center py-8">
      <Loader2 class="h-4 w-4 animate-spin text-muted-foreground" />
    </div>

    <div v-else-if="!offices.length" class="py-6 text-center text-[13px] text-muted-foreground">
      Aucun cabinet configure
    </div>

    <div v-else class="space-y-6">
      <div v-for="office in offices" :key="office.id">
        <div class="mb-2.5 flex items-center gap-2">
          <span
            class="block h-2.5 w-2.5 rounded-full"
            :style="{ backgroundColor: office.color || '#4CAF50' }"
          />
          <span class="text-[13px] font-medium text-foreground">{{ office.name }}</span>
          <span class="text-[11px] text-muted-foreground">
            {{ getTotalSlots(office.id) }} creneau{{ getTotalSlots(office.id) !== 1 ? 'x' : '' }}
          </span>
        </div>

        <div class="overflow-hidden rounded-md border">
          <table class="w-full table-fixed border-collapse">
            <thead>
              <tr class="border-b bg-muted/50">
                <th
                  v-for="(label, i) in dayLabels"
                  :key="label"
                  :class="[
                    'px-1 py-1.5 text-center text-[11px] font-medium',
                    weekDays[i].isToday ? 'text-foreground' : 'text-muted-foreground',
                    i > 0 ? 'border-l border-border/50' : '',
                  ]"
                >
                  <span>{{ label }}</span>
                  <span
                    :class="[
                      'ml-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full text-[10px] font-semibold tabular-nums',
                      weekDays[i].isToday
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground',
                    ]"
                  >
                    {{ weekDays[i].dayNumber }}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td
                  v-for="(day, i) in weekDays"
                  :key="day.date"
                  :class="[
                    'align-top p-1',
                    i > 0 ? 'border-l border-border/50' : '',
                    day.isToday ? 'bg-muted/30' : '',
                  ]"
                >
                  <template v-if="getSlotsByDate(office.id)[day.date]?.length">
                    <div
                      v-for="(slot, idx) in getSlotsByDate(office.id)[day.date]"
                      :key="idx"
                      class="mb-0.5 rounded border border-border bg-background px-1 py-[3px] text-center text-[10px] tabular-nums leading-tight text-muted-foreground"
                    >
                      {{ slot.startTime }}&ndash;{{ slot.endTime }}
                    </div>
                  </template>
                  <div v-else class="py-2 text-center text-[10px] text-muted-foreground/40">&mdash;</div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
