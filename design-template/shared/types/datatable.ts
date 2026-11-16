import type { Component } from 'vue'

// Configuration d'une colonne du tableau
export interface DataTableColumn<T = any> {
  key: string
  label: string
  sortable?: boolean
  width?: string
  align?: 'left' | 'center' | 'right'
  
  // Type de rendu de la cellule
  render?: 'text' | 'badge' | 'date' | 'datetime' | 'price' | 'custom'
  
  // Fonction personnalisée pour obtenir la valeur
  getValue?: (item: T) => any
  
  // Fonction pour formatter l'affichage
  formatter?: (value: any, item: T) => string
  
  // Configuration pour les badges
  badge?: {
    variants: Record<string, string>
    getValue: (item: T) => string
    getLabel?: (value: string, item: T) => string
  }
  
  // Configuration pour les dates
  date?: {
    format?: 'date' | 'datetime' | 'time'
    emptyText?: string
  }
  
  // Configuration pour les prix
  price?: {
    currency?: string
    locale?: string
  }
  
  // Classes CSS personnalisées
  cellClass?: string | ((item: T, value: any) => string)
  headerClass?: string
  
  // Rendu de cellule complètement personnalisé
  customRender?: (value: any, item: T, column: DataTableColumn<T>) => any
}

// Configuration d'une action en lot
export interface BulkAction {
  key: string
  label: string
  icon?: Component | string
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost'
  color?: string
  disabled?: (selectedItems: any[]) => boolean
  confirm?: boolean
  confirmTitle?: string
  confirmMessage?: string
}

// Configuration d'une action de ligne
export interface RowAction<T = any> {
  key: string
  label: string | ((item: T) => string)
  icon?: Component | string
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost'
  disabled?: (item: T) => boolean
  hidden?: (item: T) => boolean
  condition?: (item: T) => boolean
  separator?: boolean
}

// Configuration complète du tableau
export interface DataTableConfig<T = any> {
  // Colonnes à afficher
  columns: DataTableColumn<T>[]
  
  // Actions de ligne disponibles
  rowActions?: RowAction<T>[]
  
  // Actions en lot disponibles
  bulkActions?: BulkAction[]
  
  // Permettre la sélection multiple
  selectable?: boolean
  
  // Tri par défaut
  defaultSort?: {
    key: string
    order: 'asc' | 'desc'
  }
  
  // Messages personnalisés
  messages?: {
    loading?: string
    empty?: string
    selected?: (count: number) => string
  }
  
  // Classes personnalisées
  tableClass?: string
  headerClass?: string
  bodyClass?: string
  rowClass?: string | ((item: T) => string)
  
  // Comportements
  hideSelectColumn?: boolean
  hideActionsColumn?: boolean
  stickyHeader?: boolean
  actionsDisplay?: 'buttons' | 'dropdown'

  // Drag-and-drop pour réordonnancer les lignes
  draggable?: boolean

  // Export
  exportable?: boolean
  exportFilename?: string
}

// État de tri
export interface SortState {
  key: string
  order: 'asc' | 'desc'
}

// Événements émis par le composant
export interface DataTableEmits<T = any> {
  'row-click': [item: T]
  'row-action': [action: string, item: T]
  'bulk-action': [action: string, items: T[]]
  'sort': [sort: SortState]
  'selection-change': [selectedItems: T[]]
}