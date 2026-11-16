<script setup lang="ts">
import { TrendingUp, TrendingDown } from 'lucide-vue-next'

interface Props {
  title: string
  value: string | number
  description: string
  trend?: string
  trendDirection?: 'up' | 'down'
}

defineProps<Props>()
</script>

<template>
  <UiCard class="rounded-none border bg-gradient-to-t from-primary/5 to-card">
    <UiCardHeader class="relative p-3 pb-0">
      <UiCardDescription class="text-xs">{{ title }}</UiCardDescription>
      <UiCardTitle class="text-xl font-bold tabular-nums sm:text-2xl">
        {{ value }}
      </UiCardTitle>
      <UiBadge
        v-if="trend"
        variant="outline"
        class="absolute right-3 top-3 flex gap-1 rounded-none text-[10px] px-1.5 py-0"
      >
        <TrendingUp v-if="trendDirection === 'up'" class="size-2.5" />
        <TrendingDown v-if="trendDirection === 'down'" class="size-2.5" />
        {{ trend }}
      </UiBadge>
    </UiCardHeader>
    <UiCardFooter class="p-3 pt-1 text-xs">
      <div class="text-muted-foreground">
        {{ description }}
      </div>
    </UiCardFooter>
  </UiCard>
</template>
