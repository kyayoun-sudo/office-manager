import type { 
  Report, 
  ReportFilters, 
  ReportsResponse, 
  ResolveReportRequest, 
  UpdateReportStatusRequest 
} from '~~~/shared/types/report'
import { api } from '~/utils/api'

export const useReports = () => {
  const reports = ref<Report[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const total = ref(0)
  const currentPage = ref(1)
  const itemsPerPage = ref(20)

  const getReports = async (filters?: ReportFilters): Promise<ReportsResponse> => {
    isLoading.value = true
    error.value = null
    
    const params: Record<string, any> = {
      page: filters?.page || currentPage.value,
      itemsPerPage: filters?.itemsPerPage || itemsPerPage.value
    }
    
    if (filters?.status) params.status = filters.status
    if (filters?.priority) params.priority = filters.priority
    if (filters?.reportType) params.reportType = filters.reportType
    if (filters?.category) params.category = filters.category
    if (filters?.search) params.search = filters.search

    let response
    try {
      response = await api.get<any>('/user-reports/all-languages')
    } catch (apiError) {
      console.error('API Error:', apiError)
      error.value = 'Erreur de connexion à l\'API'
      isLoading.value = false
      return {
        data: [],
        total: 0,
        page: 1,
        itemsPerPage: 20
      }
    }
    
    console.log('Reports API response:', response)
    
    if (response.success) {
      const responseData = response.data
      console.log('Reports data:', responseData)
      
      // Gestion de différents formats de réponse API
      if (Array.isArray(responseData)) {
        reports.value = responseData
        total.value = responseData.length
      } else if (responseData.data && Array.isArray(responseData.data)) {
        // Structure: { success: true, data: [...], message: "..." }
        reports.value = responseData.data
        total.value = responseData.data.length
      } else {
        // Si l'API retourne un objet avec data/pagination
        reports.value = responseData.data || responseData['hydra:member'] || []
        total.value = responseData.total || responseData['hydra:totalItems'] || reports.value.length
      }
      
      currentPage.value = filters?.page || 1
      itemsPerPage.value = filters?.itemsPerPage || 20
      
      console.log('Reports after processing:', reports.value)
    } else {
      error.value = response.error?.message || 'Erreur lors du chargement des signalements'
      console.error('Erreur getReports:', response.error)
    }
    
    isLoading.value = false
    
    return {
      data: reports.value,
      total: total.value,
      page: currentPage.value,
      itemsPerPage: itemsPerPage.value
    }
  }

  const getReport = async (id: number): Promise<Report | null> => {
    const response = await api.get<Report>(`/user-reports/${id}`)
    
    if (response.success) {
      return response.data
    } else {
      error.value = response.error?.message || 'Erreur lors du chargement du signalement'
      return null
    }
  }

  const resolveReport = async (id: number, data: ResolveReportRequest): Promise<Report | null> => {
    const response = await api.post<Report>(`/user-reports/${id}/resolve`, data)
    
    if (response.success) {
      // Mettre à jour le signalement local
      const reportIndex = reports.value.findIndex(r => r.id === id)
      if (reportIndex !== -1) {
        reports.value[reportIndex] = { ...reports.value[reportIndex], ...response.data }
        reports.value[reportIndex].resolved = true
        reports.value[reportIndex].status = 'resolved'
      }
      return response.data
    } else {
      error.value = response.error?.message || 'Erreur lors de la résolution du signalement'
      return null
    }
  }

  const updateReportStatus = async (id: number, data: UpdateReportStatusRequest): Promise<Report | null> => {
    const response = await api.patch<Report>(`/user-reports/${id}/status`, data)
    
    if (response.success) {
      // Mettre à jour le signalement local
      const reportIndex = reports.value.findIndex(r => r.id === id)
      if (reportIndex !== -1) {
        reports.value[reportIndex] = { ...reports.value[reportIndex], ...response.data }
      }
      return response.data
    } else {
      error.value = response.error?.message || 'Erreur lors de la mise à jour du signalement'
      return null
    }
  }

  // Helpers pour les libellés
  const getReportTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      'inappropriate_behavior': 'Comportement inapproprié',
      'harassment': 'Harcèlement',
      'fraud': 'Fraude',
      'spam': 'Spam',
      'fake_profile': 'Faux profil',
      'safety_concern': 'Problème de sécurité',
      'technical_issue': 'Problème technique',
      'other': 'Autre'
    }
    return labels[type] || type
  }

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      'pending': 'En attente',
      'in_progress': 'En cours',
      'resolved': 'Résolu',
      'rejected': 'Rejeté',
      'escalated': 'Escaladé'
    }
    return labels[status] || status
  }

  const getPriorityLabel = (priority: string) => {
    const labels: Record<string, string> = {
      'low': 'Faible',
      'medium': 'Moyenne',
      'high': 'Élevée',
      'critical': 'Critique'
    }
    return labels[priority] || priority
  }

  const getStatusVariant = (status: string) => {
    const variants: Record<string, string> = {
      'pending': 'outline',
      'in_progress': 'secondary',
      'resolved': 'default',
      'rejected': 'destructive',
      'escalated': 'destructive'
    }
    return variants[status] || 'outline'
  }

  const getPriorityVariant = (priority: string) => {
    const variants: Record<string, string> = {
      'low': 'outline',
      'medium': 'secondary',
      'high': 'default',
      'critical': 'destructive'
    }
    return variants[priority] || 'outline'
  }

  // Alias pour la cohérence avec announcement-announcement
  const fetchReports = () => getReports()

  return {
    reports: readonly(reports),
    isLoading: readonly(isLoading),
    error: readonly(error),
    total: readonly(total),
    currentPage: readonly(currentPage),
    itemsPerPage: readonly(itemsPerPage),
    getReports,
    fetchReports,
    getReport,
    resolveReport,
    updateReportStatus,
    getReportTypeLabel,
    getStatusLabel,
    getPriorityLabel,
    getStatusVariant,
    getPriorityVariant
  }
}