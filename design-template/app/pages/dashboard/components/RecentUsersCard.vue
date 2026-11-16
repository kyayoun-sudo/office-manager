<script setup lang="ts">
import type { RecentUser } from '~~/shared/types/dashboard'
import type { DataTableConfig } from '~~/shared/types/datatable'
import GenericDataTable from '~/components/ui/data-table/GenericDataTable.vue'

defineProps<{
  users: RecentUser[]
}>()

const { getUserTypeDisplayName, getUserTypeBadgeVariant, formatRelativeDate } = useDashboard()

const tableConfig = computed((): DataTableConfig<RecentUser> => ({
  columns: [
    {
      key: 'name',
      label: 'Nom',
      sortable: true,
      getValue: (user) => `${user.firstName} ${user.lastName}`,
    },
    {
      key: 'email',
      label: 'Email',
      sortable: false,
    },
    {
      key: 'userType',
      label: 'Type',
      sortable: true,
      getValue: (user) => getUserTypeDisplayName(user.userType),
    },
    {
      key: 'createdAt',
      label: 'Inscription',
      sortable: true,
      getValue: (user) => formatRelativeDate(user.createdAt),
    },
  ],
  rowActions: [],
  bulkActions: [],
  selectable: false,
  defaultSort: { key: 'createdAt', order: 'desc' },
  messages: {
    empty: 'Aucun utilisateur recent',
  },
}))
</script>

<template>
  <GenericDataTable :data="users" :config="tableConfig" />
</template>
