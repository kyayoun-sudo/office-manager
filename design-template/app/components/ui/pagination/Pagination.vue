<script setup lang="ts">
interface Props {
  currentPage: number
  totalPages: number
  totalItems: number
  itemsPerPage: number
  itemsPerPageOptions: number[]
  paginationInfo: {
    start: number
    end: number
    total: number
  }
  getVisiblePages: () => (number | string)[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'go-to-page': [page: number]
  'go-to-first': []
  'go-to-last': []
  'go-to-previous': []
  'go-to-next': []
  'change-items-per-page': [itemsPerPage: number]
}>()
</script>

<template>
  <div v-if="totalItems > 0" class="flex flex-col sm:flex-row items-center justify-between gap-4 mt-4 pt-4 border-t">
    <!-- Items per page selector -->
    <div class="flex items-center space-x-2">
      <span class="text-sm text-muted-foreground">Éléments par page:</span>
      <UiSelect :model-value="itemsPerPage.toString()" @update:model-value="emit('change-items-per-page', parseInt($event))">
        <UiSelectTrigger class="w-20 h-8">
          <UiSelectValue />
        </UiSelectTrigger>
        <UiSelectContent>
          <UiSelectItem 
            v-for="option in itemsPerPageOptions" 
            :key="option"
            :value="option.toString()"
          >
            {{ option }}
          </UiSelectItem>
        </UiSelectContent>
      </UiSelect>
    </div>

    <!-- Pagination info and controls -->
    <div class="flex items-center space-x-4">
      <span class="text-sm text-muted-foreground">
        {{ paginationInfo.start }}-{{ paginationInfo.end }} sur {{ paginationInfo.total }}
      </span>
      
      <div class="flex items-center space-x-1">
        <UiButton
          variant="outline"
          size="sm"
          :disabled="currentPage === 1"
          @click="emit('go-to-first')"
        >
          <span class="sr-only">Première page</span>
          &#171;
        </UiButton>
        
        <UiButton
          variant="outline"
          size="sm"
          :disabled="currentPage === 1"
          @click="emit('go-to-previous')"
        >
          <span class="sr-only">Page précédente</span>
          &#8249;
        </UiButton>
        
        <div class="flex items-center space-x-1">
          <template v-for="page in getVisiblePages()" :key="page">
            <UiButton
              v-if="page !== '...'"
              variant="outline"
              size="sm"
              :class="{ 'bg-primary text-primary-foreground': currentPage === page }"
              @click="emit('go-to-page', page as number)"
            >
              {{ page }}
            </UiButton>
            <span v-else class="px-2 text-muted-foreground">...</span>
          </template>
        </div>
        
        <UiButton
          variant="outline"
          size="sm"
          :disabled="currentPage === totalPages"
          @click="emit('go-to-next')"
        >
          <span class="sr-only">Page suivante</span>
          &#8250;
        </UiButton>
        
        <UiButton
          variant="outline"
          size="sm"
          :disabled="currentPage === totalPages"
          @click="emit('go-to-last')"
        >
          <span class="sr-only">Dernière page</span>
          &#187;
        </UiButton>
      </div>
    </div>
  </div>
</template>