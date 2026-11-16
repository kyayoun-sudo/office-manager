export const usePagination = <T>(items: Ref<T[]>, defaultItemsPerPage: number = 10) => {
  // Pagination state
  const currentPage = ref(1)
  const itemsPerPage = ref(defaultItemsPerPage)
  const itemsPerPageOptions = [5, 10, 20, 50]

  // Computed properties
  const totalItems = computed(() => items.value.length)
  const totalPages = computed(() => Math.ceil(totalItems.value / itemsPerPage.value))

  const paginatedItems = computed(() => {
    const start = (currentPage.value - 1) * itemsPerPage.value
    const end = start + itemsPerPage.value
    return items.value.slice(start, end)
  })

  const paginationInfo = computed(() => {
    const start = totalItems.value === 0 ? 0 : (currentPage.value - 1) * itemsPerPage.value + 1
    const end = Math.min(currentPage.value * itemsPerPage.value, totalItems.value)
    return { start, end, total: totalItems.value }
  })

  // Pagination functions
  const goToPage = (page: number) => {
    if (page >= 1 && page <= totalPages.value) {
      currentPage.value = page
    }
  }

  const goToFirstPage = () => goToPage(1)
  const goToLastPage = () => goToPage(totalPages.value)
  const goToPreviousPage = () => goToPage(currentPage.value - 1)
  const goToNextPage = () => goToPage(currentPage.value + 1)

  const changeItemsPerPage = (newItemsPerPage: number) => {
    itemsPerPage.value = newItemsPerPage
    currentPage.value = 1
  }

  const resetPagination = () => {
    currentPage.value = 1
  }

  const getVisiblePages = (): (number | string)[] => {
    const total = totalPages.value
    const current = currentPage.value
    
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1)
    }
    
    if (current <= 4) {
      return [1, 2, 3, 4, 5, '...', total]
    }
    
    if (current >= total - 3) {
      return [1, '...', total - 4, total - 3, total - 2, total - 1, total]
    }
    
    return [1, '...', current - 1, current, current + 1, '...', total]
  }

  return {
    // State
    currentPage,
    itemsPerPage,
    itemsPerPageOptions,
    
    // Computed
    totalItems,
    totalPages,
    paginatedItems,
    paginationInfo,
    
    // Functions
    goToPage,
    goToFirstPage,
    goToLastPage,
    goToPreviousPage,
    goToNextPage,
    changeItemsPerPage,
    resetPagination,
    getVisiblePages
  }
}