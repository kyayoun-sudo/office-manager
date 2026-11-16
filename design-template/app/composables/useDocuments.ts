import type {
  Document,
  CreateDocumentData,
  UpdateDocumentData,
  DocumentsResponse,
  DocumentResponse,
  SimpleDocumentsResponse
} from '~~/shared/types/document'
import { api } from '~/utils/api'

export const useDocuments = () => {
  const documents = ref<Document[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const total = ref(0)

  const fetchDocuments = async (params?: {
    page?: number
    limit?: number
    search?: string
    type?: string
    isActive?: boolean
    lang?: string
    sortBy?: string
    sortOrder?: string
  }) => {
    try {
      loading.value = true
      error.value = null

      // Construction des paramètres de requête avec valeurs par défaut
      const queryParams = {
        page: params?.page || 1,
        limit: params?.limit || 100, // Récupérer beaucoup d'éléments par défaut
        isActive: params?.isActive !== undefined ? params.isActive : true,
        sortBy: params?.sortBy || 'id',
        sortOrder: params?.sortOrder || 'ASC',
        ...params
      }

      const response = await api.get<SimpleDocumentsResponse>('/documents', { params: queryParams })

      console.log('Documents API Response:', response)

      if (response.success && response.data) {
        // Gérer la réponse paginée
        if (Array.isArray(response.data)) {
          documents.value = response.data
          total.value = response.data.length
        } else if (response.data.data && Array.isArray(response.data.data)) {
          documents.value = response.data.data
          total.value = response.data.pagination?.total || response.data.data.length
        } else {
          documents.value = []
          total.value = 0
        }
        console.log('Documents loaded successfully:', documents.value.length, 'documents')
      } else {
        error.value = 'Aucune donnée reçue du serveur'
        documents.value = []
        total.value = 0
        console.log('No data received or API error:', error.value)
      }

    } catch (err: any) {
      error.value = err.message || 'Erreur lors du chargement des components'
      documents.value = []
      total.value = 0
      console.error('Erreur fetchDocuments:', err)
    } finally {
      loading.value = false
    }
  }

  const createDocument = async (data: CreateDocumentData) => {
    loading.value = true
    error.value = null
    const response = await api.post<Document>('/documents', data)

    if (response.success) {
      await fetchDocuments()
    } else {
      error.value = response.error.message || 'Failed to create document'
    }

    loading.value = false
    return response
  }

  const updateDocument = async (data: UpdateDocumentData) => {
    loading.value = true
    error.value = null
    const { id, ...updateData } = data
    console.log('Update Document API Response:', updateData)
    const response = await api.patch<Document>(`/documents/${id}`, updateData)

    if (response.success) {
      await fetchDocuments()
    } else {
      error.value = response.error.message || 'Failed to update document'
    }

    loading.value = false
    return response
  }

  const deleteDocument = async (id: number) => {
    loading.value = true
    error.value = null
    const response = await api.delete(`/documents/${id}`)

    if (response.success) {
      await fetchDocuments()
    } else {
      error.value = response.error.message || 'Failed to delete document'
    }

    loading.value = false
    return response
  }

  const toggleDocumentStatus = async (id: number, isActive: boolean) => {
    loading.value = true
    error.value = null
    const response = await api.patch(`/documents/${id}/toggle-active`, { isActive })

    if (response.success) {
      await fetchDocuments()
    } else {
      error.value = response.error.message || 'Failed to toggle document status'
    }

    loading.value = false
    return response
  }

  // Bulk activate components
  const bulkActivateDocuments = async (documentIds: number[]): Promise<{ success: boolean; results: any[] }> => {
    const results = await Promise.allSettled(
      documentIds.map(id => api.patch(`/documents/${id}`, { isActive: true }))
    )

    const successCount = results.filter(result => result.status === 'fulfilled').length
    const failedCount = results.length - successCount

    if (successCount > 0) {
      await fetchDocuments()
    }

    return {
      success: failedCount === 0,
      results: results.map((result, index) => ({
        id: documentIds[index],
        success: result.status === 'fulfilled',
        error: result.status === 'rejected' ? result.reason : null
      }))
    }
  }

  // Bulk deactivate components
  const bulkDeactivateDocuments = async (documentIds: number[]): Promise<{ success: boolean; results: any[] }> => {
    const results = await Promise.allSettled(
      documentIds.map(id => api.patch(`/documents/${id}`, { isActive: false }))
    )

    const successCount = results.filter(result => result.status === 'fulfilled').length
    const failedCount = results.length - successCount

    if (successCount > 0) {
      await fetchDocuments()
    }

    return {
      success: failedCount === 0,
      results: results.map((result, index) => ({
        id: documentIds[index],
        success: result.status === 'fulfilled',
        error: result.status === 'rejected' ? result.reason : null
      }))
    }
  }

  // Bulk delete components
  const bulkDeleteDocuments = async (documentIds: number[]): Promise<{ success: boolean; results: any[] }> => {
    const results = await Promise.allSettled(
      documentIds.map(id => api.delete(`/documents/${id}`))
    )

    const successCount = results.filter(result => result.status === 'fulfilled').length
    const failedCount = results.length - successCount

    if (successCount > 0) {
      await fetchDocuments()
    }

    return {
      success: failedCount === 0,
      results: results.map((result, index) => ({
        id: documentIds[index],
        success: result.status === 'fulfilled',
        error: result.status === 'rejected' ? result.reason : null
      }))
    }
  }

  const getDocumentById = async (id: number, includeAllTranslations: boolean = false) => {
    try {
      loading.value = true
      error.value = null

      const response = await api.get<DocumentResponse>(`/documents/${id}`, {
        params: {
          includeAllTranslations
        }
      })

      if (response.success && response.data) {
        return response.data
      } else {
        error.value = response.error?.message || 'Aucune donnée reçue du serveur'
        return null
      }
    } catch (err: any) {
      error.value = err.message || 'Erreur lors du chargement du document'
      console.error('Erreur getDocumentById:', err)
      return null
    } finally {
      loading.value = false
    }
  }

  return {
    documents: readonly(documents),
    loading: readonly(loading),
    error: readonly(error),
    total: readonly(total),
    fetchDocuments,
    getDocumentById,
    createDocument,
    updateDocument,
    deleteDocument,
    toggleDocumentStatus,
    bulkActivateDocuments,
    bulkDeactivateDocuments,
    bulkDeleteDocuments
  }
}