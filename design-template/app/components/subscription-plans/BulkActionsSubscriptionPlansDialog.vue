<script setup lang="ts">
import type { SubscriptionPlan } from '~~/shared/types/subscription-plan'

interface Props {
  open: boolean
  action: 'activate' | 'deactivate' | 'delete'
  plans: SubscriptionPlan[]
  selectedLanguage: string
  getPlanName: (plan: SubscriptionPlan, languageCode?: string) => string
}

interface Emits {
  (e: 'update:open', value: boolean): void
  (e: 'confirm', plans: SubscriptionPlan[]): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const getActionText = () => {
  switch (props.action) {
    case 'activate':
      return 'activer'
    case 'deactivate':
      return 'désactiver'
    case 'delete':
      return 'supprimer'
    default:
      return 'modifier'
  }
}

const getActionColor = () => {
  switch (props.action) {
    case 'activate':
      return 'text-green-600'
    case 'deactivate':
      return 'text-orange-600'
    case 'delete':
      return 'text-red-600'
    default:
      return 'text-primary'
  }
}

const getButtonVariant = () => {
  return props.action === 'delete' ? 'destructive' : 'default'
}

const handleConfirm = () => {
  emit('confirm', props.plans)
}
</script>

<template>
  <UiDialog :open="props.open" @update:open="emit('update:open', $event)">
    <UiDialogContent class="sm:max-w-[500px]">
      <UiDialogHeader>
        <UiDialogTitle :class="getActionColor()">
          Confirmer l'action groupée
        </UiDialogTitle>
        <UiDialogDescription>
          Vous vous apprêtez à {{ getActionText() }} {{ props.plans.length }} plan{{ props.plans.length > 1 ? 's' : '' }} d'abonnement.
        </UiDialogDescription>
      </UiDialogHeader>

      <div class="space-y-4">
        <div class="max-h-60 overflow-y-auto">
          <div class="space-y-2">
            <div 
              v-for="plan in props.plans" 
              :key="plan.id"
              class="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
            >
              <div class="space-y-1">
                <div class="font-medium text-sm">
                  {{ props.getPlanName(plan, props.selectedLanguage) }}
                </div>
                <div class="text-xs text-muted-foreground">
                  ID: {{ plan.id }} - {{ plan.code }}
                </div>
              </div>
              <div class="text-right">
                <UiBadge :variant="plan.isActive ? 'default' : 'secondary'" class="text-xs">
                  {{ plan.isActive ? 'Actif' : 'Inactif' }}
                </UiBadge>
              </div>
            </div>
          </div>
        </div>

        <div v-if="props.action === 'delete'" class="rounded-lg bg-destructive/10 border border-destructive/20 p-4">
          <div class="flex items-start space-x-2">
            <div class="h-5 w-5 text-destructive mt-0.5">⚠️</div>
            <div class="space-y-1">
              <p class="text-sm font-medium text-destructive">
                Action irréversible
              </p>
              <p class="text-sm text-destructive/80">
                Cette action supprimera définitivement ces plans d'abonnement. 
                Cette action ne peut pas être annulée.
              </p>
            </div>
          </div>
        </div>
      </div>

      <UiDialogFooter class="flex gap-2">
        <UiButton 
          variant="outline"
          @click="emit('update:open', false)"
        >
          Annuler
        </UiButton>
        <UiButton 
          :variant="getButtonVariant()"
          @click="handleConfirm"
        >
          {{ getActionText().charAt(0).toUpperCase() + getActionText().slice(1) }} 
          ({{ props.plans.length }})
        </UiButton>
      </UiDialogFooter>
    </UiDialogContent>
  </UiDialog>
</template>