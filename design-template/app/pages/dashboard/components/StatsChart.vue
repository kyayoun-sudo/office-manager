<script setup lang="ts">
const { fetchAppointmentStats } = useDashboard()

const now = new Date()
const monthOptions = computed(() => {
  const options: { value: string; label: string; startDate: string; endDate: string }[] = []
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const year = d.getFullYear()
    const month = d.getMonth()
    const label = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`
    const lastDay = new Date(year, month + 1, 0).getDate()
    const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    options.push({ value: `${year}-${month}`, label, startDate, endDate })
  }
  return options
})

const selectedMonth = ref(monthOptions.value[0].value)
const isLoadingStats = ref(false)

const chartData = ref<{ label: string; value: number; color: string }[]>([])

const colors: Record<string, string> = {
  completed: '#10b981',
  scheduled: '#3b82f6',
  pending: '#f59e0b',
  cancelled: '#ef4444',
}

const statusLabels: Record<string, string> = {
  completed: 'Termines',
  scheduled: 'Planifies',
  pending: 'En attente',
  cancelled: 'Annules',
}

const loadStats = async () => {
  const month = monthOptions.value.find(m => m.value === selectedMonth.value)
  if (!month) return

  isLoadingStats.value = true
  const data = await fetchAppointmentStats(month.startDate, month.endDate)
  isLoadingStats.value = false

  if (data) {
    chartData.value = [
      { label: statusLabels.completed, value: data.completed, color: colors.completed },
      { label: statusLabels.scheduled, value: data.scheduled, color: colors.scheduled },
      { label: statusLabels.pending, value: data.pending, color: colors.pending },
      { label: statusLabels.cancelled, value: data.cancelled, color: colors.cancelled },
    ]
  } else {
    chartData.value = Object.entries(statusLabels).map(([key, label]) => ({
      label, value: 0, color: colors[key],
    }))
  }
}

const maxValue = computed(() => Math.max(...chartData.value.map(d => d.value), 1))

const yTicks = computed(() => {
  const max = maxValue.value
  const step = Math.ceil(max / 4) || 1
  return Array.from({ length: 5 }, (_, i) => i * step).reverse()
})

const barHeight = (value: number) =>
  `${Math.max((value / maxValue.value) * 100, 6)}%`

const barStyle = (color: string) => ({
  border: `1.5px solid ${color}`,
  backgroundImage: `repeating-linear-gradient(-45deg, transparent, transparent 4px, ${color}33 4px, ${color}33 5.5px)`,
  backgroundColor: `${color}0a`,
})

watch(selectedMonth, () => loadStats())
onMounted(() => loadStats())
</script>

<template>
  <UiCard class="rounded-none h-full flex flex-col">
    <UiCardHeader class="flex-row items-start justify-between space-y-0 p-3 pb-2 shrink-0">
      <div>
        <UiCardTitle class="text-sm">Rendez-vous</UiCardTitle>
        <UiCardDescription class="text-xs">Par statut pour le mois selectionne</UiCardDescription>
      </div>
      <select
        v-model="selectedMonth"
        class="h-8 rounded-md border border-input bg-background px-2 text-xs capitalize"
      >
        <option v-for="opt in monthOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
    </UiCardHeader>
    <UiCardContent class="p-3 pt-0 flex-1 flex flex-col min-h-0">
      <div v-if="isLoadingStats" class="flex items-end gap-4 flex-1 min-h-0 pl-10">
        <div
          v-for="(color, idx) in ['#10b981', '#3b82f6', '#f59e0b', '#ef4444']"
:key="idx"
          class="flex-1 animate-pulse rounded-t-lg"
          :style="{ ...barStyle(color), height: `${30 + idx * 15}%` }"
        />
      </div>

      <div v-else class="flex gap-3 flex-1 min-h-0">
        <div class="flex flex-col justify-between text-right pr-1 shrink-0">
          <span
            v-for="tick in yTicks"
:key="tick"
            class="text-[10px] text-muted-foreground tabular-nums leading-none"
          >
            {{ tick }}
          </span>
        </div>

        <div class="flex-1 flex flex-col min-h-0">
          <div
            class="grid border-l border-b border-neutral-200 px-3 flex-1 min-h-0"
            :style="{ gridTemplateColumns: `repeat(${chartData.length}, 1fr)`, gap: '12px' }"
          >
            <div v-for="item in chartData" :key="item.label" class="text-center">
              <div class="relative h-full flex items-end">
                <div
                  class="w-full rounded-t-lg transition-all duration-700 ease-out"
                  :style="{ ...barStyle(item.color), height: barHeight(item.value) }"
                />
              </div>
            </div>
          </div>

          <div
            class="grid mt-2 px-3 shrink-0"
            :style="{ gridTemplateColumns: `repeat(${chartData.length}, 1fr)`, gap: '12px' }"
          >
            <div v-for="item in chartData" :key="item.label" class="text-center">
              <p class="text-[10px] text-muted-foreground truncate">{{ item.label }}</p>
              <p class="text-xs font-semibold tabular-nums mt-0.5" :style="{ color: item.color }">
                {{ item.value }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </UiCardContent>
  </UiCard>
</template>
