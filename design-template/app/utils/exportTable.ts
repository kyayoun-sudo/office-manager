import type { DataTableColumn } from '~~/shared/types/datatable'

interface ExportOptions<T> {
  data: T[]
  columns: DataTableColumn<T>[]
  filename?: string
}

function getCellValue<T>(item: T, column: DataTableColumn<T>): any {
  if (column.getValue) return column.getValue(item)
  return (column.key as string).split('.').reduce((current: any, key: string) => current?.[key], item)
}

function formatCellForExport<T>(value: any, item: T, column: DataTableColumn<T>): string {
  if (column.formatter) return column.formatter(value, item)

  if (column.render === 'badge' && column.badge) {
    const badgeValue = column.badge.getValue(item)
    return column.badge.getLabel?.(badgeValue, item) ?? badgeValue
  }

  if ((column.render === 'date' || column.render === 'datetime') && value) {
    const date = new Date(value)
    if (isNaN(date.getTime())) return value?.toString() || ''
    const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' }
    if (column.render === 'datetime') {
      options.hour = '2-digit'
      options.minute = '2-digit'
    }
    return date.toLocaleDateString('fr-FR', options)
  }

  if (column.render === 'price' && value != null) {
    const num = typeof value === 'string' ? parseFloat(value) : value
    if (isNaN(num)) return value?.toString() || ''
    return new Intl.NumberFormat(column.price?.locale || 'fr-FR', {
      style: 'currency',
      currency: column.price?.currency || 'EUR',
    }).format(num)
  }

  return value?.toString() || ''
}

function escapeCsvField(field: string): string {
  if (field.includes(',') || field.includes('"') || field.includes('\n')) {
    return `"${field.replace(/"/g, '""')}"`
  }
  return field
}

export function exportTableToCsv<T>({ data, columns, filename = 'export' }: ExportOptions<T>) {
  const exportColumns = columns.filter((col) => col.key !== 'select' && col.key !== 'actions')

  const header = exportColumns.map((col) => escapeCsvField(col.label)).join(',')

  const rows = data.map((item) =>
    exportColumns
      .map((col) => {
        const value = getCellValue(item, col)
        const formatted = formatCellForExport(value, item, col)
        return escapeCsvField(formatted)
      })
      .join(','),
  )

  const BOM = '\uFEFF'
  const csv = BOM + [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
