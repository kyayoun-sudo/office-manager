<script setup lang="ts">
import type { Subscription } from '~~/shared/types/subscription'
import { Copy, ExternalLink, Calendar, CreditCard, User, Package } from 'lucide-vue-next'

interface Props {
  open: boolean
  subscription: Subscription | null
}

interface Emits {
  (e: 'update:open', value: boolean): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const { toast } = useToast()

const getStatusBadgeVariant = (status: string) => {
  switch (status) {
    case 'active':
      return 'default'
    case 'trialing':
      return 'secondary'
    case 'past_due':
      return 'destructive'
    case 'canceled':
      return 'outline'
    case 'unpaid':
      return 'destructive'
    case 'incomplete':
      return 'outline'
    case 'paused':
      return 'secondary'
    default:
      return 'outline'
  }
}

const getStatusDisplayName = (status: string) => {
  switch (status) {
    case 'active':
      return 'Actif'
    case 'trialing':
      return 'Période d\'essai'
    case 'past_due':
      return 'En retard'
    case 'canceled':
      return 'Annulé'
    case 'unpaid':
      return 'Impayé'
    case 'incomplete':
      return 'Incomplet'
    case 'incomplete_expired':
      return 'Expiré'
    case 'paused':
      return 'En pause'
    default:
      return status
  }
}

const formatPrice = (amount: string, currency: string) => {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: currency
  }).format(parseFloat(amount))
}

