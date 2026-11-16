<template>
  <UiDialog :open="open" @update:open="$emit('update:open', $event)">
    <UiDialogContent :prevent-outside-click="true" class="max-w-[90vw] sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
      <UiDialogHeader>
        <UiDialogTitle>Détails du signalement #{{ report?.id }}</UiDialogTitle>
        <UiDialogDescription>
          Informations complètes du signalement
        </UiDialogDescription>
      </UiDialogHeader>
      
      <div v-if="report" class="space-y-6">
        <div class="grid grid-cols-2 gap-6">
          <div class="space-y-4">
            <div>
              <UiLabel class="text-sm font-medium text-gray-500">Type de signalement</UiLabel>
              <div class="mt-1">
                <UiBadge variant="outline">
                  {{ getReportTypeLabel(report.reportType) }}
                </UiBadge>
              </div>
            </div>
            
            <div>
              <UiLabel class="text-sm font-medium text-gray-500">Catégorie</UiLabel>
              <p class="mt-1 text-sm">{{ report.category }}</p>
            </div>
            
            <div>
              <UiLabel class="text-sm font-medium text-gray-500">Statut</UiLabel>
              <div class="mt-1">
                <UiBadge :variant="getStatusVariant(report.status)">
                  {{ getStatusLabel(report.status) }}
                </UiBadge>
              </div>
            </div>
            
            <div>
              <UiLabel class="text-sm font-medium text-gray-500">Priorité</UiLabel>
              <div class="mt-1">
                <UiBadge :variant="getPriorityVariant(report.priority)">
                  {{ getPriorityLabel(report.priority) }}
                </UiBadge>
              </div>
            </div>
          </div>
          
          <div class="space-y-4">
            <div>
              <UiLabel class="text-sm font-medium text-gray-500">Signaleur</UiLabel>
              <p class="mt-1 text-sm font-medium">{{ report.reporterName }}</p>
            </div>
            
            <div>
              <UiLabel class="text-sm font-medium text-gray-500">Personne signalée</UiLabel>
              <p class="mt-1 text-sm font-medium">{{ report.reportedName }}</p>
            </div>
            
            <div>
              <UiLabel class="text-sm font-medium text-gray-500">Date de création</UiLabel>
              <p class="mt-1 text-sm">{{ formatDate(report.createdAt) }}</p>
            </div>
            
            <div>
              <UiLabel class="text-sm font-medium text-gray-500">Jours ouverts</UiLabel>
              <div class="mt-1 flex items-center gap-2">
                <Clock class="h-4 w-4 text-muted-foreground" />
                <span class="text-sm">{{ report.daysOpen }} jour(s)</span>
              </div>
            </div>

            <div v-if="report.assignedToName">
              <UiLabel class="text-sm font-medium text-gray-500">Assigné à</UiLabel>
              <p class="mt-1 text-sm">{{ report.assignedToName }}</p>
            </div>
          </div>
        </div>
        
        <AppDivider />
        
        <div>
          <UiLabel class="text-sm font-medium text-gray-500">Description du signalement</UiLabel>
          <div class="mt-2 p-4 bg-gray-50 rounded-lg border">
            <p class="text-sm whitespace-pre-wrap">{{ report.description }}</p>
          </div>
        </div>

        <div v-if="report.adminNotes">
          <UiLabel class="text-sm font-medium text-gray-500">Notes administratives</UiLabel>
          <div class="mt-2 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <p class="text-sm whitespace-pre-wrap">{{ report.adminNotes }}</p>
          </div>
        </div>

        <div v-if="report.resolutionDetails">
          <UiLabel class="text-sm font-medium text-gray-500">Détails de résolution</UiLabel>
          <div class="mt-2 p-4 bg-green-50 rounded-lg border border-green-200">
            <p class="text-sm whitespace-pre-wrap">{{ report.resolutionDetails }}</p>
          </div>
        </div>
        
        <div v-if="report.resolved" class="flex items-center gap-2 text-green-600">
          <CheckCircle class="h-5 w-5" />
          <span class="text-sm font-medium">Signalement résolu</span>
        </div>
      </div>
      
      <UiDialogFooter class="flex flex-col sm:flex-row gap-2">
        <UiButton 
          variant="outline" 
          class="w-full sm:w-auto"
          @click="$emit('update:open', false)"
        >
          <span class="truncate">Fermer</span>
        </UiButton>
      </UiDialogFooter>
    </UiDialogContent>
  </UiDialog>
</template>

<script setup lang="ts">
import { Clock, CheckCircle } from 'lucide-vue-next'
import type { Report } from '~~/shared/types/report'

interface Props {
  open: boolean
  report: Report | null
}

defineProps<Props>()

defineEmits<{
  'update:open': [value: boolean]
}>()

const { getReportTypeLabel, getStatusLabel, getPriorityLabel, getStatusVariant, getPriorityVariant } = useReports()

const formatDate = (dateString: string) => {
  return new Intl.DateTimeFormat('fr-FR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(dateString))
}
</script>