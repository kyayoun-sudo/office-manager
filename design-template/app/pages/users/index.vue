<script setup lang="ts">
import type { AdminUser } from '~~/shared/types/user'
import { RoleCode } from '#shared/types/enums'
import type { DataTableConfig } from '~~/shared/types/datatable'
import {
  Filter,
  Users as UsersIcon,
  RotateCcw,
  Eye,
  Trash2,
  UserCheck,
  CheckCircle2,
  XCircle,
  UserPlus,
  ShieldCheck,
  ShieldX,
  Send,
  KeyRound,
  Download,
} from 'lucide-vue-next'
import { exportTableToCsv } from '~/utils/exportTable'
import GenericDataTable from '~/components/ui/data-table/GenericDataTable.vue'
import Pagination from '~/components/ui/pagination/Pagination.vue'
import UniversalFilters from '~/components/ui/filters/UniversalFilters.vue'
import type {
  FilterField,
  SearchConfig,
} from '~/components/ui/filters/UniversalFilters.vue'

definePageMeta({})
useHead({ title: 'Utilisateurs - Modèle d’administration' })

const PROTECTED_ROLES: ReadonlySet<string> = new Set([RoleCode.ADMIN, RoleCode.SUPPORT])

const {
  users,
  isLoading,
  error,
  total,
  currentPage: apiCurrentPage,
  totalPages: apiTotalPages,
  itemsPerPage: apiItemsPerPage,
  fetchUsers,
  updateUserStatus,
  bulkUpdateUserStatus,
  bulkDeleteUsers,
  deleteUser,
  validateClinician,
  resendConfirmation,
  activateAccount,
  getUserRole,
} = useUsers()

const toast = useToast()

const isProtectedRole = (user: AdminUser) =>
  PROTECTED_ROLES.has(user.role?.code)

const isClinician = (user: AdminUser) =>
  user.role?.code === RoleCode.CLINICIAN

const getRoleDisplayName = (roleCode: string): string => {
  const roles: Record<string, string> = {
    [RoleCode.ADMIN]: 'Administrateur',
    [RoleCode.SUPPORT]: 'Support',
    [RoleCode.CLINICIAN]: 'Sage-femme',
    [RoleCode.PATIENT]: 'Patient',
  }
  return roles[roleCode] || roleCode
}

enum VerificationStatus {
  VERIFIED = 'verified',
  REJECTED = 'rejected',
  PENDING = 'pending',
  NA = 'na',
}

const getVerificationStatus = (user: AdminUser): VerificationStatus => {
  if (!isClinician(user) || !user.clinician) return VerificationStatus.NA
  if (user.clinician.verified === true) return VerificationStatus.VERIFIED
  if (user.clinician.verified === false) return VerificationStatus.REJECTED
  return VerificationStatus.PENDING
}

const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  [VerificationStatus.VERIFIED]: 'Vérifiée',
  [VerificationStatus.REJECTED]: 'Rejetée',
  [VerificationStatus.PENDING]: 'En attente',
  [VerificationStatus.NA]: '-',
}

const VERIFICATION_VARIANTS: Record<VerificationStatus, string> = {
  [VerificationStatus.VERIFIED]: 'default',
  [VerificationStatus.REJECTED]: 'destructive',
  [VerificationStatus.PENDING]: 'secondary',
  [VerificationStatus.NA]: 'outline',
}

