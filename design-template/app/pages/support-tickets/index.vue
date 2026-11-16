<script setup lang="ts">
import type { Ticket } from '#shared/types/ticket'

definePageMeta({
  title: 'Support Tickets',
  description: 'Gérez les tickets de support client',
})
useHead({ title: 'Support Tickets - Modèle d’administration' })

const {
  isLoading,
  filters,
  columns,
  columnTickets,
  totalFiltered,
  fetchAllTickets,
  handleStatusChange,
} = useKanbanBoard()

const showViewDialog = ref(false)
const selectedTicket = ref<Ticket | null>(null)

const onTicketClick = (ticket: Ticket) => {
  selectedTicket.value = ticket
  showViewDialog.value = true
}

onMounted(() => fetchAllTickets())
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-3xl font-bold tracking-tight text-foreground">Support Tickets</h1>
      <p class="text-muted-foreground">Gérez les demandes de support client</p>
    </div>

    <ClientOnly>
      <KanbanBoard
        :columns="columns"
        :column-tickets="columnTickets"
        :is-loading="isLoading"
        :total-filtered="totalFiltered"
        :filters="filters"
        @update:filters="Object.assign(filters, $event)"
        @ticket-moved="handleStatusChange"
        @ticket-click="onTicketClick"
        @refresh="fetchAllTickets"
      />
      <template #fallback>
        <div class="flex gap-4">
          <div v-for="i in 4" :key="i" class="min-w-[280px] max-w-[320px] flex-1 space-y-2 rounded-lg border bg-muted/30 p-3">
            <UiSkeleton class="h-5 w-24" />
            <UiSkeleton v-for="j in 3" :key="j" class="h-28 w-full rounded-lg" />
          </div>
        </div>
      </template>
    </ClientOnly>

    <ViewSupportTicketDialog
      :open="showViewDialog"
      :ticket="selectedTicket"
      @update:open="showViewDialog = $event"
      @ticket-updated="fetchAllTickets"
    />
  </div>
</template>
