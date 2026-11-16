<template>
  <UiDialog :open="open" @update:open="emit('update:open', $event)">
    <UiDialogContent
      :prevent-outside-click="true"
      class="max-h-[90vh] max-w-[90vw] overflow-hidden p-0 sm:max-w-[680px]"
    >
      <div class="flex h-full max-h-[90vh] flex-col">
        <div
          v-if="payment"
          class="flex-shrink-0 border-b px-6 pb-5 pt-6"
          :class="headerGradient"
        >
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <p class="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                Paiement #{{ payment.id }}
              </p>
              <p class="mt-1 text-2xl font-bold tracking-tight text-foreground">
                {{ formatPrice(payment.amount, payment.currency) }}
              </p>
              <p class="mt-1 text-[13px] text-muted-foreground">
                {{ formatDate(payment.paymentDate) }}
              </p>
            </div>
            <span
              :class="[
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold',
                statusStyle.classes,
              ]"
            >
              <component :is="statusStyle.icon" class="h-3 w-3" />
              {{ statusStyle.label }}
            </span>
          </div>
        </div>

        <div v-if="payment" class="flex-1 overflow-y-auto">
          <div class="divide-y divide-border">
            <section v-if="payment.failureReason" class="px-6 py-4">
              <div class="rounded-lg border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20 px-3.5 py-2.5">
                <p class="text-[11px] font-semibold uppercase tracking-wider text-red-400 dark:text-red-500">Raison de l'echec</p>
                <p class="mt-0.5 text-[13px] text-red-700 dark:text-red-300">{{ getFailureLabel(payment.failureReason) }}</p>
              </div>
            </section>

            <section class="px-6 py-5">
              <h3 class="mb-3.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Details financiers
              </h3>
              <dl class="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
                <div>
                  <dt class="text-[13px] font-medium text-muted-foreground">Montant</dt>
                  <dd class="mt-0.5 text-[13px] font-semibold text-foreground">
                    {{ formatPrice(payment.amount, payment.currency) }}
                  </dd>
                </div>
                <div>
                  <dt class="text-[13px] font-medium text-muted-foreground">Devise</dt>
                  <dd class="mt-0.5 text-[13px] text-foreground">{{ payment.currency.toUpperCase() }}</dd>
                </div>
                <div>
                  <dt class="text-[13px] font-medium text-muted-foreground">Methode</dt>
                  <dd class="mt-0.5 text-[13px] text-foreground">{{ payment.subscription?.paymentMethod || '-' }}</dd>
                </div>
                <div>
                  <dt class="text-[13px] font-medium text-muted-foreground">Date</dt>
                  <dd class="mt-0.5 text-[13px] text-foreground">{{ formatDate(payment.paymentDate) }}</dd>
                </div>
              </dl>
              <div
                v-if="payment.stripePaymentIntentId || payment.stripePaymentLinkId"
                class="mt-4 border-t border-dashed border-border pt-3.5"
              >
                <dl class="grid grid-cols-1 gap-y-2">
                  <div v-if="payment.stripePaymentIntentId">
                    <dt class="text-[13px] font-medium text-muted-foreground">Stripe Payment Intent</dt>
                    <dd class="mt-0.5 font-mono text-[12px] tracking-wide text-muted-foreground">
                      {{ payment.stripePaymentIntentId }}
                    </dd>
                  </div>
                  <div v-if="payment.stripePaymentLinkId">
                    <dt class="text-[13px] font-medium text-muted-foreground">Stripe Payment Link</dt>
                    <dd class="mt-0.5 font-mono text-[12px] tracking-wide text-muted-foreground">
                      {{ payment.stripePaymentLinkId }}
                    </dd>
                  </div>
                </dl>
              </div>
            </section>

            <section class="px-6 py-5">
              <h3 class="mb-3.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Utilisateur
              </h3>
              <div class="flex items-center gap-3">
                <UiAvatar class="h-10 w-10 ring-1 ring-border">
                  <UiAvatarImage
                    :src="`https://api.dicebear.com/7.x/initials/svg?seed=${payment.subscription.user.firstName} ${payment.subscription.user.lastName}`"
                    :alt="userName"
                  />
                  <UiAvatarFallback class="bg-muted text-xs font-semibold text-muted-foreground">
                    {{ payment.subscription.user.firstName?.[0] }}{{ payment.subscription.user.lastName?.[0] }}
                  </UiAvatarFallback>
                </UiAvatar>
                <div class="min-w-0">
                  <p class="text-[13px] font-semibold text-foreground">{{ userName }}</p>
                  <p class="text-[12px] text-muted-foreground">{{ payment.subscription.user.email }}</p>
                </div>
              </div>
              <dl class="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
                <div v-if="payment.subscription.user.phone">
                  <dt class="text-[13px] font-medium text-muted-foreground">Telephone</dt>
                  <dd class="mt-0.5 text-[13px] text-foreground">{{ payment.subscription.user.phone }}</dd>
                </div>
                <div>
                  <dt class="text-[13px] font-medium text-muted-foreground">Role</dt>
                  <dd class="mt-0.5 text-[13px] text-foreground">
                    {{ payment.subscription.user.role?.description || payment.subscription.user.role?.name || '-' }}
                  </dd>
                </div>
              </dl>
            </section>

            <section class="px-6 py-5">
              <h3 class="mb-3.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Abonnement
              </h3>
              <dl class="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
                <div>
                  <dt class="text-[13px] font-medium text-muted-foreground">Plan</dt>
                  <dd class="mt-0.5 text-[13px] font-medium text-foreground">
                    {{ payment.subscription.subscriptionPlan?.translations?.[0]?.name || payment.subscription.subscriptionPlan?.code || '-' }}
                  </dd>
                </div>
                <div>
                  <dt class="text-[13px] font-medium text-muted-foreground">Statut</dt>
                  <dd class="mt-0.5 flex items-center gap-1.5">
                    <span
                      :class="[
                        'inline-block h-1.5 w-1.5 rounded-full',
                        payment.subscription.status === 'active' ? 'bg-emerald-500' : 'bg-muted-foreground/40',
                      ]"
                    />
                    <span class="text-[13px] text-foreground">{{ subscriptionStatusLabel }}</span>
                  </dd>
                </div>
                <div>
                  <dt class="text-[13px] font-medium text-muted-foreground">Prix</dt>
                  <dd class="mt-0.5 text-[13px] text-foreground">
                    {{ formatPrice(payment.subscription.price, payment.subscription.currency) }}
                  </dd>
                </div>
                <div v-if="payment.subscription.trialEndDate">
                  <dt class="text-[13px] font-medium text-muted-foreground">Fin d'essai</dt>
                  <dd class="mt-0.5 text-[13px] text-foreground">{{ formatDate(payment.subscription.trialEndDate) }}</dd>
                </div>
              </dl>
            </section>

            <section v-if="payment.createdAt || payment.updatedAt" class="px-6 py-5">
              <h3 class="mb-3.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Historique
              </h3>
              <div class="flex flex-col gap-2.5 sm:flex-row sm:gap-8">
                <div v-if="payment.createdAt" class="flex items-center gap-2.5">
                  <div class="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                    <CalendarPlus class="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div>
                    <p class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Cree le</p>
                    <p class="text-[13px] font-medium text-foreground">{{ formatDate(payment.createdAt) }}</p>
                  </div>
                </div>
                <div v-if="payment.updatedAt" class="flex items-center gap-2.5">
                  <div class="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                    <RefreshCw class="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div>
                    <p class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Modifie le</p>
                    <p class="text-[13px] font-medium text-foreground">{{ formatDate(payment.updatedAt) }}</p>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>

        <div class="flex items-center justify-end border-t bg-muted/50 px-6 py-3.5">
          <UiButton
            variant="outline"
            size="sm"
            class="px-5"
            @click="emit('update:open', false)"
          >
            Fermer
          </UiButton>
        </div>
      </div>
    </UiDialogContent>
  </UiDialog>
