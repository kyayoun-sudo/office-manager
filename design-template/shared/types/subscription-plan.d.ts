import type { Timestampable } from './timestampable'
import type { Language } from './language'

export interface SimpleSubscription {
  id: number
  status: 'active' | 'inactive' | 'canceled' | 'expired' | 'trialing' | 'past_due' | 'unpaid' | 'incomplete' | 'incomplete_expired' | 'paused'
  price: string
  currency: string
  startDate: string
  endDate: string | null
  trialEndDate: string | null
  canceledAt: string | null
  paymentMethod: 'stripe' | 'free' | 'manual'
  stripeSubscriptionId: string | null
  stripeCustomerId: string | null
  createdAt: string
  updatedAt: string
}

export interface SubscriptionPlanTranslation {
  id: number
  language: Language
  name: string
  description: string
  features: string[]
}

// Interface principale selon le controller réel
export interface Plan {
  id: number
  code: string
  price: string
  promotionalPrice?: string
  promotionalDurationMonths?: number
  vatRate?: number
  currency: string
  billingInterval: 'day' | 'week' | 'month' | 'quarter' | 'semester' | 'year'
  trialPeriodDays: number
  isActive: boolean
  isPublic?: boolean
  displayOrder: number
  stripeProductId?: string | null
  stripePriceId?: string | null
  features: string[]
  translations: PlanTranslation[]
  createdAt: string
  updatedAt: string
}

// Interface pour les traductions du controller
export interface PlanTranslation {
  language: {
    id: number
    code: string
    name: string
  }
  name: string
  description: string
  features?: string
}

// Interface pour créer une traduction
export interface CreatePlanTranslationData {
  languageCode: string
  name: string
  description: string
  features?: string
}

// Interface pour créer un plan selon le controller
export interface CreatePlanRequest {
  code: string
  name?: string
  description?: string
  price: number
  promotionalPrice?: number
  promotionalDurationMonths?: number
  vatRate?: number
  currency: string
  billingInterval: 'day' | 'week' | 'month' | 'quarter' | 'semester' | 'year'
  trialPeriodDays?: number
  isActive?: boolean
  displayOrder?: number
  createInStripe?: boolean
  translations?: CreatePlanTranslationData[]
}

// Interface pour mettre à jour un plan
export interface UpdatePlanRequest {
  name?: string
  description?: string
  price?: number
  promotionalPrice?: number
  promotionalDurationMonths?: number
  vatRate?: number
  currency?: string
  billingInterval?: 'day' | 'week' | 'month' | 'quarter' | 'semester' | 'year'
  trialPeriodDays?: number
  isActive?: boolean
  displayOrder?: number
  translations?: CreatePlanTranslationData[]
}

// Réponses API selon le controller
export interface PlansResponse {
  success: boolean
  data: Plan[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNextPage: boolean
    hasPrevPage: boolean
  }
}

export interface PlanResponse {
  success: boolean
  data: Plan
}

export interface PlansStats {
  total: number
  active: number
  inactive: number
  byInterval: Record<string, number>
  averagePrice: number
}

// Paramètres de requête pour la liste
export interface PlanFilters {
  page?: number
  limit?: number
  sortBy?: string
  sortOrder?: 'ASC' | 'DESC'
  includeInactive?: boolean
  includeAllTranslations?: boolean
  lang?: string
}

// Interface toggle response
export interface ToggleActiveResponse {
  success: boolean
  data: {
    id: number
    code: string
    isActive: boolean
    message: string
  }
}

// Interface delete response
export interface DeletePlanResponse {
  success: boolean
  data: {
    deletedEntity: {
      id: number
      code: string
      price: string
    }
    deletedTranslations: number
    deletedLanguages: string[]
  }
}

// Legacy interfaces pour compatibilité
export interface SubscriptionPlan extends Timestampable {
  id: number
  code: string
  price: string
  billingInterval: BillingInterval
  currency: string
  trialPeriodDays: number
  isActive: boolean
  isPublic: boolean
  displayOrder: number
  stripeProductId?: string | null
  stripePriceId?: string | null
  stripeMetadata?: any
  subscriptions: readonly SimpleSubscription[]
  translations?: readonly SubscriptionPlanTranslation[]
}