const formatDateTime = (dateString: string) => {
  return new Date(dateString).toLocaleString('fr-FR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleDateString('fr-FR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}

const copyToClipboard = async (text: string, label: string) => {
  try {
    await navigator.clipboard.writeText(text)
    toast({
      title: 'Copié !',
      description: `${label} copié dans le presse-papier.`
    })
  } catch (err) {
    toast({
      title: 'Erreur',
      description: 'Impossible de copier dans le presse-papier.',
      variant: 'destructive'
    })
  }
}

const isTrialActive = (subscription: Subscription) => {
  if (!subscription.trialEndDate) return false
  return new Date(subscription.trialEndDate) > new Date()
}

const getDaysRemaining = (endDate: string) => {
  const end = new Date(endDate)
  const now = new Date()
  const diffTime = end.getTime() - now.getTime()
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  return diffDays
}
</script>

<template>
  <UiDialog :open="props.open" @update:open="emit('update:open', $event)">
    <UiDialogContent class="max-w-[90vw] sm:max-w-[700px] max-h-[90vh] overflow-y-auto" :prevent-outside-click="true">
      <UiDialogHeader>
        <UiDialogTitle class="text-primary flex items-center gap-2">
          <Package class="h-5 w-5" />
          Détails de l'abonnement
        </UiDialogTitle>
        <UiDialogDescription>
          Informations complètes sur cet abonnement
        </UiDialogDescription>
      </UiDialogHeader>

      <div v-if="props.subscription" class="space-y-6">
        <!-- Statut et informations principales -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <UiCard>
            <UiCardHeader class="pb-3">
              <UiCardTitle class="text-sm font-medium flex items-center gap-2">
                <Package class="h-4 w-4" />
                Statut de l'abonnement
              </UiCardTitle>
            </UiCardHeader>
            <UiCardContent class="space-y-3">
              <div>
                <UiBadge :variant="getStatusBadgeVariant(subscription.status)" class="text-sm">
                  {{ getStatusDisplayName(subscription.status) }}
                </UiBadge>
              </div>
              
              <div v-if="isTrialActive(subscription)" class="p-3 bg-blue-50 rounded-lg border border-blue-200">
                <div class="text-sm font-medium text-blue-900">Période d'essai active</div>
                <div class="text-xs text-blue-700 mt-1">
                  Se termine le {{ formatDate(subscription.trialEndDate!) }}
                </div>
              </div>

              <div v-if="subscription.status === 'active' && subscription.endDate" class="p-3 bg-green-50 rounded-lg border border-green-200">
                <div class="text-sm font-medium text-green-900">
                  {{ getDaysRemaining(subscription.endDate) }} jours restants
                </div>
                <div class="text-xs text-green-700 mt-1">
                  Expire le {{ formatDate(subscription.endDate) }}
                </div>
              </div>

              <div v-if="subscription.canceledAt" class="p-3 bg-red-50 rounded-lg border border-red-200">
                <div class="text-sm font-medium text-red-900">Annulé</div>
                <div class="text-xs text-red-700 mt-1">
                  Le {{ formatDateTime(subscription.canceledAt) }}
                </div>
              </div>
            </UiCardContent>
          </UiCard>

          <UiCard>
            <UiCardHeader class="pb-3">
              <UiCardTitle class="text-sm font-medium flex items-center gap-2">
                <CreditCard class="h-4 w-4" />
                Informations de facturation
              </UiCardTitle>
            </UiCardHeader>
            <UiCardContent class="space-y-3">
              <div>
                <div class="text-2xl font-bold">
                  {{ formatPrice(subscription.price, subscription.currency) }}
                </div>
                <div class="text-sm text-muted-foreground">
                  par mois
                </div>
              </div>
              
              <div class="flex items-center gap-2">
                <span class="text-sm text-muted-foreground">Méthode :</span>
                <UiBadge variant="outline">{{ subscription.paymentMethod }}</UiBadge>
              </div>
            </UiCardContent>
          </UiCard>
        </div>

        <!-- Informations de l'utilisateur -->
        <UiCard>
          <UiCardHeader class="pb-3">
            <UiCardTitle class="text-sm font-medium flex items-center gap-2">
              <User class="h-4 w-4" />
              Informations de l'utilisateur
            </UiCardTitle>
          </UiCardHeader>
          <UiCardContent class="space-y-3">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="text-sm font-medium text-muted-foreground">Nom complet</label>
                <NuxtLink
                  :to="`/users/${subscription.clinician ? subscription.clinician.user.id : subscription.user.id}`"
                  class="flex items-center gap-1.5 font-medium text-primary hover:underline"
                  @click="emit('update:open', false)"
                >
                  {{ subscription.clinician
                    ? `${subscription.clinician.user.firstName} ${subscription.clinician.user.lastName}`
                    : `${subscription.user.firstName} ${subscription.user.lastName}` }}
                  <ExternalLink class="h-3.5 w-3.5" />
                </NuxtLink>
              </div>
              
              <div>
                <label class="text-sm font-medium text-muted-foreground">Email</label>
                <div class="font-medium break-all">
                  {{ subscription.clinician ? subscription.clinician.user.email : subscription.user.email }}
                </div>
              </div>
              
              <div>
                <label class="text-sm font-medium text-muted-foreground">Type d'utilisateur</label>
                <div class="font-medium">
                  <UiBadge :variant="subscription.clinician ? 'default' : 'secondary'">
                    {{ subscription.clinician ? 'Clinicien' : 'Patient' }}
                  </UiBadge>
                </div>
              </div>
              
              <div v-if="subscription.clinician">
                <label class="text-sm font-medium text-muted-foreground">Numéro INAMI</label>
                <div class="font-medium">{{ subscription.clinician.inamiNumber || 'Non renseigné' }}</div>
              </div>
            </div>
          </UiCardContent>
        </UiCard>

        <!-- Plan d'abonnement -->
        <UiCard>
          <UiCardHeader class="pb-3">
            <UiCardTitle class="text-sm font-medium flex items-center gap-2">
              <Package class="h-4 w-4" />
              Plan d'abonnement
            </UiCardTitle>
          </UiCardHeader>
          <UiCardContent>
            <div class="font-medium text-lg">{{ subscription.subscriptionPlan.name }}</div>
          </UiCardContent>
        </UiCard>

        <!-- Dates importantes -->
        <UiCard>
          <UiCardHeader class="pb-3">
            <UiCardTitle class="text-sm font-medium flex items-center gap-2">
              <Calendar class="h-4 w-4" />
              Dates importantes
            </UiCardTitle>
          </UiCardHeader>
          <UiCardContent class="space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="text-sm font-medium text-muted-foreground">Date de début</label>
                <div class="font-medium">{{ formatDateTime(subscription.startDate) }}</div>
              </div>
              
              <div>
                <label class="text-sm font-medium text-muted-foreground">Date de fin</label>
                <div class="font-medium">
                  {{ subscription.endDate ? formatDateTime(subscription.endDate) : 'Aucune date de fin' }}
                </div>
              </div>
            </div>

            <div v-if="subscription.trialEndDate" class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="text-sm font-medium text-muted-foreground">Fin de la période d'essai</label>
                <div class="font-medium">{{ formatDateTime(subscription.trialEndDate) }}</div>
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="text-sm font-medium text-muted-foreground">Créé le</label>
                <div class="font-medium">{{ formatDateTime(subscription.createdAt) }}</div>
              </div>
              
              <div>
                <label class="text-sm font-medium text-muted-foreground">Dernière modification</label>
                <div class="font-medium">{{ formatDateTime(subscription.updatedAt) }}</div>
              </div>
            </div>
          </UiCardContent>
        </UiCard>

        <!-- Informations Stripe -->
        <UiCard v-if="subscription.stripeSubscriptionId || subscription.stripeCustomerId">
          <UiCardHeader class="pb-3">
            <UiCardTitle class="text-sm font-medium flex items-center gap-2">
              <ExternalLink class="h-4 w-4" />
              Identifiants Stripe
            </UiCardTitle>
          </UiCardHeader>
          <UiCardContent class="space-y-3">
            <div v-if="subscription.stripeSubscriptionId">
              <label class="text-sm font-medium text-muted-foreground">ID Abonnement Stripe</label>
              <div class="flex items-center gap-2 mt-1">
                <code class="text-sm bg-muted px-2 py-1 rounded font-mono break-all">
                  {{ subscription.stripeSubscriptionId }}
                </code>
                <UiButton
                  variant="ghost"
                  size="sm"
                  @click="copyToClipboard(subscription.stripeSubscriptionId, 'ID Abonnement')"
                >
                  <Copy class="h-4 w-4" />
                </UiButton>
              </div>
            </div>

            <div v-if="subscription.stripeCustomerId">
              <label class="text-sm font-medium text-muted-foreground">ID Client Stripe</label>
              <div class="flex items-center gap-2 mt-1">
                <code class="text-sm bg-muted px-2 py-1 rounded font-mono break-all">
                  {{ subscription.stripeCustomerId }}
                </code>
                <UiButton
                  variant="ghost"
                  size="sm"
                  @click="copyToClipboard(subscription.stripeCustomerId, 'ID Client')"
                >
                  <Copy class="h-4 w-4" />
                </UiButton>
              </div>
            </div>
          </UiCardContent>
        </UiCard>
        
        <!-- Section des paiements -->
        <UiCard v-if="subscription.payments && subscription.payments.length > 0">
          <UiCardHeader class="pb-3">
            <UiCardTitle class="text-sm font-medium flex items-center gap-2">
              <CreditCard class="h-4 w-4" />
              Historique des paiements ({{ subscription.payments.length }} paiements)
            </UiCardTitle>
          </UiCardHeader>
          <UiCardContent>
            <div class="space-y-2 max-h-48 overflow-y-auto">
              <div 
                v-for="payment in subscription.payments.slice(0, 10)" 
                :key="payment.id" 
                class="flex items-center justify-between p-2 border rounded-lg"
              >
                <div class="flex-1">
                  <div class="font-medium">{{ formatPrice(payment.amount, payment.currency) }}</div>
                  <div class="text-sm text-muted-foreground">{{ formatDate(payment.paymentDate) }}</div>
                </div>
                <UiBadge :variant="payment.status === 'succeeded' ? 'default' : payment.status === 'pending' ? 'secondary' : 'destructive'">
                  {{ payment.status === 'succeeded' ? 'Réussi' : payment.status === 'pending' ? 'En attente' : 'Échoué' }}
                </UiBadge>
              </div>
              <div v-if="subscription.payments.length > 10" class="text-sm text-muted-foreground text-center pt-2">
                ... et {{ subscription.payments.length - 10 }} autres paiements
              </div>
            </div>
          </UiCardContent>
        </UiCard>
      </div>

      <UiDialogFooter class="flex flex-col sm:flex-row gap-2">
        <UiButton variant="outline" class="w-full sm:w-auto" @click="emit('update:open', false)">
          <span class="truncate">Fermer</span>
        </UiButton>
      </UiDialogFooter>
    </UiDialogContent>
  </UiDialog>
</template>