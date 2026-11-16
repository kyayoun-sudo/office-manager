<script setup lang="ts">
import {
  User,
  UserCheck,
  Calendar,
  Clock,
  Tag,
  AlertTriangle,
  MessageSquare,
  Loader2,
} from 'lucide-vue-next'
import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'
import type { Ticket, TicketPriority } from '#shared/types/ticket'
import { TicketPriority as TP } from '#shared/types/ticket'
import type { AdminUser } from '~~~/shared/types/user'

const props = defineProps<{
  open: boolean
  ticket: Ticket | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'ticket-updated': []
}>()

const { toast } = useToast()
const ticketsApi = useTickets()
const { fetchUsers, adminUsers, users } = useUsers()

const isAssigning = ref(false)
const adminList = ref<{ value: string; label: string }[]>([])

watch(() => props.open, async (isOpen) => {
  if (isOpen && adminList.value.length === 0) {
    await fetchUsers({ role: 'admin', limit: 100 })
    adminList.value = adminUsers.value.map((u: AdminUser) => ({
      value: String(u.id),
      label: `${u.firstName} ${u.lastName}`,
    }))
  }
})

const currentAssigneeId = computed(() =>
  props.ticket?.assignedTo ? String(props.ticket.assignedTo.id) : 'unassigned',
)

const handleAssign = async (value: string) => {
  if (!props.ticket) return
  const assignedToId = value === 'unassigned' ? undefined : Number(value)

  if (assignedToId === props.ticket.assignedTo?.id) return

  isAssigning.value = true
  try {
    await ticketsApi.updateTicketStatus(props.ticket.id, {
      status: props.ticket.status,
      assignedToId,
    })
    const adminName = adminList.value.find(a => a.value === value)?.label
    toast({
      title: 'Ticket assigné',
      description: assignedToId
        ? `Ticket #${props.ticket.id} assigné à ${adminName}`
        : `Ticket #${props.ticket.id} désassigné`,
    })
    emit('ticket-updated')
  } catch {
    toast({
      title: 'Erreur',
      description: 'Impossible d\'assigner le ticket',
      variant: 'destructive',
    })
  } finally {
    isAssigning.value = false
  }
}

