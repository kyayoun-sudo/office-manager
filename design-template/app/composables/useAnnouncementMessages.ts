import type { 
  AnnouncementMessage, 
  CreateAnnouncementMessageRequest, 
  UpdateAnnouncementMessageRequest, 
  AnnouncementMessageApiResponse,
  BulkActionRequest,
  Language
} from '~~/shared/types/announcement-message'
import { api } from '~/utils/api'

export const useAnnouncementMessages = () => {
  const messages = ref<AnnouncementMessage[]>([])
  const languages = ref<Language[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  const fetchMessages = async (): Promise<AnnouncementMessage[]> => {
    isLoading.value = true
    error.value = null
    
    try {
      const response = await api.get<{ success: boolean, data: AnnouncementMessage[], message: string }>('/admin-messages')
      if (response.success) {
        messages.value = response.data || []
        return response.data || []
      } else {
        throw new Error(response.error?.message || 'Erreur lors du chargement des announcement')
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors du chargement des announcement'
      console.error('Erreur fetchMessages:', err)
      messages.value = []
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // Fonction simplifiée sans API de langues
  const fetchLanguages = async (): Promise<Language[]> => {
    // Langues par défaut hardcodées
    const defaultLanguages: Language[] = [
      { id: 1, code: 'fr', flag: '🇫🇷', enabled: true, name: 'Français', createdAt: '', updatedAt: '' },
      { id: 2, code: 'en', flag: '🇬🇧', enabled: true, name: 'English', createdAt: '', updatedAt: '' },
      { id: 3, code: 'nl', flag: '🇳🇱', enabled: true, name: 'Nederlands', createdAt: '', updatedAt: '' },
      { id: 4, code: 'de', flag: '🇩🇪', enabled: true, name: 'Deutsch', createdAt: '', updatedAt: '' }
    ]
    languages.value = defaultLanguages
    return defaultLanguages
  }

  const getMessage = async (id: number) => {
    isLoading.value = true
    error.value = null
    
    try {
      const response = await api.get<{ success: boolean, data: AnnouncementMessage }>(`/admin/announcement-messages/${id}`)
      if (response.success) {
        return response
      } else {
        throw new Error(response.error?.message || 'Erreur lors du chargement du message')
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors du chargement du message'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const createMessage = async (data: CreateAnnouncementMessageRequest) => {
    isLoading.value = true
    error.value = null
    
    try {
      const response = await api.post<{ success: boolean, data: AnnouncementMessage }>('/admin-messages', data)
      
      if (response.success) {
        await fetchMessages() // Refresh the list
      } else {
        error.value = response.error?.message || 'Erreur lors de la création du message'
      }
      
      return response
    } catch (err: any) {
      error.value = err.message || 'Erreur lors de la création du message'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const updateMessage = async (id: number, data: UpdateAnnouncementMessageRequest) => {
    isLoading.value = true
    error.value = null
    
    try {
      const response = await api.patch<{ success: boolean, data: AnnouncementMessage }>(`/admin/announcement-messages/${id}`, data)
      
      if (response.success) {
        await fetchMessages() // Refresh the list
      } else {
        error.value = response.error?.message || 'Erreur lors de la modification du message'
      }
      
      return response
    } catch (err: any) {
      error.value = err.message || 'Erreur lors de la modification du message'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const sendMessage = async (id: number) => {
    isLoading.value = true
    error.value = null
    
    try {
      const response = await api.post(`/admin/announcement-messages/${id}/send`)
      
      if (response.success) {
        await fetchMessages() // Refresh the list
      } else {
        error.value = response.error?.message || 'Erreur lors de l\'envoi du message'
      }
      
      return response
    } catch (err: any) {
      error.value = err.message || 'Erreur lors de l\'envoi du message'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const deleteMessage = async (id: number) => {
    isLoading.value = true
    error.value = null
    
    try {
      const response = await api.delete(`/admin/announcement-messages/${id}`)
      
      if (response.success) {
        await fetchMessages() // Refresh the list
      } else {
        error.value = response.error?.message || 'Erreur lors de la suppression du message'
      }
      
      return response
    } catch (err: any) {
      error.value = err.message || 'Erreur lors de la suppression du message'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // Bulk actions
  const bulkAction = async (request: BulkActionRequest) => {
    isLoading.value = true
    error.value = null
    
    try {
      const response = await api.post('/admin/announcement-messages/bulk-action', request)
      
      if (response.success) {
        await fetchMessages() // Refresh the list
      } else {
        error.value = response.error?.message || 'Erreur lors de l\'action groupée'
      }
      
      return response
    } catch (err: any) {
      error.value = err.message || 'Erreur lors de l\'action groupée'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const toggleMessageStatus = async (id: number, isActive: boolean) => {
    isLoading.value = true
    error.value = null
    
    try {
      const response = await api.patch(`/admin/announcement-messages/${id}/status`, { isActive })
      
      if (response.success) {
        await fetchMessages() // Refresh the list
      } else {
        error.value = response.error?.message || 'Erreur lors du changement de statut'
      }
      
      return response
    } catch (err: any) {
      error.value = err.message || 'Erreur lors du changement de statut'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // Helper functions simplifiées - utilise les champs directs pour la compatibilité
  const getMessageTitle = (message: AnnouncementMessage, languageCode = 'fr') => {
    // Si le message a des traductions, les utiliser
    if (message.translations && message.translations.length > 0) {
      const translation = message.translations?.find(t => t.language.code === languageCode)
      return translation?.title || message.translations?.[0]?.title || 'Sans titre'
    }
    // Sinon, utiliser le titre direct du message (compatibilité avec l'ancienne structure)
    return (message as any).title || 'Sans titre'
  }

  const getMessageContent = (message: AnnouncementMessage, languageCode = 'fr') => {
    // Si le message a des traductions, les utiliser
    if (message.translations && message.translations.length > 0) {
      const translation = message.translations?.find(t => t.language.code === languageCode)
      return translation?.content || message.translations?.[0]?.content || 'Sans contenu'
    }
    // Sinon, utiliser le contenu direct du message (compatibilité avec l'ancienne structure)
    return (message as any).content || 'Sans contenu'
  }

  return {
    messages: readonly(messages),
    languages: readonly(languages),
    isLoading: readonly(isLoading),
    error: readonly(error),
    fetchMessages,
    fetchLanguages,
    getMessage,
    createMessage,
    updateMessage,
    sendMessage,
    deleteMessage,
    bulkAction,
    toggleMessageStatus,
    getMessageTitle,
    getMessageContent
  }
}