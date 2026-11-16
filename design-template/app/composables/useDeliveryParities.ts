import type {
  DeliveryParity,
  CreateDeliveryParityDto,
  UpdateDeliveryParityDto,
} from '~~/shared/types/delivery-parity'

export const useDeliveryParities = () => {
  const crud = useApiCrud<DeliveryParity>('/delivery-parities', {
    paginated: true,
    defaultParams: { lang: 'fr', sortBy: 'id', sortOrder: 'ASC' },
  })

  const fetchDeliveryParities = (params?: Record<string, any>) =>
    crud.fetchList(params)

  const getDeliveryParityById = (id: number) => crud.getById(id)

  const createDeliveryParity = async (data: CreateDeliveryParityDto) =>
    crud.create(data)

  const updateDeliveryParity = async (data: UpdateDeliveryParityDto & { id: number }) => {
    const { id, ...updateData } = data
    return crud.update(id, updateData, { refetch: true })
  }

  const deleteDeliveryParity = (id: number) => crud.remove(id)

  const bulkDeleteDeliveryParities = async (ids: number[]) =>
    crud.bulkDelete(ids)

  return {
    deliveryParities: crud.items,
    loading: crud.isLoading,
    error: crud.error,
    total: crud.total,
    currentPage: crud.currentPage,
    totalPages: crud.totalPages,
    itemsPerPage: crud.itemsPerPage,
    fetchDeliveryParities,
    getDeliveryParityById,
    createDeliveryParity,
    updateDeliveryParity,
    deleteDeliveryParity,
    bulkDeleteDeliveryParities,
  }
}
