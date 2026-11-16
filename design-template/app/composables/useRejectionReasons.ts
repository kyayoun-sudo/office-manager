import type {
  RejectionReason,
  CreateRejectionReasonDto,
  UpdateRejectionReasonDto,
} from '~~/shared/types/rejection-reason'
import { api } from '~/utils/api'

export const useRejectionReasons = () => {
  const crud = useApiCrud<RejectionReason>('/rejection-reasons', {
    paginated: false,
  })

  const fetchRejectionReasons = (params?: Record<string, any>) =>
    crud.fetchList(params)

  const getRejectionReasonById = (id: number) =>
    crud.getById(id)

  const createRejectionReason = async (data: CreateRejectionReasonDto) => {
    const result = await crud.create(data)
    return result.response
  }

  const updateRejectionReason = async (data: UpdateRejectionReasonDto & { id: number }) => {
    const { id, ...updateData } = data
    const result = await crud.update(id, updateData, { refetch: true })
    return result.response
  }

  const toggleRejectionReason = async (id: number) => {
    const response = await api.patch<RejectionReason>(`/rejection-reasons/${id}/toggle`)
    if (response.success) {
      await crud.fetchList(crud._lastFilters.value)
    }
    return response
  }

  const deleteRejectionReason = async (id: number) => {
    const result = await crud.remove(id)
    return result.response
  }

  const bulkDeleteRejectionReasons = async (ids: number[]) =>
    crud.bulkDelete(ids)

  const fetchActiveReasons = async (): Promise<Array<{ id: number; code: string; label: string }>> => {
    try {
      const response = await api.get<any>('/rejection-reasons/active')
      if (response.success && response.data) {
        return Array.isArray(response.data) ? response.data : response.data.data || []
      }
      return []
    } catch {
      return []
    }
  }

  const activeReasons = computed(() =>
    crud._items.value.filter(r => r.isActive),
  )

  const inactiveReasons = computed(() =>
    crud._items.value.filter(r => !r.isActive),
  )

  return {
    rejectionReasons: crud.items,
    loading: crud.isLoading,
    error: crud.error,
    total: crud.total,
    activeReasons,
    inactiveReasons,
    fetchRejectionReasons,
    getRejectionReasonById,
    createRejectionReason,
    updateRejectionReason,
    toggleRejectionReason,
    deleteRejectionReason,
    bulkDeleteRejectionReasons,
    fetchActiveReasons,
  }
}
