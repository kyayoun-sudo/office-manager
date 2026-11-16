import type { 
  Ticket, 
  TicketListResponse, 
  CreateTicketDto, 
  UpdateTicketStatusDto, 
  TicketQueryParams,
  TicketStatus,
  TicketPriority,
  TicketCategory,
  TicketStatusLabels,
  TicketPriorityLabels,
  TicketCategoryLabels
} from '#shared/types/ticket'
import { api } from '~/utils/api'

export const useTickets = () => {
  const fetchTickets = async (params: TicketQueryParams = {}): Promise<TicketListResponse> => {
    try {
      const response = await api.get<any>('/tickets', { params })
      
      if (response.success) {
        // Si response.data est directement un tableau, on le structure correctement
        if (Array.isArray(response.data)) {
          return {
            success: true,
            data: response.data,
            pagination: response.pagination || {
              page: 1,
              limit: 20,
              total: response.data.length,
              totalPages: 1,
              hasNextPage: false,
              hasPrevPage: false
            }
          }
        }
        
        // Sinon on retourne la structure normale
        return response.data
      } else {
        throw new Error(response.error?.message || 'Erreur lors du chargement des tickets')
      }
    } catch (error) {
      console.error('Erreur lors du chargement des tickets:', error)
      throw error
    }
  }

  const fetchTicket = async (id: number): Promise<{ success: boolean; data: Ticket }> => {
    try {
      const response = await api.get<Ticket>(`/tickets/${id}`)
      
      if (response.success) {
        return { success: true, data: response.data }
      } else {
        throw new Error(response.error?.message || 'Erreur lors du chargement du ticket')
      }
    } catch (error) {
      console.error('Erreur lors du chargement du ticket:', error)
      throw error
    }
  }

  const createTicket = async (data: CreateTicketDto): Promise<{ success: boolean; message: string }> => {
    try {
      const response = await api.post<any>('/tickets', data)
      
      if (response.success) {
        return { success: true, message: response.message || 'Ticket créé avec succès' }
      } else {
        throw new Error(response.error?.message || 'Erreur lors de la création du ticket')
      }
    } catch (error) {
      console.error('Erreur lors de la création du ticket:', error)
      throw error
    }
  }

  const updateTicketStatus = async (id: number, data: UpdateTicketStatusDto): Promise<{ success: boolean; message: string; data: Ticket }> => {
    try {
      const response = await api.patch<Ticket>(`/tickets/${id}/status`, data)
      
      if (response.success) {
        return { 
          success: true, 
          message: response.message || 'Statut mis à jour avec succès', 
          data: response.data 
        }
      } else {
        throw new Error(response.error?.message || 'Erreur lors de la mise à jour du ticket')
      }
    } catch (error) {
      console.error('Erreur lors de la mise à jour du ticket:', error)
      throw error
    }
  }

  const deleteTicket = async (id: number): Promise<{ success: boolean; message: string }> => {
    try {
      const response = await api.delete<any>(`/tickets/${id}`)
      
      if (response.success) {
        return { success: true, message: response.message || 'Ticket supprimé avec succès' }
      } else {
        throw new Error(response.error?.message || 'Erreur lors de la suppression du ticket')
      }
    } catch (error) {
      console.error('Erreur lors de la suppression du ticket:', error)
      throw error
    }
  }

  const bulkUpdateTicketStatus = async (ids: number[], status: TicketStatus): Promise<{ success: boolean; message: string }> => {
    try {
      // Mettre à jour en parallèle tous les tickets sélectionnés
      await Promise.all(ids.map(id => updateTicketStatus(id, { status })))
      return { 
        success: true, 
        message: `${ids.length} ticket${ids.length > 1 ? 's' : ''} mis à jour avec succès` 
      }
    } catch (error) {
      console.error('Erreur lors de la mise à jour en lot:', error)
      throw error
    }
  }

  const bulkDeleteTickets = async (ids: number[]): Promise<{ success: boolean; message: string }> => {
    try {
      // Supprimer en parallèle tous les tickets sélectionnés
      await Promise.all(ids.map(id => deleteTicket(id)))
      return { 
        success: true, 
        message: `${ids.length} ticket${ids.length > 1 ? 's' : ''} supprimé${ids.length > 1 ? 's' : ''} avec succès` 
      }
    } catch (error) {
      console.error('Erreur lors de la suppression en lot:', error)
      throw error
    }
  }

  // Fonctions utilitaires pour les labels et variants
  const getStatusLabel = (status: TicketStatus): string => {
    return TicketStatusLabels[status] || status
  }

  const getPriorityLabel = (priority: TicketPriority): string => {
    return TicketPriorityLabels[priority] || priority
  }

  const getCategoryLabel = (category: TicketCategory): string => {
    return TicketCategoryLabels[category] || category
  }

  const getStatusVariant = (status: TicketStatus): string => {
    const variants: Record<TicketStatus, string> = {
      [TicketStatus.OPEN]: 'default',
      [TicketStatus.IN_PROGRESS]: 'secondary',
      [TicketStatus.RESOLVED]: 'default',
      [TicketStatus.CLOSED]: 'outline'
    }
    return variants[status] || 'default'
  }

  const getPriorityVariant = (priority: TicketPriority): string => {
    const variants: Record<TicketPriority, string> = {
      [TicketPriority.LOW]: 'outline',
      [TicketPriority.MEDIUM]: 'secondary',
      [TicketPriority.HIGH]: 'default',
      [TicketPriority.URGENT]: 'destructive'
    }
    return variants[priority] || 'default'
  }

  const getCategoryVariant = (category: TicketCategory): string => {
    const variants: Record<TicketCategory, string> = {
      [TicketCategory.TECHNICAL]: 'destructive',
      [TicketCategory.BILLING]: 'default',
      [TicketCategory.ACCOUNT]: 'secondary',
      [TicketCategory.APPOINTMENT]: 'outline',
      [TicketCategory.OTHER]: 'outline'
    }
    return variants[category] || 'outline'
  }

  return {
    fetchTickets,
    fetchTicket,
    createTicket,
    updateTicketStatus,
    deleteTicket,
    bulkUpdateTicketStatus,
    bulkDeleteTickets,
    getStatusLabel,
    getPriorityLabel,
    getCategoryLabel,
    getStatusVariant,
    getPriorityVariant,
    getCategoryVariant
  }
}