export type BillingInterval = 'month' | 'year' | 'quarter' | 'semester' | 'week' | 'day'

export interface SubscriptionPlanFormData {
  code: string
  price: number
  promotionalPrice?: number
  promotionalDurationMonths?: number
  vatRate?: number
  currency: string
  billingInterval: BillingInterval
  trialPeriodDays: number
  isActive: boolean
  isPublic: boolean
  displayOrder: number
  translations: {
    fr: { name: string; description: string; features: string[] }
    en: { name: string; description: string; features: string[] }
    de: { name: string; description: string; features: string[] }
    nl: { name: string; description: string; features: string[] }
  }
}

export interface CreateSubscriptionPlanData {
  plan: {
    code: string
    price: number
    promotionalPrice?: number
    promotionalDurationMonths?: number
    vatRate?: number
    currency: string
    duration: string
    billingInterval?: BillingInterval
    trialPeriodDays?: number
    isActive?: boolean
    isPublic?: boolean
    displayOrder?: number
  }
  translations: CreatePlanTranslationData[]
}

export interface LegacyCreateSubscriptionPlanData {
  name: string
  description: string
  price: number
  promotionalPrice?: number
  promotionalDurationMonths?: number
  vatRate?: number
  billingInterval: BillingInterval
  currency: string
  trialPeriodDays: number
  isActive: boolean
  isPublic: boolean
  createInStripe: boolean
  displayOrder: number
}

export interface UpdateSubscriptionPlanDataDonne {
  name: string
  description: string
  price: number
  promotionalPrice?: number
  promotionalDurationMonths?: number
  vatRate?: number
  billingInterval: BillingInterval
  currency: string
  trialPeriodDays: number
  isActive: boolean
  isPublic: boolean
  syncWithStripe: boolean
  displayOrder: number
}

export interface UpdateSubscriptionPlanData extends Partial<UpdateSubscriptionPlanDataDonne> {
  id: number
}

export interface SubscriptionPlansResponse {
  status: number
  message: string
  timestamp: string
  data: {
    plans: SubscriptionPlan[]
    pagination: {
      page: number
      limit: number
      total: number
      pages: number
    }
  }
}

export interface SubscriptionPlanResponse {
  status: number
  message: string
  timestamp: string
  data: {
    plan: SubscriptionPlan
  }
}

export interface SimpleSubscriptionPlansResponse {
  success: boolean
  data: SubscriptionPlan[]
  message: string
}

// Types pour la synchronisation bidirectionnelle Stripe
export enum SyncDirection {
  LOCAL_TO_STRIPE = 'local_to_stripe',
  STRIPE_TO_LOCAL = 'stripe_to_local',
  BIDIRECTIONAL = 'bidirectional'
}

export enum SyncElement {
  PRODUCT = 'product',
  PRICE = 'price', 
  PROMOTIONAL_PRICE = 'promotional_price',
  TAX_RATE = 'tax_rate',
  ALL = 'all'
}

export interface BidirectionalSyncRequest {
  direction: SyncDirection
  elements?: SyncElement[]
  planId?: number
  stripeProductId?: string
  force?: boolean
  dryRun?: boolean
}

export interface SyncChangeItem {
  field: string
  from: any
  to: any
}

export interface SyncResultResponse {
  success: boolean
  direction: string
  details: Record<string, any>
  pendingChanges?: SyncChangeItem[]
  warnings?: string[]
}

export interface StripeProduct {
  id: string
  name: string
  description: string | null
  active: boolean
  created: number
  updated: number
  metadata: Record<string, string>
}

export interface StripeProductsResponse {
  success: boolean
  data: StripeProduct[]
  count: number
}

export interface ImportAllFromStripeRequest {
  dryRun?: boolean
  overwriteExisting?: boolean
  includeInactive?: boolean
}

export interface ImportPlanDetail {
  stripeProductId: string
  stripeProductName: string
  action: 'created' | 'updated' | 'skipped' | 'error'
  planId?: number
  planCode?: string
  price?: number
  currency?: string
  reason?: string
}

export interface ImportAllFromStripeResponse {
  success: boolean
  imported: number
  updated: number
  skipped: number
  errors: number
  details: ImportPlanDetail[]
}