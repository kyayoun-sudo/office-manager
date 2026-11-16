<script setup lang="ts">
import type { AnnouncementMessage } from '~~/shared/types/announcement-message'
import { AlertTriangle, CheckCircle, XCircle, Trash2, Send } from 'lucide-vue-next'

interface Props {
  open: boolean
  action: 'activate' | 'deactivate' | 'delete' | 'send'
  messages: AnnouncementMessage[]
  selectedLanguage: string
  getMessageTitle: (message: AnnouncementMessage, languageCode?: string) => string
}

interface Emits {
  (e: 'update:open', value: boolean): void
  (e: 'confirm', messages: AnnouncementMessage[]): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const isProcessing = ref(false)

const actionConfig = computed(() => {
  switch (props.action) {
    case 'activate':
      return {
        title: 'Activer les announcement',
        description: 'Êtes-vous sûr de vouloir activer ces announcement ?',
        icon: CheckCircle,
        iconClass: 'text-green-600',
        confirmText: 'Activer',
        confirmClass: ''
      }
    case 'deactivate':
      return {
        title: 'Désactiver les announcement',
        description: 'Êtes-vous sûr de vouloir désactiver ces announcement ?',
        icon: XCircle,
        iconClass: 'text-orange-600',
        confirmText: 'Désactiver',
        confirmClass: 'bg-orange-600 hover:bg-orange-700 text-white'
      }
    case 'send':
      return {
        title: 'Envoyer les announcement',
        description: 'Êtes-vous sûr de vouloir envoyer ces announcement maintenant ?',
        icon: Send,
        iconClass: 'text-blue-600',
        confirmText: 'Envoyer maintenant',
        confirmClass: 'bg-blue-600 hover:bg-blue-700 text-white'
      }
    case 'delete':
      return {
        title: 'Supprimer les announcement',
        description: 'Attention ! Cette action est irréversible. Tous les announcement sélectionnés seront définitivement supprimés.',
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
  emit('confirm', props.messages)
}

const handleCancel = () => {
  emit('update:open', false)
}

// Count by status for display
const statusCounts = computed(() => {
  const active = props.messages.filter(m => m.isActive).length
  const inactive = props.messages.filter(m => !m.isActive).length
  const sent = props.messages.filter(m => m.isSent).length
  const pending = props.messages.filter(m => !m.isSent).length
  return { active, inactive, sent, pending }
})

const getTypeBadgeVariant = (type: string) => {
  const variants = {
    'feature': 'default',
    'maintenance': 'secondary',
    'security': 'destructive',
    'billing_system': 'outline',
    'general': 'outline'
  }
  return variants[type as keyof typeof variants] || 'outline'
}

const getTypeLabel = (type: string) => {
  const labels = {
    'feature': 'Fonctionnalité',
    'maintenance': 'Maintenance',
    'security': 'Sécurité',
    'billing_system': 'Facturation',
    'general': 'Général'
  }
  return labels[type as keyof typeof labels] || type
}

const getPriorityBadgeVariant = (priority: string) => {
  const variants = {
    'info': 'default',
    'medium': 'secondary',
    'high': 'outline',
    'urgent': 'destructive'
  }
  return variants[priority as keyof typeof variants] || 'default'
}

const getPriorityLabel = (priority: string) => {
  const labels = {
    'info': 'Info',
    'medium': 'Moyenne',
    'high': 'Haute',
    'urgent': 'Urgent'
  }
  return labels[priority as keyof typeof labels] || priority
}
</script>

<template>
  <UiDialog :open="props.open" @update:open="emit('update:open', $event)">
    <UiDialogContent class="max-w-4xl">
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
          <div class="flex items-center justify-between text-sm mb-2">
            <span class="font-medium">
              {{ props.messages.length }} message{{ props.messages.length > 1 ? 's' : '' }} sélectionné{{ props.messages.length > 1 ? 's' : '' }}
            </span>
          </div>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs text-muted-foreground">
            <div>
              <span class="font-medium text-green-600">{{ statusCounts.active }}</span> actif{{ statusCounts.active > 1 ? 's' : '' }}
            </div>
            <div>
              <span class="font-medium text-gray-600">{{ statusCounts.inactive }}</span> inactif{{ statusCounts.inactive > 1 ? 's' : '' }}
            </div>
            <div>
              <span class="font-medium text-blue-600">{{ statusCounts.sent }}</span> envoyé{{ statusCounts.sent > 1 ? 's' : '' }}
            </div>
            <div>
              <span class="font-medium text-orange-600">{{ statusCounts.pending }}</span> en attente
            </div>
          </div>
        </div>

        <!-- Messages List -->
        <div class="max-h-80 overflow-y-auto space-y-2">
          <div 
            v-for="message in props.messages" 
            :key="message.id"
            class="flex items-center justify-between p-4 bg-muted/30 rounded-lg"
          >
            <div class="flex items-center space-x-4 flex-1">
              <div class="space-y-1 flex-1">
                <div class="font-medium">
                  {{ props.getMessageTitle(message, props.selectedLanguage) }}
                </div>
                <div class="flex items-center space-x-2">
                  <UiBadge :variant="getPriorityBadgeVariant(message.priority)" class="text-xs">
                    {{ getPriorityLabel(message.priority) }}
                  </UiBadge>
                </div>
                <div class="text-xs text-muted-foreground">
                  {{ message.sentCount }}/{{ message.recipientsCount }} destinataires
                </div>
              </div>
            </div>
            <div class="text-right space-y-1 flex-shrink-0">
              <div class="flex items-center space-x-2">
                <UiBadge :variant="message.isActive ? 'default' : 'secondary'" class="text-xs">
                  {{ message.isActive ? 'Actif' : 'Inactif' }}
                </UiBadge>
                <UiBadge :variant="message.isSent ? 'default' : 'outline'" class="text-xs">
                  {{ message.isSent ? 'Envoyé' : 'En attente' }}
                </UiBadge>
              </div>
              <div class="text-xs text-muted-foreground">
                ID: {{ message.id }}
              </div>
            </div>
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
                Cette action supprimera définitivement les messages sélectionnés. 
                Toutes les données associées seront perdues et ne pourront pas être récupérées.
              </p>
              <ul class="mt-2 text-red-700 dark:text-red-300 text-sm list-disc list-inside space-y-1">
                <li>Les messages supprimés ne pourront plus être envoyés</li>
                <li>L'historique des envois sera perdu</li>
                <li>Cette action ne peut pas être annulée</li>
              </ul>
            </div>
          </div>
        </div>

        <!-- Warning for send action -->
        <div 
          v-if="props.action === 'send'" 
          class="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4"
        >
          <div class="flex items-start space-x-3">
            <Send class="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div class="text-sm">
              <p class="font-medium text-blue-800 dark:text-blue-200 mb-1">
                Envoi immédiat
              </p>
              <p class="text-blue-700 dark:text-blue-300">
                Les messages seront envoyés immédiatement à tous les destinataires ciblés. 
                Assurez-vous que le contenu est correct avant de confirmer.
              </p>
              <ul class="mt-2 text-blue-700 dark:text-blue-300 text-sm list-disc list-inside space-y-1">
                <li>Les messages inactifs ne seront pas envoyés</li>
                <li>Les messages déjà envoyés seront ignorés</li>
                <li>Une notification sera envoyée aux destinataires</li>
              </ul>
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