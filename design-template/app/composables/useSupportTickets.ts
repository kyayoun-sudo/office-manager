import type { 
  SupportTicket, 
  TicketFilters, 
  SupportTicketsResponse, 
  UpdateTicketRequest, 
  RespondToTicketRequest,
  CloseTicketRequest
} from '~~~/shared/types/support-ticket'
import { api } from '~/utils/api'

export const useSupportTickets = () => {
  const tickets = ref<SupportTicket[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const total = ref(0)
  const currentPage = ref(1)
  const itemsPerPage = ref(20)

  const getTickets = async (filters?: TicketFilters): Promise<SupportTicketsResponse> => {
    isLoading.value = true
    error.value = null
    
    const params: Record<string, any> = {}
    
    if (filters?.page) params.page = filters.page
    if (filters?.limit) params.limit = filters.limit
    if (filters?.status) params.status = filters.status
    if (filters?.priority) params.priority = filters.priority
    if (filters?.category) params.category = filters.category
    if (filters?.search) params.search = filters.search
    if (filters?.assignedTo) params.assignedTo = filters.assignedTo

    const response = await api.get<SupportTicketsResponse>('/support-tickets')
    
    if (response.success) {
      tickets.value = response.data.data || response.data
      total.value = response.data.total || (response.data.data || response.data).length
    } else {
      error.value = response.error?.message || 'Erreur lors du chargement des tickets'
      console.error('Erreur getTickets:', response.error)
    }
    
    isLoading.value = false
    return response
  }

  const getTicket = async (id: number): Promise<SupportTicket | null> => {
    const response = await api.get<SupportTicket>(`/admin/support-tickets/${id}`)
    
    if (response.success) {
      return response.data
    } else {
      error.value = response.error?.message || 'Erreur lors du chargement du ticket'
      return null
    }
  }

  const updateTicket = async (id: number, data: UpdateTicketRequest): Promise<SupportTicket | null> => {
    const response = await api.put<SupportTicket>(`/admin/support-tickets/${id}`, data)
    
    if (response.success) {
      // Mettre à jour le ticket local
      const ticketIndex = tickets.value.findIndex(t => t.id === id)
      if (ticketIndex !== -1) {
        tickets.value[ticketIndex] = { ...tickets.value[ticketIndex], ...response.data }
      }
      return response.data
    } else {
      error.value = response.error?.message || 'Erreur lors de la mise à jour du ticket'
      return null
    }
  }

  const respondToTicket = async (id: number, data: RespondToTicketRequest): Promise<SupportTicket | null> => {
    const response = await api.post<SupportTicket>(`/admin/support-tickets/${id}/respond`, data)
    
    if (response.success) {
      // Mettre à jour le ticket local
      const ticketIndex = tickets.value.findIndex(t => t.id === id)
      if (ticketIndex !== -1) {
        tickets.value[ticketIndex] = { ...tickets.value[ticketIndex], ...response.data }
        if (data.closeTicket) {
          tickets.value[ticketIndex].status = 'closed'
          tickets.value[ticketIndex].closedAt = new Date().toISOString()
        }
      }
      return response.data
    } else {
      error.value = response.error?.message || 'Erreur lors de la réponse au ticket'
      return null
    }
  }

  const closeTicket = async (id: number, data: CloseTicketRequest): Promise<SupportTicket | null> => {
    const response = await api.post<SupportTicket>(`/admin/support-tickets/${id}/close`, data)
    
    if (response.success) {
      // Mettre à jour le ticket local
      const ticketIndex = tickets.value.findIndex(t => t.id === id)
      if (ticketIndex !== -1) {
        tickets.value[ticketIndex] = { ...tickets.value[ticketIndex], ...response.data }
        tickets.value[ticketIndex].status = 'closed'
        tickets.value[ticketIndex].closedAt = new Date().toISOString()
      }
      return response.data
    } else {
      error.value = response.error?.message || 'Erreur lors de la fermeture du ticket'
      return null
    }
  }

  // Helpers pour les libellés
  const getCategoryLabel = (category: string) => {
    const labels: Record<string, string> = {
      'account_issue': 'Problème de compte',
      'payment_problem': 'Problème de paiement',
      'technical_bug': 'Bug technique',
      'feature_request': 'Demande de fonctionnalité',
      'appointment_issue': 'Problème de rendez-vous',
      'profile_problem': 'Problème de profil',
      'login_difficulty': 'Difficulté de connexion',
      'general_question': 'Question générale',
      'other': 'Autre'
    }
    return labels[category] || category
  }

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      'open': 'Ouvert',
      'in_progress': 'En cours',
      'waiting_user': 'En attente utilisateur',
      'resolved': 'Résolu',
      'closed': 'Fermé'
    }
    return labels[status] || status
  }

  const getPriorityLabel = (priority: string) => {
    const labels: Record<string, string> = {
      'low': 'Faible',
      'medium': 'Moyenne',
      'high': 'Élevée',
      'urgent': 'Urgente'
    }
    return labels[priority] || priority
  }

  type BadgeVariant = 'default' | 'destructive' | 'outline' | 'secondary'

  const getStatusVariant = (status: string): BadgeVariant => {
    const variants: Record<string, BadgeVariant> = {
      'open': 'outline',
      'in_progress': 'secondary',
      'waiting_user': 'default',
      'resolved': 'default',
      'closed': 'destructive'
    }
    return variants[status] || 'outline'
  }

  const getPriorityVariant = (priority: string): BadgeVariant => {
    const variants: Record<string, BadgeVariant> = {
      'low': 'outline',
      'medium': 'secondary',
      'high': 'default',
      'urgent': 'destructive'
    }
    return variants[priority] || 'outline'
  }

  const getCategoryVariant = (category: string): BadgeVariant => {
    const variants: Record<string, BadgeVariant> = {
      'account_issue': 'outline',
      'payment_problem': 'destructive',
      'technical_bug': 'secondary',
      'feature_request': 'default',
      'appointment_issue': 'outline',
      'profile_problem': 'outline',
      'login_difficulty': 'secondary',
      'general_question': 'outline',
      'other': 'outline'
    }
    return variants[category] || 'outline'
  }

  return {
    tickets: readonly(tickets),
    isLoading: readonly(isLoading),
    error: readonly(error),
    total: readonly(total),
    currentPage: readonly(currentPage),
    itemsPerPage: readonly(itemsPerPage),
    getTickets,
    getTicket,
    updateTicket,
    respondToTicket,
    closeTicket,
    getCategoryLabel,
    getStatusLabel,
    getPriorityLabel,
    getStatusVariant,
    getPriorityVariant,
    getCategoryVariant
  }
}