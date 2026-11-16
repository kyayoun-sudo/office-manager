import type {
  BreastfeedingType,
  CreateBreastfeedingTypeDto,
  UpdateBreastfeedingTypeDto,
} from '~~/shared/types/breastfeeding-type'

export const useBreastfeedingTypes = () => {
  const crud = useApiCrud<BreastfeedingType>('/breastfeeding-types', {
    paginated: true,
    defaultParams: { lang: 'fr', sortBy: 'id', sortOrder: 'ASC' },
  })

  const fetchBreastfeedingTypes = (params?: Record<string, any>) =>
    crud.fetchList(params)

  const getBreastfeedingTypeById = (id: number) => crud.getById(id)

  const createBreastfeedingType = async (data: CreateBreastfeedingTypeDto) =>
    crud.create(data)

  const updateBreastfeedingType = async (data: UpdateBreastfeedingTypeDto & { id: number }) => {
    const { id, ...updateData } = data
    return crud.update(id, updateData, { refetch: true })
  }

  const deleteBreastfeedingType = (id: number) => crud.remove(id)

  const toggleBreastfeedingTypeStatus = (id: number, isActive: boolean) =>
    crud.update(id, { isActive }, { refetch: true })

  const bulkActivateBreastfeedingTypes = async (typeIds: number[]) =>
    crud.bulkUpdate(typeIds, { isActive: true })

  const bulkDeactivateBreastfeedingTypes = async (typeIds: number[]) =>
    crud.bulkUpdate(typeIds, { isActive: false })

  const bulkDeleteBreastfeedingTypes = async (typeIds: number[]) =>
    crud.bulkDelete(typeIds)

  return {
    breastfeedingTypes: crud.items,
    loading: crud.isLoading,
    error: crud.error,
    total: crud.total,
    currentPage: crud.currentPage,
    totalPages: crud.totalPages,
    itemsPerPage: crud.itemsPerPage,
    fetchBreastfeedingTypes,
    getBreastfeedingTypeById,
    createBreastfeedingType,
    updateBreastfeedingType,
    deleteBreastfeedingType,
    toggleBreastfeedingTypeStatus,
    bulkActivateBreastfeedingTypes,
    bulkDeactivateBreastfeedingTypes,
    bulkDeleteBreastfeedingTypes,
  }
}
