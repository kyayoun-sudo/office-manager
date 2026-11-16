import type { SpecialtyCategoryData, CategoriesResponse } from '~~~/shared/types/specialty'
import { api } from '~/utils/api'

export const useSpecialtyCategories = () => {
  const categories = ref<SpecialtyCategoryData[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const fetchCategories = async (params?: {
    lang?: string
  }) => {
    try {
      loading.value = true
      error.value = null
      
      const queryParams = {
        lang: params?.lang || 'fr'
      }
      
      const response = await api.get<CategoriesResponse>('/categories', { params: queryParams })
      
      console.log('Categories API Response:', response)
      
      if (response.success && response.data) {
        // Gérer différents formats de réponse
        if (Array.isArray(response.data)) {
          categories.value = response.data
        } else if (response.data.categories && Array.isArray(response.data.categories)) {
          categories.value = response.data.categories
        } else {
          categories.value = []
        }
        console.log('Categories loaded successfully:', categories.value.length, 'categories')
      } else {
        error.value = 'Aucune catégorie reçue du serveur'
        categories.value = []
        console.log('No categories received or API error:', error.value)
      }

    } catch (err: any) {
      error.value = err.message || 'Erreur lors du chargement des catégories'
      categories.value = []
      console.error('Erreur fetchCategories:', err)
    } finally {
      loading.value = false
    }
  }

  // Helper function to get category label in specific language
  const getCategoryLabel = (categoryValue: string, languageCode: string = 'fr'): string => {
    const category = categories.value.find(cat => cat.value === categoryValue)
    if (!category) return categoryValue
    
    const label = category.label[languageCode as keyof typeof category.label]
    return label || category.label.fr || categoryValue
  }

  // Get all categories as options for select component
  const getCategoryOptions = (languageCode: string = 'fr') => {
    return categories.value.map(category => ({
      value: category.value,
      label: getCategoryLabel(category.value, languageCode)
    }))
  }

  // Check if a category value exists
  const categoryExists = (categoryValue: string): boolean => {
    return categories.value.some(cat => cat.value === categoryValue)
  }

  return {
    // State
    categories: readonly(categories),
    loading: readonly(loading),
    error: readonly(error),
    
    // Methods
    fetchCategories,
    getCategoryLabel,
    getCategoryOptions,
    categoryExists
  }
}