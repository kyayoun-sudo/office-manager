import type { Timestampable } from './timestampable'
import type { UserDetails } from './auth'
import type { SubscriptionPlan } from './subscription-plan'

export interface Payment extends Timestampable {
  id: number
  subscription: {
    id: number
    user: UserDetails
    subscriptionPlan: SubscriptionPlan
    status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid'
    price: string
    currency: string
    startDate: string
    endDate: string | null
    trialEndDate: string | null
    canceledAt: string | null
    paymentMethod: string
    stripeSubscriptionId: string | null
    stripeCustomerId: string | null
  }
  amount: string
  currency: string
  status: PaymentStatus
  paymentDate: string
  stripePaymentIntentId: string | null
  stripePaymentLinkId: string | null
  failureReason: string | null
}

export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'cancelled' | 'refunded'

export interface PaymentsResponse {
  success: boolean
  data: Payment[]
  message: string
}

export interface PaymentResponse {
  success: boolean
  data: Payment
  message: string
}

export interface ForceCancelPaymentRequest {
  reason: string
}

// Types supplémentaires pour correspondre au contrôleur

// Interface pour créer un paiement
export interface CreatePaymentRequest {
  planId: number
}

// Interface pour la réponse de création de paiement
export interface PaymentCreationResponse {
  success: boolean
  message: string
  data: {
    requiresPayment: boolean
    trialEndDate?: Date
    paymentIntent?: {
      id: string
      clientSecret: string
      amount: number
      currency: string
      status: string
    }
  }
}

// Interface pour les filtres de paiements
export interface PaymentFilters {
  page?: number
  limit?: number
  sortBy?: string
  sortOrder?: 'ASC' | 'DESC'
  includeRefunded?: boolean
  status?: PaymentStatus
  subscriptionId?: number
  dateFrom?: string
  dateTo?: string
  searchQuery?: string
  userId?: number
}

// Interface pour la réponse paginée
export interface PaginatedPaymentsResponse {
  data: Payment[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNextPage: boolean
    hasPrevPage: boolean
  }
}

// Interface pour les statistiques de paiements
export interface PaymentStats {
  total: number
  pending: number
  succeeded: number
  failed: number
  cancelled: number
  refunded: number
  withStripePaymentLink: number
  withStripePaymentIntent: number
  totalRevenue: number
  revenueByCurrency: Record<string, number>
}

// Interface pour les réponses d'API standardisées
export interface PaymentApiResponse<T = any> {
  success: boolean
  message: string
  data: T
}

// Interface pour la mise à jour de paiement
export interface UpdatePaymentRequest {
  planId?: number
  syncWithStripe?: boolean
}

// Interface pour les données de PaymentIntent (réponse du contrôleur)
export interface PaymentIntentData {
  payment: Payment
  clientSecret: string
  paymentIntentId: string
}