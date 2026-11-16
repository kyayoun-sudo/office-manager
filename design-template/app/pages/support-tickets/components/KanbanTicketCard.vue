<script setup lang="ts">
import { User, UserCheck, Clock } from 'lucide-vue-next'
import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'
import type { Ticket, TicketPriority } from '#shared/types/ticket'
import { TicketPriority as TP } from '#shared/types/ticket'

defineProps<{
  ticket: Ticket
}>()

defineEmits<{
  click: [ticket: Ticket]
}>()

const ticketsApi = useTickets()

const priorityAccent = (priority: TicketPriority): string => {
  if (priority === TP.URGENT) return 'border-l-red-500 bg-red-50/40 dark:bg-red-950/10'
  if (priority === TP.HIGH) return 'border-l-amber-500 bg-amber-50/40 dark:bg-amber-950/10'
  return 'border-l-transparent'
}

const relativeDate = (dateString: string): string => {
  try {
    return formatDistanceToNow(new Date(dateString), { addSuffix: true, locale: fr })
  } catch {
    return ''
  }
}
</script>

<template>
  <div
    :data-ticket-id="ticket.id"
    class="group cursor-grab rounded-lg border border-border/60 bg-card p-3 shadow-sm transition-all duration-150 hover:shadow-md hover:border-border active:cursor-grabbing active:shadow-lg active:scale-[0.98] border-l-[3px]"
    :class="priorityAccent(ticket.priority)"
    @click="$emit('click', ticket)"
  >
    <div class="flex items-start justify-between gap-2">
      <p class="line-clamp-2 text-[13px] font-medium leading-snug text-foreground">
        {{ ticket.subject }}
      </p>
      <span class="shrink-0 text-[10px] tabular-nums text-muted-foreground/60">
        #{{ ticket.id }}
      </span>
    </div>

    <div class="mt-2 flex flex-wrap gap-1">
      <UiBadge
        :variant="ticketsApi.getPriorityVariant(ticket.priority) as any"
        class="h-[18px] text-[10px] px-1.5 font-normal"
      >
        {{ ticketsApi.getPriorityLabel(ticket.priority) }}
      </UiBadge>
      <UiBadge
        :variant="ticketsApi.getCategoryVariant(ticket.category) as any"
        class="h-[18px] text-[10px] px-1.5 font-normal"
      >
        {{ ticketsApi.getCategoryLabel(ticket.category) }}
      </UiBadge>
    </div>

    <div class="mt-2.5 border-t border-dashed border-border/50 pt-2 space-y-1.5">
      <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
        <User class="size-3 shrink-0" />
        <span class="truncate">{{ ticket.user.firstName }} {{ ticket.user.lastName }}</span>
      </div>
      <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
        <UserCheck class="size-3 shrink-0" />
        <span v-if="ticket.assignedTo" class="truncate">
          {{ ticket.assignedTo.firstName }} {{ ticket.assignedTo.lastName }}
        </span>
        <span v-else class="italic text-muted-foreground/60">Non assigné</span>
      </div>
      <div class="flex items-center gap-1.5 text-[11px] text-muted-foreground/60">
        <Clock class="size-2.5 shrink-0" />
        <span>{{ relativeDate(ticket.createdAt) }}</span>
      </div>
    </div>
  </div>
</template>
