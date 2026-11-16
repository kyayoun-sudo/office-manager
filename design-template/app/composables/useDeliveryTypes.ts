import type {
  DeliveryType,
  CreateDeliveryTypeDto,
  UpdateDeliveryTypeDto,
  DeliveryTypeQueryParams,
} from '~~/shared/types/delivery-type'

export const useDeliveryTypes = () => {
  const crud = useApiCrud<DeliveryType>('/delivery-types', {
    paginated: true,
    defaultParams: { includeAllTranslations: true },
  })

  const fetchDeliveryTypes = (params?: DeliveryTypeQueryParams) =>
    crud.fetchList(params as Record<string, any>)

  const getDeliveryTypeById = (id: number) => crud.getById(id)

  const createDeliveryType = async (data: CreateDeliveryTypeDto) =>
    crud.create(data)

  const updateDeliveryType = (id: number, data: UpdateDeliveryTypeDto) =>
    crud.update(id, data, { refetch: true })

  const deleteDeliveryType = (id: number) => crud.remove(id)

  const bulkDeleteDeliveryTypes = async (ids: number[]) =>
    crud.bulkDelete(ids)

  // Computed
  const activeDeliveryTypes = computed(() => crud._items.value.filter(dt => dt.isActive))
  const inactiveDeliveryTypes = computed(() => crud._items.value.filter(dt => !dt.isActive))

  return {
    deliveryTypes: crud.items,
    loading: crud.isLoading,
    error: crud.error,
    total: crud.total,
    currentPage: crud.currentPage,
    totalPages: crud.totalPages,
    itemsPerPage: crud.itemsPerPage,
    activeDeliveryTypes,
    inactiveDeliveryTypes,
    fetchDeliveryTypes,
    getDeliveryTypeById,
    createDeliveryType,
    updateDeliveryType,
    deleteDeliveryType,
    bulkDeleteDeliveryTypes,
  }
}
