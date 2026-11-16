import { toast } from 'vue-sonner'
import type { ApiResult, ApiErrorResponse } from '~~~/shared/types/api'

export const useToast = () => {
  return {
    toast: (options: { title: string; description?: string; variant?: string }) => {
      if (options.variant === 'destructive') {
        toast.error(options.title, {
          description: options.description
        })
      } else {
        toast.success(options.title, {
          description: options.description
        })
      }
    },

    /**
     * Handle API error response and display appropriate toast message
     */
    handleApiError: (response: any, fallbackTitle: string = 'Erreur') => {
      if (response?.success === false) {
        let description = 'Une erreur est survenue'

        // Format simple : { success: false, message: "..." }
        if (typeof response.message === 'string' && response.message.trim() !== '') {
          description = response.message
          toast.error(fallbackTitle, { description })
          return
        }

        // Format complexe avec structure d'erreur
        const errorResponse = response as ApiErrorResponse
        
        // Priorité 1 : parcourir le tableau details pour trouver un message dans detail.error.message
        if (Array.isArray(errorResponse.error?.details)) {
          for (const detail of errorResponse.error.details) {
            if (detail?.error?.message && typeof detail.error.message === 'string') {
              description = detail.error.message
              break
            }
          }
        }

        // Priorité 2 : si aucun message n'a été récupéré, utiliser le message principal
        if (
          description === 'Une erreur est survenue' &&
          typeof errorResponse.error?.message === 'string' &&
          !errorResponse.error.message.includes('http') &&
          !errorResponse.error.message.includes('[DELETE]')
        ) {
          description = errorResponse.error.message
        }

        // Priorité 3 : si toujours rien, vérifier si details contient des strings simples
        if (description === 'Une erreur est survenue' && Array.isArray(errorResponse.error?.details)) {
          const validDetails = errorResponse.error.details.filter(
            detail => typeof detail === 'string' && detail.trim() !== ''
          )
          if (validDetails.length > 0) {
            description = validDetails.join('\n')
          }
        }

        toast.error(fallbackTitle, { description })
      }
    },


    /**
     * Display success toast for successful API response
     */
    handleApiSuccess: (message: string, description?: string) => {
      toast.success(message, {
        description: description
      })
    }
  }
}
