<script setup lang="ts">
import type { Specialty } from '~~/shared/types/specialty'
import { AlertTriangle, CheckCircle, XCircle, Trash2 } from 'lucide-vue-next'

interface Props {
  open: boolean
  action: 'activate' | 'deactivate' | 'delete'
  specialties: Specialty[]
  selectedLanguage: string
  getSpecialtyName: (specialty: Specialty, languageCode?: string) => string
}

interface Emits {
  (e: 'update:open', value: boolean): void
  (e: 'confirm', specialties: Specialty[]): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const isProcessing = ref(false)

const actionConfig = computed(() => {
  switch (props.action) {
    case 'activate':
      return {
        title: 'Activer les spécialités',
        description: 'Êtes-vous sûr de vouloir activer ces spécialités ?',
        icon: CheckCircle,
        iconClass: 'text-green-600',
        confirmText: 'Activer',
        confirmClass: ''
      }
    case 'deactivate':
      return {
        title: 'Désactiver les spécialités',
        description: 'Êtes-vous sûr de vouloir désactiver ces spécialités ?',
        icon: XCircle,
        iconClass: 'text-orange-600',
        confirmText: 'Désactiver',
        confirmClass: 'bg-orange-600 hover:bg-orange-700 text-white'
      }
    case 'delete':
      return {
        title: 'Supprimer les spécialités',
        description: 'Attention ! Cette action est irréversible. Toutes les données associées seront perdues.',
        icon: Trash2,
        iconClass: 'text-red-600',
        confirmText: 'Supprimer définitivement',
        confirmClass: 'bg-red-600 hover:bg-red-700 text-white'
      }
    default:
      return {
        title: '',
        description: '',
        icon: AlertTriangle,
        iconClass: '',
        confirmText: '',
        confirmClass: ''
      }
  }
})

const handleConfirm = () => {
  emit('confirm', props.specialties)
}

const handleCancel = () => {
  emit('update:open', false)
}

// Count by status for display
const statusCounts = computed(() => {
  const active = props.specialties.filter(s => s.isActive).length
  const inactive = props.specialties.filter(s => !s.isActive).length
  return { active, inactive }
})
</script>

<template>
  <UiDialog :open="props.open" @update:open="emit('update:open', $event)">
    <UiDialogContent class="max-w-2xl">
      <UiDialogHeader>
        <UiDialogTitle class="flex items-center space-x-2">
          <component :is="actionConfig.icon" :class="['h-5 w-5', actionConfig.iconClass]" />
          <span>{{ actionConfig.title }}</span>
        </UiDialogTitle>
        <UiDialogDescription>
          {{ actionConfig.description }}
        </UiDialogDescription>
      </UiDialogHeader>

      <div class="space-y-4">
        <!-- Summary -->
        <div class="bg-muted/50 rounded-lg p-4">
          <div class="flex items-center justify-between text-sm">
            <span class="font-medium">
              {{ props.specialties.length }} spécialité{{ props.specialties.length > 1 ? 's' : '' }} sélectionnée{{ props.specialties.length > 1 ? 's' : '' }}
            </span>
            <div class="flex items-center space-x-4 text-xs text-muted-foreground">
              <span>{{ statusCounts.active }} active{{ statusCounts.active > 1 ? 's' : '' }}</span>
              <span>{{ statusCounts.inactive }} inactive{{ statusCounts.inactive > 1 ? 's' : '' }}</span>
            </div>
          </div>
        </div>

        <!-- Specialty List -->
        <div class="max-h-60 overflow-y-auto space-y-2">
          <div 
            v-for="specialty in props.specialties" 
            :key="specialty.id"
            class="flex items-center justify-between p-3 bg-muted/30 rounded-lg"
          >
            <div class="flex items-center space-x-3">
              <UiBadge variant="outline" class="text-xs">{{ specialty.code }}</UiBadge>
              <span class="font-medium">{{ props.getSpecialtyName(specialty, props.selectedLanguage) }}</span>
            </div>
            <UiBadge :variant="specialty.isActive ? 'default' : 'secondary'" class="text-xs">
              {{ specialty.isActive ? 'Actif' : 'Inactif' }}
            </UiBadge>
          </div>
        </div>

        <!-- Warning for delete action -->
        <div 
          v-if="props.action === 'delete'" 
          class="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg p-4"
        >
          <div class="flex items-start space-x-3">
            <AlertTriangle class="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div class="text-sm">
              <p class="font-medium text-red-800 dark:text-red-200 mb-1">
                Attention - Action irréversible
              </p>
              <p class="text-red-700 dark:text-red-300">
                Cette action supprimera définitivement les spécialités sélectionnées. 
                Toutes les données associées seront perdues et ne pourront pas être récupérées.
              </p>
            </div>
          </div>
        </div>
      </div>

      <UiDialogFooter class="flex flex-col sm:flex-row gap-2">
        <UiButton 
          variant="outline" 
          class="w-full sm:w-auto"
          :disabled="isProcessing"
          @click="handleCancel"
        >
          Annuler
        </UiButton>
        <UiButton 
          :class="actionConfig.confirmClass"
          class="w-full sm:w-auto"
          :disabled="isProcessing"
          @click="handleConfirm"
        >
          <template v-if="isProcessing">
            <div class="mr-2 h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin"/>
            Traitement...
          </template>
          <template v-else>
            <component :is="actionConfig.icon" class="mr-2 h-4 w-4" />
            {{ actionConfig.confirmText }}
          </template>
        </UiButton>
      </UiDialogFooter>
    </UiDialogContent>
  </UiDialog>
</template>