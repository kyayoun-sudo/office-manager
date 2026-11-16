<script setup lang="ts">
import { RotateCcw, Filter, Ticket as TicketIcon } from 'lucide-vue-next'
import type { Ticket, TicketStatus, TicketPriority, TicketCategory } from '#shared/types/ticket'
import { TicketPriority as TP, TicketCategory as TC } from '#shared/types/ticket'
import type { KanbanColumn } from '~/composables/useKanbanBoard'

const props = defineProps<{
  columns: KanbanColumn[]
  columnTickets: Map<TicketStatus, Ticket[]>
  isLoading: boolean
  totalFiltered: number
  filters: { priority: TicketPriority | 'all'; category: TicketCategory | 'all' }
}>()

const emit = defineEmits<{
  'ticket-moved': [ticketId: number, newStatus: TicketStatus]
  'ticket-click': [ticket: Ticket]
  'update:filters': [filters: { priority: TicketPriority | 'all'; category: TicketCategory | 'all' }]
  refresh: []
}>()

const priorityOptions = [
  { value: 'all', label: 'Toutes les priorités' },
  { value: TP.URGENT, label: 'Urgente' },
  { value: TP.HIGH, label: 'Haute' },
  { value: TP.MEDIUM, label: 'Moyenne' },
  { value: TP.LOW, label: 'Basse' },
]

const categoryOptions = [
  { value: 'all', label: 'Toutes les catégories' },
  { value: TC.TECHNICAL, label: 'Technique' },
  { value: TC.BILLING, label: 'Facturation' },
  { value: TC.ACCOUNT, label: 'Compte' },
  { value: TC.APPOINTMENT, label: 'Rendez-vous' },
  { value: TC.OTHER, label: 'Autre' },
]

const hasActiveFilter = computed(
  () => props.filters.priority !== 'all' || props.filters.category !== 'all',
)

const updatePriority = (value: string) => {
  emit('update:filters', { ...props.filters, priority: value as TicketPriority | 'all' })
}

const updateCategory = (value: string) => {
  emit('update:filters', { ...props.filters, category: value as TicketCategory | 'all' })
}

const skeletonCounts = [3, 2, 1, 2]
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center gap-3 rounded-lg border bg-card/50 px-4 py-3">
      <Filter class="size-4 text-muted-foreground" />

      <UiSelect :model-value="filters.priority" @update:model-value="updatePriority">
        <UiSelectTrigger class="h-8 w-[180px] text-xs">
          <UiSelectValue placeholder="Toutes les priorités" />
        </UiSelectTrigger>
        <UiSelectContent>
          <UiSelectItem v-for="opt in priorityOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </UiSelectItem>
        </UiSelectContent>
      </UiSelect>

      <UiSelect :model-value="filters.category" @update:model-value="updateCategory">
        <UiSelectTrigger class="h-8 w-[180px] text-xs">
          <UiSelectValue placeholder="Toutes les catégories" />
        </UiSelectTrigger>
        <UiSelectContent>
          <UiSelectItem v-for="opt in categoryOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </UiSelectItem>
        </UiSelectContent>
      </UiSelect>

      <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
        <TicketIcon class="size-3.5" />
        <span class="tabular-nums font-medium">{{ totalFiltered }}</span>
        <span>ticket{{ totalFiltered > 1 ? 's' : '' }}</span>
        <span v-if="hasActiveFilter" class="text-primary">(filtré)</span>
      </div>

      <UiButton
        variant="outline"
        size="sm"
        class="ml-auto h-8 text-xs"
        :disabled="isLoading"
        @click="emit('refresh')"
      >
        <RotateCcw class="mr-1.5 size-3.5" :class="{ 'animate-spin': isLoading }" />
        Actualiser
      </UiButton>
    </div>

    <div
      v-if="isLoading"
      class="flex gap-4 overflow-x-auto pb-2"
      style="min-height: calc(100vh - 280px)"
    >
      <div
        v-for="(col, idx) in columns"
        :key="col.status"
        class="flex min-w-[280px] max-w-[320px] flex-1 flex-col rounded-xl border border-border/50 overflow-hidden"
        :class="col.bgColor"
      >
        <div class="px-3 py-2.5 border-b border-border/40" :class="col.headerBg">
          <div class="flex items-center gap-2">
            <UiSkeleton class="size-2.5 rounded-full" />
            <UiSkeleton class="h-4 w-16" />
            <UiSkeleton class="ml-auto h-5 w-5 rounded-full" />
          </div>
        </div>
        <div class="space-y-2 p-2">
          <UiSkeleton
            v-for="i in skeletonCounts[idx]"
            :key="i"
            class="h-[130px] w-full rounded-lg"
          />
        </div>
      </div>
    </div>

    <div
      v-else
      class="flex gap-4 overflow-x-auto pb-2"
      style="min-height: calc(100vh - 280px)"
    >
      <KanbanColumn
        v-for="col in columns"
        :key="col.status"
        :column="col"
        :tickets="columnTickets.get(col.status) ?? []"
        @ticket-moved="(id, status) => emit('ticket-moved', id, status)"
        @ticket-click="(ticket) => emit('ticket-click', ticket)"
      />
    </div>
  </div>
</template>
