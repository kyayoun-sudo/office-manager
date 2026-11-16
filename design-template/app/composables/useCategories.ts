import type {
  Category,
  CreateCategoryDto,
  UpdateCategoryDto,
} from '~~/shared/types/category'

export const useCategories = () => {
  const crud = useApiCrud<Category>('/categories', {
    paginated: true,
    defaultParams: { lang: 'fr', sortBy: 'id', sortOrder: 'ASC', includeAllTranslations: true },
  })

  const fetchCategories = (params?: Record<string, any>) =>
    crud.fetchList(params)

  const getCategoryById = (id: number) => crud.getById(id, { includeAllTranslations: true })

  const createCategory = async (data: CreateCategoryDto) =>
    crud.create(data)

  const updateCategory = async (data: UpdateCategoryDto & { id: number }) => {
    const { id, ...updateData } = data
    return crud.update(id, updateData, { refetch: true })
  }

  const deleteCategory = (id: number) => crud.remove(id)

  const toggleCategoryStatus = (id: number, isActive: boolean) =>
    crud.update(id, { isActive }, { refetch: true })

  const bulkActivateCategories = async (ids: number[]) =>
    crud.bulkUpdate(ids, { isActive: true })

  const bulkDeactivateCategories = async (ids: number[]) =>
    crud.bulkUpdate(ids, { isActive: false })

  const bulkDeleteCategories = async (ids: number[]) =>
    crud.bulkDelete(ids)

  return {
    categories: crud.items,
    loading: crud.isLoading,
    isLoading: crud.isLoading,
    error: crud.error,
    total: crud.total,
    currentPage: crud.currentPage,
    totalPages: crud.totalPages,
    itemsPerPage: crud.itemsPerPage,
    fetchCategories,
    getCategoryById,
    createCategory,
    updateCategory,
    deleteCategory,
    toggleCategoryStatus,
    bulkActivateCategories,
    bulkDeactivateCategories,
    bulkDeleteCategories,
  }
}