const formatLastLogin = (lastLoginAt: string | null): string => {
  if (!lastLoginAt) return 'Jamais connecté'
  return new Date(lastLoginAt).toLocaleDateString('fr-FR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const tableConfig = computed(
  (): DataTableConfig<AdminUser> => ({
    columns: [
      { key: 'id', label: 'ID', sortable: true, width: '80px' },
      {
        key: 'name',
        label: 'Nom',
        sortable: true,
        getValue: (user) => `${user.firstName} ${user.lastName}`,
      },
      { key: 'email', label: 'Email', sortable: true },
      {
        key: 'role',
        label: 'Rôle',
        sortable: true,
        getValue: (user) => getRoleDisplayName(getUserRole(user)),
      },
      {
        key: 'verification',
        label: 'Vérification',
        sortable: false,
        getValue: (user) => VERIFICATION_LABELS[getVerificationStatus(user)],
      },
      { key: 'phone', label: 'Téléphone', sortable: false },
      {
        key: 'status',
        label: 'Statut',
        sortable: true,
        getValue: (user) => (user.isActive ? 'Actif' : 'Inactif'),
      },
      {
        key: 'lastLogin',
        label: 'Dernière connexion',
        sortable: true,
        getValue: (user) => formatLastLogin(user.lastLoginAt),
      },
    ],
    actionsDisplay: 'dropdown',
    rowActions: [
      { key: 'view', label: 'Voir les détails', icon: Eye },
      {
        key: 'resend-confirmation',
        label: 'Renvoyer la confirmation',
        icon: Send,
        condition: (user) => !user.confirmedAt,
      },
      {
        key: 'activate-account',
        label: 'Activer le compte',
        icon: KeyRound,
        condition: (user) => !user.confirmedAt,
      },
      {
        key: 'validate',
        label: 'Valider la sage-femme',
        icon: ShieldCheck,
        separator: true,
        condition: (user) =>
          isClinician(user) && user.clinician?.verified == null,
      },
      {
        key: 'reject',
        label: 'Rejeter la sage-femme',
        icon: ShieldX,
        variant: 'destructive',
        condition: (user) =>
          isClinician(user) && user.clinician?.verified == null,
      },
      {
        key: 'toggle-status',
        label: (user) => user.isActive ? 'Désactiver le compte' : 'Réactiver le compte',
        icon: UserCheck,
        separator: true,
        condition: (user) => !isProtectedRole(user) || !user.isActive,
      },
      {
        key: 'delete',
        label: 'Supprimer',
        icon: Trash2,
        variant: 'destructive',
        separator: true,
        condition: (user) => !isProtectedRole(user),
      },
    ],
    bulkActions: [
      { key: 'activate', label: 'Activer', icon: CheckCircle2, variant: 'outline' },
      { key: 'deactivate', label: 'Désactiver', icon: XCircle, variant: 'outline' },
      { key: 'delete', label: 'Supprimer', icon: Trash2, variant: 'destructive', confirm: true },
    ],
    selectable: false,
    defaultSort: { key: 'id', order: 'asc' },
    messages: {
      loading: 'Chargement des utilisateurs...',
      empty: 'Aucun utilisateur trouvé',
      selected: (count) =>
        `${count} utilisateur${count > 1 ? 's' : ''} sélectionné${count > 1 ? 's' : ''}`,
    },
    exportable: true,
    exportFilename: 'utilisateurs',
  }),
)

const ALL_ROLES_VALUE = 'all'

const roleOptions = [
  { label: 'Tous les rôles', value: ALL_ROLES_VALUE },
  { label: 'Administrateur', value: RoleCode.ADMIN },
  { label: 'Sage-femme', value: RoleCode.CLINICIAN },
  { label: 'Patient', value: RoleCode.PATIENT },
]

const searchQuery = ref('')
const filtersState = ref({ email: '', fullname: '', phone: '', postalCode: '', role: ALL_ROLES_VALUE, deletionRequested: 'all' })

const searchConfig: SearchConfig = {
  label: 'Recherche rapide',
  placeholder: 'Rechercher par nom complet...',
}

const filterFields = computed((): FilterField[] => [
  {
    key: 'role',
    label: 'Rôle',
    type: 'select',
    options: roleOptions,
    icon: UsersIcon,
    defaultVisible: true,
  },
  {
    key: 'email',
    label: 'Email',
    type: 'input',
    placeholder: 'Rechercher par email...',
    icon: Filter,
  },
  {
    key: 'fullname',
    label: 'Nom complet',
    type: 'input',
    placeholder: 'Prénom ou nom...',
    icon: UsersIcon,
  },
  {
    key: 'phone',
    label: 'Téléphone',
    type: 'input',
    placeholder: 'Numéro de téléphone...',
    icon: Filter,
  },
  {
    key: 'postalCode',
    label: 'Code postal',
    type: 'input',
    placeholder: 'Code postal...',
    icon: Filter,
  },
  {
    key: 'deletionRequested',
    label: 'Suppression demandee',
    type: 'select',
    options: [
      { value: 'all', label: 'Tous les comptes' },
      { value: 'true', label: 'Suppression demandee' },
      { value: 'false', label: 'Comptes actifs' },
    ],
    icon: Trash2,
  },
])

const getCurrentFilterParams = (): Record<string, any> => {
  const params: Record<string, any> = {}
  const { email, fullname, phone, postalCode, role, deletionRequested } = filtersState.value
  if (email) params.email = email
  if (fullname) params.fullname = fullname
  if (phone) params.phone = phone
  if (postalCode) params.postalCode = postalCode
  if (role && role !== ALL_ROLES_VALUE) params.role = role
  if (deletionRequested && deletionRequested !== 'all') params.deletionRequested = deletionRequested
  return params
}

const performApiSearch = async () => {
  const filterParams = getCurrentFilterParams()
  if (searchQuery.value.trim()) {
    filterParams.fullname = searchQuery.value.trim()
  }
  await fetchUsers({ page: 1, limit: itemsPerPage.value, ...filterParams })
}

const clearAllFilters = async () => {
  searchQuery.value = ''
  filtersState.value = { email: '', fullname: '', phone: '', postalCode: '', role: ALL_ROLES_VALUE, deletionRequested: 'all' }
  await fetchUsers({ page: 1, limit: itemsPerPage.value })
}

const currentPage = computed(() => apiCurrentPage.value || 1)
const totalPages = computed(() => apiTotalPages.value || 1)
const itemsPerPage = computed(() => apiItemsPerPage.value || 10)
const displayUsers = computed(() =>
  Array.isArray(users.value) ? users.value.filter(Boolean) : [],
)

const paginationInfo = computed(() => {
  const start = total.value > 0 ? (currentPage.value - 1) * itemsPerPage.value + 1 : 0
  const end = Math.min(start + displayUsers.value.length - 1, total.value)
  return { start, end, total: total.value }
})

const goToPage = async (page: number) => {
  if (page >= 1 && page <= totalPages.value && page !== currentPage.value) {
    await fetchUsers({ ...getCurrentFilterParams(), page, limit: itemsPerPage.value })
  }
}

const changeItemsPerPage = async (newSize: number) => {
  await fetchUsers({ ...getCurrentFilterParams(), page: 1, limit: newSize })
}

const getVisiblePages = (maxVisible = 5) => {
  const pages = []
  const start = Math.max(1, currentPage.value - Math.floor(maxVisible / 2))
  const end = Math.min(totalPages.value, start + maxVisible - 1)
  for (let i = start; i <= end; i++) pages.push(i)
  return pages
}

const { confirm } = useConfirm()

const bulkActionDialogOpen = ref(false)
const createAdminDialogOpen = ref(false)
const rejectDialogOpen = ref(false)
const activateDialogOpen = ref(false)
const selectedUser = ref<AdminUser | null>(null)
const bulkActionType = ref<'activate' | 'deactivate' | 'delete'>('activate')
const bulkSelectedIds = ref<number[]>([])

const handleRowAction = async (action: string, user: AdminUser) => {
  switch (action) {
    case 'view':
      navigateTo(`/users/${user.id}`)
      break
    case 'resend-confirmation':
      await handleResendConfirmation(user)
      break
    case 'activate-account':
      activateDialogOpen.value = true
      break
    case 'validate':
      await handleValidateClinician(user)
      break
    case 'reject':
      selectedUser.value = user
      rejectDialogOpen.value = true
      break
    case 'toggle-status': {
      const result = await updateUserStatus(user.id, !user.isActive)
      if (result.success && result.message)
        toast.handleApiSuccess(result.message)
      else if (result.error)
        toast.handleApiError({ success: false, message: result.error }, 'Erreur')
      break
    }
    case 'delete':
      handleDeleteUser(user)
      break
  }
}

const handleResendConfirmation = async (user: AdminUser) => {
  const confirmed = await confirm({
    title: 'Renvoyer la confirmation',
    description: `Envoyer un email de confirmation de compte a ${user.firstName} ${user.lastName} (${user.email}) ?`,
    confirmLabel: 'Envoyer',
    confirmLoadingLabel: 'Envoi...',
    icon: Send,
  })

  if (confirmed) {
    const result = await resendConfirmation(user.id)
    if (result.success) {
      toast.handleApiSuccess(`Email de confirmation envoye a ${user.email}`)
    } else {
      toast.handleApiError({ success: false, message: result.error || "Erreur lors de l'envoi" })
    }
  }
}

const handleValidateClinician = async (user: AdminUser) => {
  if (!user.clinician?.id) return

  const confirmed = await confirm({
    title: 'Valider la sage-femme',
    description: `Confirmez-vous la validation de ${user.firstName} ${user.lastName} ?`,
    confirmLabel: 'Valider',
    confirmLoadingLabel: 'Validation...',
    icon: ShieldCheck,
  })

  if (confirmed) {
    const result = await validateClinician(user.clinician.id)
    if (result.success) {
      toast.handleApiSuccess(`${user.firstName} ${user.lastName} a été validée`)
      await fetchUsers({ ...getCurrentFilterParams(), page: currentPage.value, limit: itemsPerPage.value })
    } else {
      toast.handleApiError({ success: false, message: result.error || 'Erreur lors de la validation' })
    }
  }
}

const handleBulkAction = (action: string, selected: AdminUser[]) => {
  bulkSelectedIds.value = selected.map((u) => u.id)
  bulkActionType.value = action as 'activate' | 'deactivate' | 'delete'
  bulkActionDialogOpen.value = true
}

const confirmBulkAction = async () => {
  try {
    const ids = bulkSelectedIds.value
    const isStatusAction = bulkActionType.value !== 'delete'

    const result = isStatusAction
      ? await bulkUpdateUserStatus(ids, bulkActionType.value === 'activate')
      : await bulkDeleteUsers(ids)

    if (result.success && result.results.success > 0) {
      const actionLabel = {
        activate: 'activés',
        deactivate: 'désactivés',
        delete: 'supprimés',
      }[bulkActionType.value]
      let message = `${result.results.success} utilisateur(s) ${actionLabel} avec succès.`
      if (result.results.failed > 0) message += ` ${result.results.failed} échec(s).`
      toast.handleApiSuccess(message)
      result.messages.errors.forEach((err) =>
        toast.handleApiError({ success: false, message: err }, 'Détail erreur'),
      )
    } else {
      toast.handleApiError({ success: false, message: 'Aucune opération réussie' })
    }
  } catch (err: any) {
    toast.handleApiError({ success: false, message: err.message || 'Erreur inattendue' })
  } finally {
    bulkActionDialogOpen.value = false
    bulkSelectedIds.value = []
  }
}

const handleDeleteUser = async (user: AdminUser) => {
  const confirmed = await confirm({
    title: "Supprimer l'utilisateur",
    description: `Êtes-vous sûr de vouloir supprimer ${user.firstName} ${user.lastName} (${user.email}) ?`,
    confirmLabel: 'Supprimer définitivement',
    confirmLoadingLabel: 'Suppression...',
    icon: Trash2,
    showWarning: true,
    warningMessage: 'Toutes les données associées à cet utilisateur seront définitivement perdues.',
    action: async () => {
      const result = await deleteUser(user.id)
      if (!result.success) {
        toast.handleApiError(
          { success: false, message: result.error || "Impossible de supprimer l'utilisateur" },
          'Erreur',
        )
        throw new Error('delete failed')
      }
    },
  })
  if (confirmed) {
    toast.handleApiSuccess('Utilisateur supprimé avec succès')
    await fetchUsers()
  }
}

const onAdminCreated = async () => {
  await fetchUsers({ ...getCurrentFilterParams(), page: 1, limit: itemsPerPage.value })
}

const onAccountActivated = async () => {
  await fetchUsers({ ...getCurrentFilterParams(), page: currentPage.value, limit: itemsPerPage.value })
}

const onClinicianRejected = async () => {
  await fetchUsers({ ...getCurrentFilterParams(), page: currentPage.value, limit: itemsPerPage.value })
}

const handleExport = () => {
  exportTableToCsv({
    data: displayUsers.value,
    columns: tableConfig.value.columns,
    filename: 'utilisateurs',
  })
}

onMounted(() => fetchUsers({ page: 1, limit: 10 }))

watch(error, (newError) => {
  if (newError)
    toast.handleApiError({ success: false, message: newError }, 'Erreur')
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight text-foreground">Utilisateurs</h1>
        <p class="text-muted-foreground">Gérez les utilisateurs de votre plateforme Exemple</p>
      </div>
      <UiButton @click="createAdminDialogOpen = true">
        <UserPlus class="mr-2 h-4 w-4" />
        Créer un administrateur
      </UiButton>
    </div>

    <UniversalFilters
      title="Filtres et Recherche"
      mode="manual"
      :search-config="searchConfig"
      :search-value="searchQuery"
      :filter-fields="filterFields"
      :filters="filtersState"
      :show-summary="true"
      :result-count="total"
      result-label="utilisateur"
      :total-count="total"
      clear-all-text="Effacer les filtres"
      @update:search="searchQuery = $event"
      @update:filters="filtersState = { ...filtersState, ...$event }"
      @clear-all="clearAllFilters"
      @search="performApiSearch"
    />

    <div class="flex items-center justify-between mb-4">
      <h3 class="text-lg font-semibold">
        Liste des Utilisateurs
        <span class="text-sm font-normal text-muted-foreground">
          ({{ paginationInfo.start }} - {{ paginationInfo.end }} sur {{ paginationInfo.total }})
        </span>
      </h3>
      <div class="flex items-center gap-2">
        <UiButton
          variant="outline"
          size="sm"
          :disabled="isLoading"
          @click="fetchUsers()"
        >
          <RotateCcw class="mr-2 h-4 w-4" :class="{ 'animate-spin': isLoading }" />
          Actualiser
        </UiButton>
        <UiButton variant="outline" size="sm" :disabled="isLoading" @click="handleExport">
          <Download class="mr-2 h-4 w-4" />
          Exporter CSV
        </UiButton>
      </div>
    </div>

    <GenericDataTable
      :data="displayUsers"
      :config="tableConfig"
      :is-loading="isLoading"
      @row-action="handleRowAction"
      @bulk-action="handleBulkAction"
    />

    <Pagination
      :current-page="currentPage"
      :total-pages="totalPages"
      :total-items="total"
      :items-per-page="itemsPerPage"
      :items-per-page-options="[10, 20, 50, 100]"
      :pagination-info="paginationInfo"
      :get-visible-pages="getVisiblePages"
      @go-to-page="goToPage"
      @go-to-first="goToPage(1)"
      @go-to-last="goToPage(totalPages)"
      @go-to-previous="goToPage(currentPage - 1)"
      @go-to-next="goToPage(currentPage + 1)"
      @change-items-per-page="changeItemsPerPage"
    />

    <BulkActionsDialog
      v-model:open="bulkActionDialogOpen"
      :action="bulkActionType"
      :selected-count="bulkSelectedIds.length"
      @confirm="confirmBulkAction"
    />

    <CreateAdminUserDialog
      :open="createAdminDialogOpen"
      @update:open="createAdminDialogOpen = $event"
      @success="onAdminCreated"
    />

    <RejectClinicianDialog
      :open="rejectDialogOpen"
      :user="selectedUser"
      @update:open="rejectDialogOpen = $event"
      @rejected="onClinicianRejected"
    />

    <ActivateAccountDialog
      :open="activateDialogOpen"
      @update:open="activateDialogOpen = $event"
      @activated="onAccountActivated"
    />
  </div>
</template>
