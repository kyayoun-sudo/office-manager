export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  message?: string
  error?: {
    message: string
    code?: string
  }
}

export interface PaginatedResponse<T = any> {
  success: boolean
  data: {
    data: T[]
    pagination: {
      total: number
      page: number
      limit: number
      totalPages: number
    }
  }
  message?: string
}

export const useApiResponse = () => {
  
  const handleApiResponse = <T>(response: any): { success: boolean; data: T | null; error: string | null } => {
    try {
      // Normalize response structure
      const apiResponse = response?.data || response
      
      // Check for success
      const isSuccess = apiResponse?.success !== false && response?.success !== false
      
      if (!isSuccess) {
        const errorMessage = apiResponse?.error?.details?.message || 
                           response?.error?.details?.message || 
                           apiResponse?.error?.message || 
                           response?.error?.message || 
                           apiResponse?.message || 
                           response?.message ||
                           'Erreur inconnue'
        return { success: false, data: null, error: errorMessage }
      }
      
      // Extract data
      const responseData = apiResponse?.data || apiResponse
      
      return { success: true, data: responseData, error: null }
      
    } catch (err: any) {
      return { success: false, data: null, error: err.message || 'Erreur lors du traitement de la réponse' }
    }
  }

  const handlePaginatedResponse = <T>(response: any): { 
    success: boolean
    data: T[]
    pagination: { total: number; page: number; limit: number; totalPages: number } | null
    error: string | null 
  } => {
    try {
      const apiResponse = response?.data || response
      const isSuccess = apiResponse?.success !== false && response?.success !== false
      
      if (!isSuccess) {
        const errorMessage = apiResponse?.error?.details?.message || 
                           response?.error?.details?.message || 
                           apiResponse?.error?.message || 
                           response?.error?.message || 
                           apiResponse?.message || 
                           response?.message ||
                           'Erreur inconnue'
        return { success: false, data: [], pagination: null, error: errorMessage }
      }

      let itemsData: T[] = []
      let paginationData = null

      // Handle different response structures
      if (Array.isArray(apiResponse?.data)) {
        // Simple array response
        itemsData = apiResponse.data.filter(item => item != null)
        paginationData = apiResponse.pagination || response.pagination
      } else if (apiResponse?.data?.data && Array.isArray(apiResponse.data.data)) {
        // Nested response with pagination
        itemsData = apiResponse.data.data.filter(item => item != null)
        paginationData = apiResponse.data.pagination
      } else if (Array.isArray(apiResponse)) {
        // Direct array response
        itemsData = apiResponse.filter(item => item != null)
      }

      return { 
        success: true, 
        data: itemsData, 
        pagination: paginationData,
        error: null 
      }
      
    } catch (err: any) {
      return { 
        success: false, 
        data: [], 
        pagination: null,
        error: err.message || 'Erreur lors du traitement de la réponse' 
      }
    }
  }

  const createSuccessResponse = <T>(data: T, message?: string): ApiResponse<T> => ({
    success: true,
    data,
    message
  })

  const createErrorResponse = (message: string, code?: string): ApiResponse => ({
    success: false,
    error: { message, code }
  })

  const isApiSuccess = (response: any): boolean => {
    const apiResponse = response?.data || response
    return apiResponse?.success !== false && response?.success !== false
  }

  const extractApiError = (response: any): string => {
    const apiResponse = response?.data || response
    return apiResponse?.error?.details?.message || 
           response?.error?.details?.message || 
           apiResponse?.error?.message || 
           response?.error?.message || 
           apiResponse?.message || 
           response?.message ||
           'Erreur inconnue'
  }

  const extractApiData = <T>(response: any): T | null => {
    const apiResponse = response?.data || response
    return apiResponse?.data || apiResponse || null
  }

  return {
    handleApiResponse,
    handlePaginatedResponse,
    createSuccessResponse,
    createErrorResponse,
    isApiSuccess,
    extractApiError,
    extractApiData
  }
}