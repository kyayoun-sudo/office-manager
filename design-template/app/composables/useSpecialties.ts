import type {
  Specialty,
  CreateSpecialtyDto,
  UpdateSpecialtyDto,
} from '~~/shared/types/specialty'

export const useSpecialties = () => {
  const crud = useApiCrud<Specialty>('/specialties', {
    paginated: true,
    defaultParams: { lang: 'fr', sortBy: 'id', sortOrder: 'ASC' },
  })

  const fetchSpecialties = (params?: Record<string, any>) =>
    crud.fetchList(params)

  const getSpecialtyById = (id: number, includeAllTranslations: boolean = false) =>
    crud.getById(id, { includeAllTranslations })

  const createSpecialty = async (data: CreateSpecialtyDto) =>
    crud.create(data)

  const updateSpecialty = async (data: UpdateSpecialtyDto & { id: number }) => {
    const { id, ...updateData } = data
    return crud.update(id, updateData, { refetch: true })
  }

  const deleteSpecialty = (id: number) => crud.remove(id)

  const toggleSpecialtyStatus = (id: number, isActive: boolean) =>
    crud.update(id, { isActive }, { refetch: true })

  const bulkActivateSpecialties = async (specialtyIds: number[]) =>
    crud.bulkUpdate(specialtyIds, { isActive: true })

  const bulkDeactivateSpecialties = async (specialtyIds: number[]) =>
    crud.bulkUpdate(specialtyIds, { isActive: false })

  const bulkDeleteSpecialties = async (specialtyIds: number[]) =>
    crud.bulkDelete(specialtyIds)

  return {
    specialties: crud.items,
    loading: crud.isLoading,
    error: crud.error,
    total: crud.total,
    currentPage: crud.currentPage,
    totalPages: crud.totalPages,
    itemsPerPage: crud.itemsPerPage,
    fetchSpecialties,
    getSpecialtyById,
    createSpecialty,
    updateSpecialty,
    deleteSpecialty,
    toggleSpecialtyStatus,
    bulkActivateSpecialties,
    bulkDeactivateSpecialties,
    bulkDeleteSpecialties,
  }
}
