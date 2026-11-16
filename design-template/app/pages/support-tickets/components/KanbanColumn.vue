<script setup lang="ts">
import { VueDraggable } from 'vue-draggable-plus'
import { Inbox } from 'lucide-vue-next'
import type { Ticket, TicketStatus } from '#shared/types/ticket'
import type { KanbanColumn } from '~/composables/useKanbanBoard'

const props = defineProps<{
  column: KanbanColumn
  tickets: Ticket[]
}>()

const emit = defineEmits<{
  'ticket-moved': [ticketId: number, newStatus: TicketStatus]
  'ticket-click': [ticket: Ticket]
}>()

const localTickets = ref<Ticket[]>([])

watchEffect(() => {
  localTickets.value = [...props.tickets]
})

const handleAdd = (evt: { item?: HTMLElement; newIndex?: number }) => {
  const ticketId = Number(evt.item?.dataset?.ticketId)
  if (ticketId) {
    emit('ticket-moved', ticketId, props.column.status)
  }
}
</script>

<template>
  <div class="flex min-w-[280px] max-w-[320px] flex-1 flex-col rounded-xl border border-border/50 overflow-hidden" :class="column.bgColor">
    <div class="px-3 py-2.5 border-b border-border/40" :class="column.headerBg">
      <div class="flex items-center gap-2">
        <span class="size-2.5 rounded-full shrink-0" :class="column.dotColor" />
        <h3 class="text-sm font-semibold text-foreground">{{ column.label }}</h3>
        <span class="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-background/80 px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground shadow-sm">
          {{ tickets.length }}
        </span>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto p-2" style="max-height: calc(100vh - 300px)">
      <VueDraggable
        v-model="localTickets"
        group="kanban-tickets"
        :animation="200"
        ghost-class="opacity-30"
        drag-class="rotate-2"
        class="flex flex-col gap-2 min-h-[120px]"
        @add="handleAdd"
      >
        <KanbanTicketCard
          v-for="ticket in localTickets"
          :key="ticket.id"
          :ticket="ticket"
          @click="emit('ticket-click', ticket)"
        />
      </VueDraggable>

      <div
        v-if="tickets.length === 0"
        class="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border/40 py-8 text-muted-foreground/50"
      >
        <Inbox class="size-6" />
        <p class="text-xs">Aucun ticket</p>
      </div>
    </div>
  </div>
</template>
