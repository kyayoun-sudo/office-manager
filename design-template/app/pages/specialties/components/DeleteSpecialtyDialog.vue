<script setup lang="ts">
import type { Specialty } from '~~/shared/types/specialty'
import { AlertTriangle, Trash2 } from 'lucide-vue-next'

interface Props {
  open: boolean
  specialty: Specialty | null
}

interface Emits {
  (e: 'update:open', value: boolean): void
  (e: 'specialtyDeleted'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const { deleteSpecialty } = useSpecialties()
const toast = useToast()

const isLoading = ref(false)

const getCategoryDisplayName = (category: string) => {
  switch (category) {
    case 'CONSULTATION':
      return 'Consultation'
    case 'REEDUCATION':
      return 'Rééducation'
    case 'BIEN_ETRE':
      return 'Bien-être'
    default:
      return category
  }
}

const handleDelete = async () => {
  if (!props.specialty) return
  
  isLoading.value = true
  
  const response = await deleteSpecialty(props.specialty.id)
  
  if (response.success) {
    toast.handleApiSuccess('Spécialité supprimée avec succès')
    emit('specialtyDeleted')
    emit('update:open', false)
  } else {
    toast.handleApiError(response, 'Erreur lors de la suppression')
  }
  
  isLoading.value = false
}
</script>

<template>
  <UiDialog :open="props.open" @update:open="emit('update:open', $event)">
    <UiDialogContent :prevent-outside-click="true" class="max-w-[90vw] sm:max-w-[425px] max-h-[90vh] overflow-y-auto">
      <UiDialogHeader>
        <UiDialogTitle class="text-destructive">Supprimer la spécialité</UiDialogTitle>
        <UiDialogDescription>
          Cette action est irréversible. Êtes-vous sûr de vouloir supprimer cette spécialité ?
        </UiDialogDescription>
      </UiDialogHeader>

      <div v-if="props.specialty" class="py-4">
        <div class="flex items-center gap-4 p-4 bg-muted rounded-lg">
          <div class="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 flex-shrink-0">
            <span class="text-lg font-semibold text-primary">
              {{ props.specialty.code.substring(0, 2) }}
            </span>
          </div>
          
          <div class="flex-1 min-w-0">
            <p class="font-medium">{{ props.specialty.name }}</p>
            <p class="text-sm text-muted-foreground">
              {{ getCategoryDisplayName(props.specialty.category) }} • {{ props.specialty.code }}
            </p>
            <p v-if="props.specialty.description" class="text-xs text-muted-foreground mt-1">
              {{ props.specialty.description }}
            </p>
          </div>
        </div>
        
        <div class="mt-4 p-4 border border-destructive/20 bg-destructive/5 rounded-lg">
          <div class="flex items-center gap-2 text-destructive">
            <AlertTriangle class="h-4 w-4" />
            <span class="font-medium">Attention</span>
          </div>
          <p class="text-sm text-muted-foreground mt-2">
            Toutes les données associées à cette spécialité seront définitivement perdues.
          </p>
        </div>
      </div>

      <UiDialogFooter class="flex flex-col sm:flex-row gap-2">
        <UiButton 
          variant="outline" 
          class="w-full sm:w-auto"
          :disabled="isLoading"
          @click="emit('update:open', false)"
        >
          <span class="truncate">Annuler</span>
        </UiButton>
        <UiButton 
          variant="destructive"
          class="w-full sm:w-auto"
          :disabled="isLoading"
          @click="handleDelete"
        >
          <template v-if="isLoading">
            <AppSpinner class="mr-2 h-4 w-4" />
            <span class="truncate">Suppression...</span>
          </template>
          <template v-else>
            <Trash2 class="mr-2 h-4 w-4" />
            <span class="truncate">Supprimer définitivement</span>
          </template>
        </UiButton>
      </UiDialogFooter>
    </UiDialogContent>
  </UiDialog>
</template>