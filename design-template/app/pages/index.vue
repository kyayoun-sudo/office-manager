<script setup lang="ts">
import { RefreshCw, AlertTriangle } from 'lucide-vue-next'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Dashboard - Modèle d’administration' })

const {
  fetchDashboard, stats, activity, isLoading, error,
  formatCurrency, totalUsers, totalPatients, totalClinicians,
  appointmentsThisMonth, appointmentsToday, upcomingAppointments,
  revenueThisMonth, activeSubscriptions, availableTimeSlots,
  openSupportTickets, lastUpdatedLabel,
} = useDashboard()

const toast = useToast()

const loadDashboard = async () => {
  try {
    await fetchDashboard()
  } catch (err: any) {
    toast.handleApiError({ success: false, error: err.message || 'Impossible de charger les donnees' }, 'Erreur')
  }
}

onMounted(() => loadDashboard())

const skeletonBarColors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444']
const skeletonDistColors = ['#10b981', '#3b82f6', '#8b5cf6']

const hatchedBarStyle = (color: string, height: string) => ({
  height,
  border: `1.5px solid ${color}`,
  backgroundImage: `repeating-linear-gradient(-45deg, transparent, transparent 4px, ${color}33 4px, ${color}33 5.5px)`,
  backgroundColor: `${color}0a`,
})
</script>

<template>
  <div class="flex flex-col h-[calc(100vh-5rem)] overflow-hidden">
    <!-- Header -->
    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between shrink-0 pb-3">
      <div>
        <h1 class="text-xl font-bold tracking-tight">Dashboard</h1>
        <p class="text-xs text-muted-foreground">Vue d'ensemble de la plateforme Exemple</p>
      </div>
      <div class="flex items-center gap-3">
        <p v-if="lastUpdatedLabel" class="text-[11px] text-muted-foreground">
          Mis a jour le {{ lastUpdatedLabel }}
        </p>
        <UiButton
variant="outline"
size="icon"
:disabled="isLoading"
@click="loadDashboard">
          <RefreshCw class="size-4" :class="{ 'animate-spin': isLoading }" />
        </UiButton>
      </div>
    </div>

    <!-- Loading skeleton -->
    <div v-if="isLoading && !stats" class="flex flex-col gap-3 flex-1 min-h-0">
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
        <UiCard v-for="i in 4" :key="i" class="rounded-none bg-gradient-to-t from-primary/5 to-card">
          <UiCardHeader class="p-3 pb-0">
            <UiSkeleton class="h-3 w-24" />
            <UiSkeleton class="mt-1.5 h-6 w-16" />
          </UiCardHeader>
          <UiCardFooter class="p-3 pt-2">
            <UiSkeleton class="h-2.5 w-32" />
          </UiCardFooter>
        </UiCard>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 flex-1 min-h-0">
        <UiCard class="rounded-none flex flex-col">
          <UiCardContent class="p-3 flex-1 flex items-end">
            <div class="flex items-end gap-3 w-full h-full">
              <div
                v-for="(color, j) in skeletonBarColors"
:key="j"
                class="flex-1 animate-pulse rounded-t-lg"
                :style="hatchedBarStyle(color, `${35 + j * 15}%`)"
              />
            </div>
          </UiCardContent>
        </UiCard>
        <UiCard class="rounded-none flex flex-col">
          <UiCardContent class="p-3 flex-1 flex items-end">
            <div class="flex items-end gap-3 w-full h-full">
              <div
                v-for="(color, j) in skeletonDistColors"
:key="j"
                class="flex-1 animate-pulse rounded-t-lg"
                :style="hatchedBarStyle(color, `${30 + j * 25}%`)"
              />
            </div>
          </UiCardContent>
        </UiCard>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 flex-1 min-h-0">
        <div v-for="t in 2" :key="t" class="border p-3 overflow-hidden">
          <UiSkeleton class="h-4 w-36 mb-3" />
          <div class="space-y-2">
            <UiSkeleton v-for="k in 3" :key="k" class="h-3.5 w-full" />
          </div>
        </div>
      </div>
    </div>

    <!-- Data -->
    <div v-else-if="stats" class="flex flex-col gap-3 flex-1 min-h-0">
      <!-- Stats Cards -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
        <StatsCard
          title="Utilisateurs totaux"
          :value="totalUsers"
          :description="`${totalPatients} patients, ${totalClinicians} cliniciens`"
        />
        <StatsCard
          title="Rendez-vous ce mois"
          :value="appointmentsThisMonth"
          :description="`${appointmentsToday} aujourd'hui, ${upcomingAppointments} a venir`"
        />
        <StatsCard
          title="Revenus ce mois"
          :value="formatCurrency(revenueThisMonth)"
          :description="`${activeSubscriptions} abonnements actifs`"
        />
        <StatsCard
          title="Tickets support"
          :value="openSupportTickets"
          :description="`${availableTimeSlots} creneaux disponibles`"
        />
      </div>

      <!-- Charts -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 flex-1 min-h-0">
        <StatsChart />
        <UserDistributionChart :stats="stats" />
      </div>

      <!-- Tables -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 flex-1 min-h-0">
        <div class="border p-3 flex flex-col min-h-0">
          <h3 class="text-sm font-semibold mb-0.5 shrink-0">Utilisateurs recents</h3>
          <p class="text-xs text-muted-foreground mb-2 shrink-0">Les derniers comptes crees</p>
          <div class="flex-1 min-h-0 overflow-auto">
            <RecentUsersCard :users="activity?.recentUsers || []" />
          </div>
        </div>
        <div class="border p-3 flex flex-col min-h-0">
          <h3 class="text-sm font-semibold mb-0.5 shrink-0">Reservations recentes</h3>
          <p class="text-xs text-muted-foreground mb-2 shrink-0">Les prochains rendez-vous</p>
          <div class="flex-1 min-h-0 overflow-auto">
            <UpcomingAppointmentsCard :appointments="activity?.upcomingAppointments || []" />
          </div>
        </div>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex-1 flex items-center justify-center">
      <div class="text-center">
        <AlertTriangle class="mx-auto mb-3 size-10 text-destructive" />
        <h3 class="mb-1 text-base font-medium">Erreur de chargement</h3>
        <p class="mb-3 text-sm text-muted-foreground">{{ error }}</p>
        <UiButton size="sm" @click="loadDashboard">
          <RefreshCw class="mr-2 size-3.5" />
          Reessayer
        </UiButton>
      </div>
    </div>
  </div>
</template>
