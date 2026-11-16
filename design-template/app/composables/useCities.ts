import type {
  City,
  CreateCityDto,
  UpdateCityDto,
} from '~~/shared/types/city'

export const useCities = () => {
  const crud = useApiCrud<City>('/cities', {
    paginated: false,
    defaultParams: { active: false },
  })

  const fetchCities = (params?: Record<string, any>) =>
    crud.fetchList(params)

  const getCityById = (id: number) => crud.getById(id)

  const createCity = async (data: CreateCityDto) =>
    crud.create(data)

  const updateCity = async (data: UpdateCityDto & { id: number }) => {
    const { id, ...updateData } = data
    return crud.update(id, updateData, { refetch: true })
  }

  const deleteCity = (id: number) => crud.remove(id)

  const toggleCityStatus = (id: number, isActive: boolean) =>
    crud.update(id, { isActive }, { refetch: true })

  const bulkActivateCities = async (ids: number[]) =>
    crud.bulkUpdate(ids, { isActive: true })

  const bulkDeactivateCities = async (ids: number[]) =>
    crud.bulkUpdate(ids, { isActive: false })

  const bulkDeleteCities = async (ids: number[]) =>
    crud.bulkDelete(ids)

  return {
    cities: crud.items,
    loading: crud.isLoading,
    isLoading: crud.isLoading,
    error: crud.error,
    total: crud.total,
    fetchCities,
    getCityById,
    createCity,
    updateCity,
    deleteCity,
    toggleCityStatus,
    bulkActivateCities,
    bulkDeactivateCities,
    bulkDeleteCities,
  }
}
