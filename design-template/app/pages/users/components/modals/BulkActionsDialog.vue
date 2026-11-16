<script setup lang="ts">
import { CheckCircle2, XCircle, Trash2, AlertTriangle } from 'lucide-vue-next'

interface Props {
  open: boolean
  action: 'activate' | 'deactivate' | 'delete'
  selectedCount: number
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  'confirm': []
}>()

const isLoading = ref(false)

const actionConfig = computed(() => {
  switch (props.action) {
    case 'activate':
      return {
        title: 'Activer les utilisateurs',
        description: `Voulez-vous vraiment activer ${props.selectedCount} utilisateur${props.selectedCount > 1 ? 's' : ''} ?`,
        icon: CheckCircle2,
        iconClass: 'text-green-600',
        confirmText: 'Activer',
        confirmClass: ''
      }
    case 'deactivate':
      return {
        title: 'Désactiver les utilisateurs',
        description: `Voulez-vous vraiment désactiver ${props.selectedCount} utilisateur${props.selectedCount > 1 ? 's' : ''} ?`,
        icon: XCircle,
        iconClass: 'text-orange-600',
        confirmText: 'Désactiver',
        confirmClass: 'bg-orange-600 hover:bg-orange-700'
      }
    case 'delete':
      return {
        title: 'Supprimer les utilisateurs',
        description: `Voulez-vous vraiment supprimer ${props.selectedCount} utilisateur${props.selectedCount > 1 ? 's' : ''} ? Cette action est irréversible.`,
        icon: Trash2,
        iconClass: 'text-red-600',
        confirmText: 'Supprimer',
        confirmClass: 'bg-red-600 hover:bg-red-700'
      }
  }
})

const handleConfirm = async () => {
  isLoading.value = true
  emit('confirm')
  // Note: isLoading will be reset when dialog closes
}

const handleClose = () => {
  if (!isLoading.value) {
    emit('update:open', false)
  }
}

watch(() => props.open, (newOpen) => {
  if (!newOpen) {
    isLoading.value = false
  }
})
</script>

<template>
  <UiDialog :open="open" @update:open="handleClose">
    <UiDialogContent class="sm:max-w-md">
      <UiDialogHeader>
        <UiDialogTitle class="flex items-center space-x-2">
          <component :is="actionConfig.icon" :class="['h-5 w-5', actionConfig.iconClass]" />
          <span>{{ actionConfig.title }}</span>
        </UiDialogTitle>
        <UiDialogDescription>
          {{ actionConfig.description }}
        </UiDialogDescription>
      </UiDialogHeader>

      <div v-if="action === 'delete'" class="flex items-center space-x-2 p-3 bg-red-50 rounded-lg border border-red-200">
        <AlertTriangle class="h-5 w-5 text-red-600 flex-shrink-0" />
        <p class="text-sm text-red-800">
          <strong>Attention :</strong> Les données des utilisateurs supprimés ne pourront pas être récupérées.
        </p>
      </div>

      <UiDialogFooter>
        <UiButton
          variant="outline"
          :disabled="isLoading"
          @click="handleClose"
        >
          Annuler
        </UiButton>
        <UiButton
          :class="actionConfig.confirmClass"
          :disabled="isLoading"
          @click="handleConfirm"
        >
          <div v-if="isLoading" class="mr-2 h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin"/>
          {{ actionConfig.confirmText }}
        </UiButton>
      </UiDialogFooter>
    </UiDialogContent>
  </UiDialog>
</template>