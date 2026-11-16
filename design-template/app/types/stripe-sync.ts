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