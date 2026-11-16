<script setup lang="ts">
import type { UpcomingAppointment } from '~~/shared/types/dashboard'
import type { DataTableConfig } from '~~/shared/types/datatable'
import GenericDataTable from '~/components/ui/data-table/GenericDataTable.vue'

defineProps<{
  appointments: UpcomingAppointment[]
}>()

const formatAppointmentDate = (dateString: string): string => {
  const date = new Date(dateString)
  if (isNaN(date.getTime())) return 'N/A'
  return date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const getStatusLabel = (status: string): string => {
  const labels: Record<string, string> = {
    confirmed: 'Confirme',
    scheduled: 'Planifie',
    cancelled: 'Annule',
  }
  return labels[status] || status
}

const tableConfig = computed((): DataTableConfig<UpcomingAppointment> => ({
  columns: [
    {
      key: 'patientName',
      label: 'Patient',
      sortable: true,
    },
    {
      key: 'providerName',
      label: 'Clinicien',
      sortable: true,
    },
    {
      key: 'appointmentDate',
      label: 'Date',
      sortable: true,
      getValue: (a) => formatAppointmentDate(a.appointmentDate),
    },
    {
      key: 'status',
      label: 'Statut',
      sortable: false,
      getValue: (a) => getStatusLabel(a.status),
    },
  ],
  rowActions: [],
  bulkActions: [],
  selectable: false,
  defaultSort: { key: 'appointmentDate', order: 'asc' },
  messages: {
    empty: 'Aucune reservation a venir',
  },
}))
</script>

<template>
  <GenericDataTable :data="appointments" :config="tableConfig" />
</template>
