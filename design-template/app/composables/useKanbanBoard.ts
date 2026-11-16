import type { Ticket, TicketQueryParams, TicketStatus, TicketPriority, TicketCategory } from '#shared/types/ticket'

export interface KanbanColumn {
  status: TicketStatus
  label: string
  dotColor: string
  bgColor: string
  headerBg: string
}

export interface KanbanFilters {
  priority: TicketPriority | 'all'
  category: TicketCategory | 'all'
}

export const useKanbanBoard = () => {
  const { toast } = useToast()
  const ticketsApi = useTickets()

  const allTickets = shallowRef<Ticket[]>([])
  const isLoading = ref(false)
  const filters = ref<KanbanFilters>({ priority: 'all', category: 'all' })

  const columns: KanbanColumn[] = [
    {
      status: 'open' as TicketStatus,
      label: 'Ouvert',
      dotColor: 'bg-blue-500',
      bgColor: 'bg-blue-50 dark:bg-blue-950/20',
      headerBg: 'bg-blue-100/60 dark:bg-blue-900/30',
    },
    {
      status: 'in_progress' as TicketStatus,
      label: 'En cours',
      dotColor: 'bg-amber-500',
      bgColor: 'bg-amber-50 dark:bg-amber-950/20',
      headerBg: 'bg-amber-100/60 dark:bg-amber-900/30',
    },
    {
      status: 'resolved' as TicketStatus,
      label: 'Résolu',
      dotColor: 'bg-emerald-500',
      bgColor: 'bg-emerald-50 dark:bg-emerald-950/20',
      headerBg: 'bg-emerald-100/60 dark:bg-emerald-900/30',
    },
    {
      status: 'closed' as TicketStatus,
      label: 'Fermé',
      dotColor: 'bg-gray-400',
      bgColor: 'bg-gray-50 dark:bg-gray-950/20',
      headerBg: 'bg-gray-100/60 dark:bg-gray-900/30',
    },
  ]

  const filteredTickets = computed(() => {
    let result = allTickets.value
    if (filters.value.priority !== 'all') {
      result = result.filter(t => t.priority === filters.value.priority)
    }
    if (filters.value.category !== 'all') {
      result = result.filter(t => t.category === filters.value.category)
    }
    return result
  })

  const columnTickets = computed(() => {
    const map = new Map<TicketStatus, Ticket[]>()
    for (const col of columns) {
      map.set(col.status, [])
    }
    for (const ticket of filteredTickets.value) {
      const list = map.get(ticket.status)
      if (list) {
        list.push(ticket)
      }
    }
    return map
  })

  const totalFiltered = computed(() => filteredTickets.value.length)

  const fetchAllTickets = async () => {
    isLoading.value = true
    try {
      const allLoaded: Ticket[] = []
      let page = 1
      const limit = 100
      let hasMore = true

      while (hasMore) {
        const params: TicketQueryParams = { page, limit }
        const response = await ticketsApi.fetchTickets(params)
        const data = response.data || []
        allLoaded.push(...data)

        hasMore = response.pagination?.hasNextPage ?? false
        page++
      }

      allTickets.value = allLoaded
    } catch (err: any) {
      toast({
        title: 'Erreur',
        description: err.message || 'Erreur lors du chargement des tickets',
        variant: 'destructive',
      })
    } finally {
      isLoading.value = false
    }
  }

  const handleStatusChange = async (ticketId: number, newStatus: TicketStatus) => {
    const prev = allTickets.value
    const ticketIndex = prev.findIndex(t => t.id === ticketId)
    if (ticketIndex === -1) return

    const updated = [...prev]
    updated[ticketIndex] = { ...updated[ticketIndex], status: newStatus }
    allTickets.value = updated

    try {
      await ticketsApi.updateTicketStatus(ticketId, { status: newStatus })
      toast({
        title: 'Statut mis à jour',
        description: `Ticket #${ticketId} déplacé vers "${columns.find(c => c.status === newStatus)?.label}"`,
      })
    } catch {
      allTickets.value = prev
      toast({
        title: 'Erreur',
        description: 'Impossible de mettre à jour le statut. Le ticket a été remis en place.',
        variant: 'destructive',
      })
    }
  }

  return {
    allTickets: readonly(allTickets),
    isLoading: readonly(isLoading),
    filters,
    columns,
    columnTickets,
    totalFiltered,
    fetchAllTickets,
    handleStatusChange,
  }
}