</template>

<script setup lang="ts">
import type { Payment } from '~~/shared/types/payment'
import {
  CheckCircle2,
  Clock,
  XCircle,
  RotateCcw,
  AlertCircle,
  CalendarPlus,
  RefreshCw,
} from 'lucide-vue-next'
import type { Component } from 'vue'

const props = defineProps<{
  payment: Payment | null
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const formatPrice = (amount: string, currency: string) => {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
  }).format(parseFloat(amount))
}

const formatDate = (dateString: string) => {
  return new Intl.DateTimeFormat('fr-FR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(dateString))
}

const userName = computed(() => {
  const u = props.payment?.subscription?.user
  return u ? `${u.firstName} ${u.lastName}`.trim() : '-'
})

const statusConfig: Record<string, { label: string; icon: Component; classes: string; gradient: string }> = {
  succeeded: {
    label: 'Reussi',
    icon: CheckCircle2 as Component,
    classes: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400',
    gradient: 'bg-gradient-to-br from-emerald-50/80 via-background to-emerald-50/40 dark:from-emerald-950/20 dark:via-background dark:to-emerald-950/10',
  },
  pending: {
    label: 'En attente',
    icon: Clock as Component,
    classes: 'bg-sky-100 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400',
    gradient: 'bg-gradient-to-br from-sky-50/80 via-background to-sky-50/40 dark:from-sky-950/20 dark:via-background dark:to-sky-950/10',
  },
  failed: {
    label: 'Echoue',
    icon: XCircle as Component,
    classes: 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400',
    gradient: 'bg-gradient-to-br from-red-50/60 via-background to-red-50/30 dark:from-red-950/20 dark:via-background dark:to-red-950/10',
  },
  cancelled: {
    label: 'Annule',
    icon: XCircle as Component,
    classes: 'bg-muted text-foreground',
    gradient: 'bg-gradient-to-br from-muted/80 via-background to-muted/40',
  },
  refunded: {
    label: 'Rembourse',
    icon: RotateCcw as Component,
    classes: 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400',
    gradient: 'bg-gradient-to-br from-amber-50/60 via-background to-amber-50/30 dark:from-amber-950/20 dark:via-background dark:to-amber-950/10',
  },
}

const fallbackStatus = {
  label: 'Inconnu',
  icon: AlertCircle as Component,
  classes: 'bg-muted text-muted-foreground',
  gradient: 'bg-gradient-to-br from-muted/80 via-background to-muted/40',
}

const statusStyle = computed(() => {
  return statusConfig[props.payment?.status ?? ''] ?? fallbackStatus
})

const headerGradient = computed(() => statusStyle.value.gradient)

const subscriptionStatusLabels: Record<string, string> = {
  active: 'Actif',
  trialing: "Periode d'essai",
  past_due: 'Impaye',
  canceled: 'Annule',
  unpaid: 'Non paye',
}

const subscriptionStatusLabel = computed(() => {
  const s = props.payment?.subscription?.status
  return s ? subscriptionStatusLabels[s] ?? s : '-'
})

const failureLabels: Record<string, string> = {
  card_declined: 'Carte refusee',
  insufficient_funds: 'Fonds insuffisants',
  expired_card: 'Carte expiree',
  processing_error: 'Erreur de traitement',
  authentication_required: 'Authentification requise',
}

const getFailureLabel = (reason: string) => failureLabels[reason] ?? reason
</script>