const formatDate = (dateString: string | null | undefined): string => {
  if (!dateString) return 'Non défini'
  try {
    const date = new Date(dateString)
    if (isNaN(date.getTime())) return 'Date invalide'
    return new Intl.DateTimeFormat('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
  } catch {
    return 'Date invalide'
  }
}

const relativeDate = (dateString: string): string => {
  try {
    return formatDistanceToNow(new Date(dateString), { addSuffix: true, locale: fr })
  } catch {
    return ''
  }
}

const priorityDotColor = (priority: TicketPriority): string => {
  if (priority === TP.URGENT) return 'bg-red-500'
  if (priority === TP.HIGH) return 'bg-amber-500'
  if (priority === TP.MEDIUM) return 'bg-blue-500'
  return 'bg-gray-400'
}
</script>

<template>
  <UiDialog :open="open" @update:open="$emit('update:open', $event)">
    <UiDialogContent
      :prevent-outside-click="true"
      class="max-w-[90vw] sm:max-w-[640px] max-h-[90vh] overflow-y-auto p-0"
    >
      <template v-if="ticket">
        <div class="border-b px-6 pt-6 pb-4">
          <div class="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <span class="size-2 rounded-full" :class="priorityDotColor(ticket.priority)" />
            <span class="tabular-nums font-medium">Ticket #{{ ticket.id }}</span>
            <span>&middot;</span>
            <span>{{ relativeDate(ticket.createdAt) }}</span>
          </div>
          <UiDialogTitle class="text-lg font-semibold leading-snug pr-8">
            {{ ticket.subject }}
          </UiDialogTitle>
          <UiDialogDescription class="sr-only">
            Détails du ticket de support #{{ ticket.id }}
          </UiDialogDescription>

          <div class="mt-3 flex flex-wrap gap-1.5">
            <UiBadge
              :variant="ticketsApi.getStatusVariant(ticket.status) as any"
              class="h-[22px] text-[11px] font-medium"
            >
              {{ ticketsApi.getStatusLabel(ticket.status) }}
            </UiBadge>
            <UiBadge
              :variant="ticketsApi.getPriorityVariant(ticket.priority) as any"
              class="h-[22px] text-[11px] font-medium"
            >
              <AlertTriangle v-if="ticket.priority === TP.URGENT || ticket.priority === TP.HIGH" class="size-3 mr-1" />
              {{ ticketsApi.getPriorityLabel(ticket.priority) }}
            </UiBadge>
            <UiBadge
              :variant="ticketsApi.getCategoryVariant(ticket.category) as any"
              class="h-[22px] text-[11px] font-medium"
            >
              <Tag class="size-3 mr-1" />
              {{ ticketsApi.getCategoryLabel(ticket.category) }}
            </UiBadge>
          </div>
        </div>

        <div class="px-6 py-4 space-y-5">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
              <div class="flex size-8 items-center justify-center rounded-full bg-primary/10 shrink-0">
                <User class="size-4 text-primary" />
              </div>
              <div class="min-w-0">
                <p class="text-[11px] font-medium text-muted-foreground">Utilisateur</p>
                <p class="text-sm font-medium truncate">
                  {{ ticket.user.firstName }} {{ ticket.user.lastName }}
                </p>
                <p class="text-xs text-muted-foreground truncate">{{ ticket.user.email }}</p>
                <p v-if="ticket.user.phone" class="text-xs text-muted-foreground">{{ ticket.user.phone }}</p>
              </div>
            </div>

            <div class="rounded-lg border bg-muted/30 p-3">
              <div class="flex items-start gap-3">
                <div class="flex size-8 items-center justify-center rounded-full bg-primary/10 shrink-0">
                  <UserCheck class="size-4 text-primary" />
                </div>
                <div class="min-w-0 flex-1">
                  <p class="text-[11px] font-medium text-muted-foreground">Assigné à</p>
                </div>
                <Loader2 v-if="isAssigning" class="size-4 animate-spin text-muted-foreground shrink-0" />
              </div>
              <div class="mt-2">
                <UiSelect
                  :model-value="currentAssigneeId"
                  :disabled="isAssigning"
                  @update:model-value="handleAssign"
                >
                  <UiSelectTrigger class="h-8 text-xs w-full">
                    <UiSelectValue placeholder="Sélectionner un admin..." />
                  </UiSelectTrigger>
                  <UiSelectContent>
                    <UiSelectItem value="unassigned">
                      <span class="italic text-muted-foreground">Non assigné</span>
                    </UiSelectItem>
                    <UiSelectSeparator />
                    <UiSelectItem
                      v-for="admin in adminList"
                      :key="admin.value"
                      :value="admin.value"
                    >
                      {{ admin.label }}
                    </UiSelectItem>
                  </UiSelectContent>
                </UiSelect>
              </div>
            </div>
          </div>

          <div class="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <div class="flex items-center gap-1.5">
              <Calendar class="size-3.5" />
              <span>Créé le {{ formatDate(ticket.createdAt) }}</span>
            </div>
            <div class="flex items-center gap-1.5">
              <Clock class="size-3.5" />
              <span>Mis à jour le {{ formatDate(ticket.updatedAt) }}</span>
            </div>
          </div>

          <div>
            <label class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Description
            </label>
            <div class="mt-1.5 rounded-lg border bg-muted/20 p-4">
              <p class="text-sm leading-relaxed whitespace-pre-wrap">{{ ticket.description }}</p>
            </div>
          </div>

          <div v-if="ticket.adminNote">
            <label class="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <MessageSquare class="size-3.5" />
              Note administrateur
            </label>
            <div class="mt-1.5 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/30">
              <p class="text-sm leading-relaxed whitespace-pre-wrap text-blue-900 dark:text-blue-200">
                {{ ticket.adminNote }}
              </p>
            </div>
          </div>
        </div>

        <div class="border-t px-6 py-4">
          <UiButton
            variant="outline"
            class="w-full sm:w-auto"
            @click="$emit('update:open', false)"
          >
            Fermer
          </UiButton>
        </div>
      </template>
    </UiDialogContent>
  </UiDialog>
</template>
