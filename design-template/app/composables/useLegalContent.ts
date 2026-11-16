import type { 
  LegalContent, 
  CreateLegalContentRequest, 
  UpdateLegalContentRequest,
  LegalContentFilters,
  LegalContentStats,
  LegalContentType,
  LegalContentApiResponse
} from '~~~/shared/types/legal-content'
import { api } from '~/utils/api'

const LEGAL_CONTENT_TYPE_LABELS: Record<LegalContentType, string> = {
  terms: 'Conditions générales d\'utilisation',
  privacy: 'Politique de confidentialité',
  about: 'À propos de l\'application'
}

export const useLegalContent = () => {
  const legalContents = ref<LegalContent[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Get all legal contents with filters and pagination
  const getLegalContents = async (filters: LegalContentFilters = {}, page = 1, limit = 10) => {
    loading.value = true
    error.value = null
    
    const params = new URLSearchParams()
    
    if (filters.contentType && filters.contentType !== 'all') {
      params.append('contentType', filters.contentType)
    }
    if (filters.isActive !== undefined && filters.isActive !== 'all') {
      params.append('isActive', filters.isActive.toString())
    }
    if (filters.search) {
      params.append('search', filters.search)
    }
    params.append('page', page.toString())
    params.append('limit', limit.toString())

    const response = await api.get<LegalContentApiResponse>(`/legal-content`)
    
    if (response.success) {
      legalContents.value = response.data || []
    } else {
      error.value = response.error?.message || 'Erreur lors du chargement des contenus légaux'
    }
    
    loading.value = false
    
    return {
      data: legalContents.value,
      count: legalContents.value.length
    }
  }

  // Get single legal content
  const getLegalContent = async (id: number) => {
    const response = await api.get<LegalContent>(`/admin/legal-content/${id}`)
    
    if (!response.success) {
      error.value = response.error?.message || 'Erreur lors du chargement du contenu'
    }
    
    return response
  }

  // Create new legal content
  const createLegalContent = async (data: CreateLegalContentRequest) => {
    const response = await api.post<LegalContent>('/admin/legal-content', data)
    
    if (response.success) {
      legalContents.value.push(response.data)
    } else {
      error.value = response.error?.message || 'Erreur lors de la création du contenu'
    }
    
    return response
  }

  // Update legal content
  const updateLegalContent = async (id: number, data: UpdateLegalContentRequest) => {
    const response = await api.patch<LegalContent>(`/admin/legal-content/${id}`, data)
    
    if (response.success) {
      const contentIndex = legalContents.value.findIndex(c => c.id === id)
      if (contentIndex !== -1) {
        legalContents.value[contentIndex] = response.data
      }
    } else {
      error.value = response.error?.message || 'Erreur lors de la modification du contenu'
    }
    
    return response
  }

  // Toggle active status
  const toggleActiveStatus = async (id: number) => {
    const response = await api.post<LegalContent>(`/admin/legal-content/${id}/toggle-active`)
    
    if (response.success) {
      const contentIndex = legalContents.value.findIndex(c => c.id === id)
      if (contentIndex !== -1) {
        legalContents.value[contentIndex] = response.data
      }
    } else {
      error.value = response.error?.message || 'Erreur lors du changement de statut'
    }
    
    return response
  }

  // Delete legal content
  const deleteLegalContent = async (id: number) => {
    const response = await api.delete(`/admin/legal-content/${id}`)
    
    if (response.success) {
      legalContents.value = legalContents.value.filter(c => c.id !== id)
    } else {
      error.value = response.error?.message || 'Erreur lors de la suppression du contenu'
    }
    
    return response
  }

  // Calculate statistics from the data
  const calculateStats = (contents: LegalContent[]): LegalContentStats => {
    if (!Array.isArray(contents)) {
      return {
        total: 0,
        active: 0,
        inactive: 0,
        byType: { terms: 0, privacy: 0, about: 0 }
      }
    }

    const stats: LegalContentStats = {
      total: contents.length,
      active: 0,
      inactive: 0,
      byType: { terms: 0, privacy: 0, about: 0 }
    }

    contents.forEach(content => {
      // Count by publication status (isActive = published)
      if (content.isActive) {
        stats.active++
      } else {
        stats.inactive++
      }

      // Count by type
      if (content.contentType in stats.byType) {
        stats.byType[content.contentType]++
      }
    })

    return stats
  }

  // Get legal content statistics from data
  const getLegalContentStats = async (filters: LegalContentFilters = {}) => {
    const response = await getLegalContents(filters, 1, 1000) // Large limit to get all
    
    if (response.data) {
      return calculateStats(response.data)
    } else {
      error.value = 'Erreur lors du chargement des statistiques'
      return calculateStats([])
    }
  }

  // Helper functions for labels and styling
  const getTypeLabel = (type: LegalContentType): string => {
    return LEGAL_CONTENT_TYPE_LABELS[type] || type
  }

  const getStatusVariant = (isActive: boolean) => {
    if (isActive) return 'default'
    return 'outline'
  }

  const getStatusLabel = (isActive: boolean): string => {
    if (isActive) return 'Actif'
    return 'Inactif'
  }

  const getTypeVariant = (type: LegalContentType) => {
    const variants = {
      terms: 'default',
      privacy: 'secondary',
      about: 'outline'
    }
    return variants[type] || 'outline'
  }

  // Format version number
  const formatVersion = (version: string): string => {
    return `v${version}`
  }

  // Check if content can be edited
  const canEdit = (content: LegalContent): boolean => {
    return true
  }

  // Check if content can be activated
  const canActivate = (content: LegalContent): boolean => {
    return !content.isActive
  }

  // Check if content can be deactivated
  const canDeactivate = (content: LegalContent): boolean => {
    return content.isActive
  }

  return {
    // State
    legalContents: readonly(legalContents),
    loading: readonly(loading),
    error: readonly(error),

    // API methods
    getLegalContents,
    getLegalContent,
    createLegalContent,
    updateLegalContent,
    toggleActiveStatus,
    deleteLegalContent,
    getLegalContentStats,
    calculateStats,

    // Helper methods
    getTypeLabel,
    getStatusVariant,
    getStatusLabel,
    getTypeVariant,
    formatVersion,
    canEdit,
    canActivate,
    canDeactivate
  }
}