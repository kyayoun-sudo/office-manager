import type { Timestampable } from './timestampable'
import type { UserDetails } from './auth'
import type { SubscriptionPlan, BillingInterval } from './subscription-plan'
import type { Payment } from './payment'

export interface Clinician {
  id: number
  user: UserDetails
  birthDate: string | null
  latitude: number | null
  longitude: number | null
  bio: string
  inamiNumber: string
  languages: string[]
  conventionalRates: number | null
  experienceYears: number | null
  acceptingNewPatients: boolean
  verified: boolean | null
  verifiedAt: string | null
  rejectionReason: string | null
  createdAt: string
  updatedAt: string
}


export interface Subscription extends Timestampable {
  id: number
  user: UserDetails
  clinician: Clinician | null
  subscriptionPlan: SubscriptionPlan
  status: SubscriptionStatus
  price: string
  currency: string
  startDate: string
  endDate: string | null
  trialEndDate: string | null
  canceledAt: string | null
  paymentMethod: PaymentMethod
  stripeSubscriptionId: string | null
  stripeCustomerId: string | null
  payments: Payment[]
}

export type SubscriptionStatus = 'active' | 'inactive' | 'cancelled' | 'expired' | 'suspended' | 'trialing' | 'past_due'

export type PaymentMethod = 'stripe' | 'free' | 'manual' | 'other'

export interface SubscriptionsResponse {
  success: boolean
  data: Subscription[]
  message: string
}

export interface SubscriptionResponse {
  status: number
  message: string
  timestamp: string
  data: {
    subscription: Subscription
  }
}

export interface SubscriptionDashboard {
  stats: {
    total_subscriptions: number
    active_subscriptions: string
    trialing_subscriptions: string
    canceled_subscriptions: string
    monthly_revenue: string
    annual_revenue: string
    churn_rate: number
  }
  alerts: {
    expiring_soon: number
    payment_failed: number
    renewal_due: number
  }
  recent_activities: Array<{
    id: number
    type: string
    clinician_name: string
    status: string
    updated_at: string
    plan_name: string
  }>
  revenue_trend: Array<{
    month: string
    revenue: string
    subscription_count: number
  }>
  generated_at: string
}

export interface ForceCancelRequest {
  cancelType: 'immediately' | 'end_of_period'
  cancelReason: string
  refund: boolean
}

// Types supplémentaires pour correspondre au contrôleur


export type CancelType = 'immediately' | 'at_period_end'

// Interface pour les informations du plan (simplifié, sans données Stripe)
export interface PlanInfoDto {
  id: number
  code: string
  name: string
  billingInterval: BillingInterval
  trialPeriodDays: number
  price?: number
  currency: string
}

// Interface pour la réponse d'abonnement (DTO sécurisé selon le contrôleur)
export interface SubscriptionResponseDto {
  id: number
  userId: number
  planId: number
  status: SubscriptionStatus
  isActive: boolean
  requiresSubscription: boolean
  price: string
  currency: string
  startDate: Date
  endDate?: Date
  trialEndDate?: Date
  currentPeriodStart?: Date
  currentPeriodEnd?: Date
  canceledAt?: Date
  paymentMethod: string
  plan: PlanInfoDto
  createdAt: Date
  updatedAt: Date
}

// Interface pour créer un abonnement
export interface CreateSubscriptionRequest {
  userId: number
  clinicianId?: number
  subscriptionPlanId: number
  status?: SubscriptionStatus
  price: number
  currency?: string
  startDate?: string
  endDate?: string
  trialEndDate?: string
  paymentMethod?: string
  stripeCustomerId?: string
  createInStripe?: boolean
}

// Interface pour mettre à jour un abonnement
export interface UpdateSubscriptionRequest {
  userId?: number
  clinicianId?: number
  subscriptionPlanId?: number
  status?: SubscriptionStatus
  price?: number
  currency?: string
  startDate?: string
  endDate?: string
  trialEndDate?: string
  paymentMethod?: string
  stripeCustomerId?: string
  syncWithStripe?: boolean
}

// Interface pour annuler un abonnement
export interface CancelSubscriptionRequest {
  reason?: string
  cancelType?: CancelType
  syncWithStripe?: boolean
}

// Interface pour les statistiques d'abonnements selon le service
export interface SubscriptionStats {
  total: number
  active: number
  trialing: number
  cancelled: number
  expired: number
  inactive: number
  withStripeIntegration: number
  withoutStripeIntegration: number
  mrr: number
}

// Interface pour les paramètres de pagination et filtres
export interface SubscriptionFilters {
  page?: number
  limit?: number
  sortBy?: string
  sortOrder?: 'ASC' | 'DESC'
  status?: SubscriptionStatus
  searchQuery?: string
  userId?: number
  clinicianId?: number
  planId?: number
  dateFrom?: string
  dateTo?: string
}

// Interface pour la réponse paginée
export interface PaginatedSubscriptionsResponse {
  data: SubscriptionResponseDto[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNextPage: boolean
    hasPrevPage: boolean
  }
}

// Interface pour les réponses d'API standardisées
export interface SubscriptionApiResponse<T = any> {
  success: boolean
  message: string
  data: T
}