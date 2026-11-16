<script setup lang="ts">
import type { DashboardStats } from '~~/shared/types/dashboard'

const props = defineProps<{
  stats: DashboardStats
}>()

const colors = ['#10b981', '#3b82f6', '#8b5cf6']

const chartData = computed(() => [
  { label: 'Patients', value: props.stats.totalPatients, color: colors[0] },
  { label: 'Cliniciens', value: props.stats.totalClinicians, color: colors[1] },
  { label: 'Autres', value: Math.max(0, props.stats.totalUsers - props.stats.totalPatients - props.stats.totalClinicians), color: colors[2] },
])

const total = computed(() => props.stats.totalUsers)

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
</script>

<template>
  <UiCard class="rounded-none h-full flex flex-col">
    <UiCardHeader class="p-3 pb-2 shrink-0">
      <UiCardTitle class="text-sm">Repartition des utilisateurs</UiCardTitle>
      <UiCardDescription class="text-xs">{{ total }} utilisateurs au total</UiCardDescription>
    </UiCardHeader>
    <UiCardContent class="p-3 pt-0 flex-1 flex flex-col min-h-0">
      <div class="flex gap-3 flex-1 min-h-0">
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
          <div class="grid grid-cols-3 gap-3 border-l border-b border-neutral-200 px-3 flex-1 min-h-0">
            <div v-for="item in chartData" :key="item.label" class="text-center">
              <div class="relative h-full flex items-end">
                <div
                  class="w-full rounded-t-lg transition-all duration-700 ease-out"
                  :style="{ ...barStyle(item.color), height: barHeight(item.value) }"
                />
              </div>
            </div>
          </div>

          <div class="grid grid-cols-3 gap-3 mt-2 px-3 shrink-0">
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
