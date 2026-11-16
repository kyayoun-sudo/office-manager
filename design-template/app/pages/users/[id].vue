<script setup lang="ts">
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  CalendarPlus,
  LogIn,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Stethoscope,
  Building2,
  CalendarDays,
  ShieldCheck,
  ShieldX,
  Pencil,
} from 'lucide-vue-next'
import type { AdminUser } from '#shared/types/user'
import type { Midwife } from '~~/shared/types/midwife'
import type { Appointment } from '~~/shared/types/appointment'
import type { Component } from 'vue'

definePageMeta({})
useHead({ title: 'Detail utilisateur - Modèle d’administration' })

const route = useRoute()
const userId = computed(() => Number(route.params.id))

const { getUserById } = useUsers()
const { getMidwifeById, validateMidwife } = useMidwives()

const user = ref<AdminUser | null>(null)
const clinicianDetails = shallowRef<Midwife | null>(null)
const userAppointments = ref<Appointment[]>([])
const isLoading = ref(true)
const isLoadingClinician = ref(false)
const isLoadingAppointments = ref(false)
const clinicianLoaded = ref(false)
const appointmentsLoaded = ref(false)
const isVerifying = ref(false)
const showRejectDialog = ref(false)
const showEditPersonalDialog = ref(false)
const showEditProfessionalDialog = ref(false)
const activeTab = ref('general')

const loadUser = async () => {
  isLoading.value = true
  user.value = await getUserById(userId.value)
  isLoading.value = false
}

const loadClinicianDetails = async () => {
  if (clinicianLoaded.value || !user.value?.clinician?.id) return
  isLoadingClinician.value = true
  clinicianDetails.value = await getMidwifeById(user.value.clinician.id)
  clinicianLoaded.value = true
  isLoadingClinician.value = false
}

const loadAppointments = async () => {
  if (appointmentsLoaded.value || !user.value) return
  isLoadingAppointments.value = true
  try {
    const response = await api.get<any>('/appointments?sortBy=appointmentDate&sortOrder=DESC&limit=100')
    const allAppointments = response?.success && Array.isArray(response.data)
      ? response.data
      : response?.success && response.data?.data
        ? response.data.data
        : []
    const isClinician = !!user.value.clinician
    const isPatient = !!user.value.patient
    userAppointments.value = allAppointments
      .filter((apt: Appointment) => {
        if (isClinician) return apt.clinician?.id === user.value?.id
        if (isPatient) return apt.patient?.user?.id === user.value?.id
        return false
      })
      .slice(0, 10)
  } catch {
    userAppointments.value = []
  } finally {
    appointmentsLoaded.value = true
    isLoadingAppointments.value = false
  }
}

watch(activeTab, (tab) => {
  if (['professional', 'specialties', 'offices'].includes(tab)) {
    loadClinicianDetails()
  }
  if (tab === 'appointments') {
    loadAppointments()
  }
})

onMounted(() => {
  loadUser()
})

const roleColors: Record<string, string> = {
  admin: 'bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-400',
  support: 'bg-violet-100 text-violet-800 dark:bg-violet-950/30 dark:text-violet-400',
  clinician: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400',
  patient: 'bg-sky-100 text-sky-800 dark:bg-sky-950/30 dark:text-sky-400',
}

const roleStyle = computed(() => roleColors[user.value?.role?.code ?? ''] ?? 'bg-muted text-muted-foreground')

const fullAddress = computed(() => {
  const u = user.value
  if (!u) return null
  const parts: string[] = []
  if (u.address) parts.push(u.address)
  if (u.postalCode) parts.push(u.postalCode)
  if (u.city?.name) parts.push(u.city.name)
  if (u.city?.country?.name) parts.push(u.city.country.name)
  return parts.length ? parts.join(', ') : null
})

const locationDisplay = computed(() => {
  const city = user.value?.city
  if (!city?.name) return null
  return city.postalCode ? `${city.name} (${city.postalCode})` : city.name
})

const verificationStyle = computed(() => {
  const verified = user.value?.clinician?.verified
  if (verified === true) return { label: 'Verifiee', icon: CheckCircle2 as Component, classes: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400' }
  if (verified === false) return { label: 'Rejetee', icon: XCircle as Component, classes: 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400' }
  return { label: 'En attente', icon: Clock as Component, classes: 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400' }
})

const clinicianOffices = computed(() => {
  if (!clinicianDetails.value) return []
  return (clinicianDetails.value as any).offices || []
})

const formatDate = (dateString: string | null | undefined) => {
  if (!dateString) return 'Non defini'
  try {
    const date = new Date(dateString)
    if (isNaN(date.getTime())) return 'Date invalide'
    return new Intl.DateTimeFormat('fr-FR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
  } catch { return 'Date invalide' }
}

const formatShortDate = (dateString: string) => {
  try {
    return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(dateString))
  } catch { return dateString }
}

const getLanguageLabel = (lang: string) => {
  const languages: Record<string, string> = { fr: 'Francais', en: 'English', nl: 'Nederlands', es: 'Espanol', de: 'Deutsch', it: 'Italiano' }
  return languages[lang] || lang.toUpperCase()
}

const appointmentStatusConfig: Record<string, { label: string; classes: string }> = {
  pending: { label: 'En attente', classes: 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400' },
  scheduled: { label: 'Planifie', classes: 'bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400' },
  confirmed: { label: 'Confirme', classes: 'bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400' },
  completed: { label: 'Termine', classes: 'bg-muted text-muted-foreground' },
  cancelled: { label: 'Annule', classes: 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400' },
  in_progress: { label: 'En cours', classes: 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400' },
  no_show: { label: 'Absent', classes: 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400' },
}

const { handleApiSuccess } = useToast()

const handleValidate = async () => {
  if (!user.value?.clinician?.id) return
  isVerifying.value = true
  const success = await validateMidwife(user.value.clinician.id)
  if (success) {
    handleApiSuccess('Inscription validee avec succes')
    await loadUser()
  }
  isVerifying.value = false
}

const onRejected = async () => {
  showRejectDialog.value = false
  await loadUser()
}

const onUserUpdated = async () => {
  await loadUser()
  if (user.value?.clinician?.id) {
    clinicianLoaded.value = false
    await loadClinicianDetails()
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center gap-3">
      <UiButton variant="ghost" size="icon" @click="navigateTo('/users')">
        <ArrowLeft class="h-4 w-4" />
      </UiButton>
      <div>
        <h1 class="text-2xl font-bold tracking-tight">Detail utilisateur</h1>
        <p class="text-sm text-muted-foreground">Informations completes de l'utilisateur</p>
      </div>
    </div>

    <div v-if="isLoading" class="flex items-center justify-center py-20">
      <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
    </div>

    <template v-else-if="user">
      <div class="rounded-lg border bg-gradient-to-br from-emerald-50/80 via-background to-sky-50/60 dark:from-emerald-950/20 dark:via-background dark:to-sky-950/20 px-6 py-5">
        <div class="flex items-start gap-4">
          <div class="relative flex-shrink-0">
            <UiAvatar class="h-16 w-16 ring-2 ring-background shadow-md">
              <UiAvatarFallback class="bg-emerald-100 text-lg font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
                {{ user.firstName?.[0] }}{{ user.lastName?.[0] }}
              </UiAvatarFallback>
            </UiAvatar>
            <span :class="['absolute -bottom-0.5 -right-0.5 block h-4 w-4 rounded-full ring-2 ring-background', user.isActive ? 'bg-emerald-500' : 'bg-muted-foreground/40']" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2.5">
              <h2 class="truncate text-xl font-bold tracking-tight text-foreground">{{ user.firstName }} {{ user.lastName }}</h2>
              <span :class="['inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider', roleStyle]">{{ user.role?.name }}</span>
            </div>
            <div class="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
              <span class="inline-flex items-center gap-1.5"><Mail class="h-3.5 w-3.5" />{{ user.email }}</span>
              <span v-if="user.phone" class="inline-flex items-center gap-1.5"><Phone class="h-3.5 w-3.5" />{{ user.phone }}</span>
              <span v-if="fullAddress" class="inline-flex items-center gap-1.5"><MapPin class="h-3.5 w-3.5" />{{ fullAddress }}</span>
            </div>
          </div>
        </div>
      </div>

      <UiTabs v-model="activeTab">
        <UiTabsList>
          <UiTabsTrigger value="general">Informations</UiTabsTrigger>
          <UiTabsTrigger v-if="user.clinician" value="professional">Profil professionnel</UiTabsTrigger>
          <UiTabsTrigger v-if="user.clinician" value="specialties">Specialites</UiTabsTrigger>
          <UiTabsTrigger v-if="user.clinician" value="offices">Cabinets</UiTabsTrigger>
          <UiTabsTrigger value="appointments">Rendez-vous</UiTabsTrigger>
        </UiTabsList>

        <UiTabsContent value="general">
          <div class="border border-border p-6 divide-y divide-border">
              <section class="pb-5">
                <div class="mb-3.5 flex items-center justify-between">
                <h3 class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Informations personnelles</h3>
                <UiButton size="sm" variant="outline" @click="showEditPersonalDialog = true">
                  <Pencil class="h-3.5 w-3.5 mr-1" />
                  Modifier
                </UiButton>
              </div>
                <dl class="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
                  <div><dt class="text-[13px] font-medium text-muted-foreground">Nom complet</dt><dd class="mt-0.5 text-[13px] text-foreground">{{ user.firstName }} {{ user.lastName }}</dd></div>
                  <div><dt class="text-[13px] font-medium text-muted-foreground">Adresse email</dt><dd class="mt-0.5 text-[13px] text-foreground">{{ user.email }}</dd></div>
                  <div><dt class="text-[13px] font-medium text-muted-foreground">Telephone</dt><dd class="mt-0.5 text-[13px] text-foreground">{{ user.phone || 'Non renseigne' }}</dd></div>
                  <div class="sm:col-span-2"><dt class="text-[13px] font-medium text-muted-foreground">Adresse</dt><dd class="mt-0.5 text-[13px] text-foreground">{{ fullAddress || 'Non renseignee' }}</dd></div>
                  <div class="sm:col-span-2">
                    <dt class="text-[13px] font-medium text-muted-foreground">Langues</dt>
                    <dd class="mt-0.5 flex flex-wrap gap-1.5">
                      <span v-for="lang in user.preferredLanguages" :key="lang" class="inline-flex rounded-md bg-muted px-2 py-0.5 text-[12px] font-medium text-muted-foreground">{{ getLanguageLabel(lang) }}</span>
                      <span v-if="!user.preferredLanguages?.length" class="text-[13px] text-muted-foreground">Aucune langue configuree</span>
                    </dd>
                  </div>
                </dl>
              </section>
              <section class="py-5">
                <h3 class="mb-3.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Parametres du compte</h3>
                <dl class="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-3">
                  <div><dt class="text-[13px] font-medium text-muted-foreground">Google Calendar</dt><dd class="mt-0.5 flex items-center gap-1.5"><span :class="['inline-block h-1.5 w-1.5 rounded-full', user.googleCalendarEnabled ? 'bg-emerald-500' : 'bg-muted-foreground/40']" /><span class="text-[13px] font-medium text-foreground">{{ user.googleCalendarEnabled ? 'Active' : 'Desactive' }}</span></dd></div>
                  <div><dt class="text-[13px] font-medium text-muted-foreground">iCloud Calendar</dt><dd class="mt-0.5 flex items-center gap-1.5"><span :class="['inline-block h-1.5 w-1.5 rounded-full', user.iCloudCalendarEnabled ? 'bg-emerald-500' : 'bg-muted-foreground/40']" /><span class="text-[13px] font-medium text-foreground">{{ user.iCloudCalendarEnabled ? 'Active' : 'Desactive' }}</span></dd></div>
                  <div><dt class="text-[13px] font-medium text-muted-foreground">Statut</dt><dd class="mt-0.5 flex items-center gap-1.5"><span :class="['inline-block h-1.5 w-1.5 rounded-full', user.isActive ? 'bg-emerald-500' : 'bg-muted-foreground/40']" /><span class="text-[13px] font-medium text-foreground">{{ user.isActive ? 'Actif' : 'Inactif' }}</span></dd></div>
                </dl>
              </section>
              <section class="pt-5">
                <h3 class="mb-3.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Activite</h3>
                <div class="flex flex-col gap-2.5 sm:flex-row sm:gap-8">
                  <div class="flex items-center gap-2.5">
                    <div class="flex h-8 w-8 items-center justify-center rounded-full bg-muted"><CalendarPlus class="h-3.5 w-3.5 text-muted-foreground" /></div>
                    <div><p class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Inscription</p><p class="text-[13px] font-medium text-foreground">{{ formatDate(user.createdAt) }}</p></div>
                  </div>
                  <div class="flex items-center gap-2.5">
                    <div class="flex h-8 w-8 items-center justify-center rounded-full bg-muted"><LogIn class="h-3.5 w-3.5 text-muted-foreground" /></div>
                    <div><p class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Derniere connexion</p><p class="text-[13px] font-medium text-foreground">{{ user.lastLoginAt ? formatDate(user.lastLoginAt) : 'Jamais' }}</p></div>
                  </div>
                </div>
              </section>
          </div>
        </UiTabsContent>

        <UiTabsContent v-if="user.clinician" value="professional">
          <div v-if="isLoadingClinician" class="border border-border flex items-center justify-center py-12">
            <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
          <div v-else class="border border-border p-6 divide-y divide-border">
              <section class="pb-5">
                <div class="mb-4 flex items-center justify-between">
                  <h3 class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Verification</h3>
                  <div class="flex items-center gap-2">
                    <span :class="['inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold', verificationStyle.classes]">
                      <component :is="verificationStyle.icon" class="h-3 w-3" />{{ verificationStyle.label }}
                    </span>
                    <template v-if="user.clinician.verified !== true">
                      <UiButton size="sm" :disabled="isVerifying" @click="handleValidate">
                        <ShieldCheck class="h-3.5 w-3.5 mr-1" />
                        Valider
                      </UiButton>
                      <UiButton
                        v-if="user.clinician.verified !== false"
                        size="sm" variant="destructive" :disabled="isVerifying"
                        @click="showRejectDialog = true"
                      >
                        <ShieldX class="h-3.5 w-3.5 mr-1" />
                        Rejeter
                      </UiButton>
                    </template>
                  </div>
                </div>
                <div v-if="user.clinician.verified === false && user.clinician.rejectionReason" class="rounded-lg border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20 px-3.5 py-2.5">
                  <p class="text-[11px] font-semibold uppercase tracking-wider text-red-400 dark:text-red-500">Motif du rejet</p>
                  <p class="mt-0.5 text-[13px] leading-relaxed text-red-700 dark:text-red-300">{{ user.clinician.rejectionReason }}</p>
                </div>
                <p v-else-if="user.clinician.verifiedAt" class="text-[12px] text-muted-foreground">Verifiee le {{ formatDate(user.clinician.verifiedAt) }}</p>
              </section>
              <section class="py-5">
                <div class="mb-3.5 flex items-center justify-between">
                  <h3 class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Informations professionnelles</h3>
                  <UiButton size="sm" variant="outline" @click="showEditProfessionalDialog = true">
                    <Pencil class="h-3.5 w-3.5 mr-1" />
                    Modifier
                  </UiButton>
                </div>
                <dl class="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
                  <div><dt class="text-[13px] font-medium text-muted-foreground">Numero INAMI</dt><dd class="mt-0.5 text-[13px] font-mono tracking-wide text-foreground">{{ user.clinician.inamiNumber || 'Non renseigne' }}</dd></div>
                  <div><dt class="text-[13px] font-medium text-muted-foreground">Experience</dt><dd class="mt-0.5 text-[13px] text-foreground">{{ user.clinician.experienceYears ? `${user.clinician.experienceYears} ans` : 'Non renseignee' }}</dd></div>
                  <div><dt class="text-[13px] font-medium text-muted-foreground">Tarifs conventionnes</dt><dd class="mt-0.5 text-[13px] text-foreground">{{ user.clinician.conventionalRates != null ? `${user.clinician.conventionalRates} EUR` : 'Non renseigne' }}</dd></div>
                  <div><dt class="text-[13px] font-medium text-muted-foreground">Langues parlees</dt>
                    <dd class="mt-0.5 flex flex-wrap gap-1.5">
                      <span v-for="lang in user.clinician.languages" :key="lang" class="inline-flex rounded-md bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 text-[12px] font-medium text-emerald-700 dark:text-emerald-400">{{ getLanguageLabel(lang) }}</span>
                      <span v-if="!user.clinician.languages?.length" class="text-[13px] text-muted-foreground">Non renseignees</span>
                    </dd>
                  </div>
                </dl>
              </section>
              <section v-if="user.clinician.bio" class="pt-5">
                <h3 class="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Biographie</h3>
                <p class="whitespace-pre-wrap rounded-lg bg-muted px-3.5 py-2.5 text-[13px] leading-relaxed text-muted-foreground">{{ user.clinician.bio }}</p>
              </section>
          </div>
        </UiTabsContent>

        <UiTabsContent v-if="user.clinician" value="specialties">
          <div v-if="isLoadingClinician" class="border border-border flex items-center justify-center py-12">
            <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
          <div v-else class="border border-border p-6">
              <template v-if="clinicianDetails?.specialties?.length">
                <h3 class="mb-3.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Specialites ({{ clinicianDetails.specialties.length }})</h3>
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div v-for="specialty in clinicianDetails.specialties" :key="specialty.id" class="flex items-start gap-3 rounded-lg border border-border bg-muted/50 px-3.5 py-3">
                    <div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/30"><Stethoscope class="h-4 w-4 text-emerald-600 dark:text-emerald-400" /></div>
                    <div class="min-w-0">
                      <p class="text-[13px] font-medium text-foreground">{{ specialty.translations?.[0]?.name || specialty.code }}</p>
                      <p v-if="specialty.category" class="mt-0.5 text-[12px] text-muted-foreground">{{ specialty.category.translations?.[0]?.name || specialty.category.code }}</p>
                    </div>
                  </div>
                </div>
              </template>
              <div v-else class="py-8 text-center">
                <Stethoscope class="mx-auto h-8 w-8 text-muted-foreground/40" />
                <p class="mt-2 text-[13px] text-muted-foreground">Aucune specialite configuree</p>
              </div>
          </div>
        </UiTabsContent>

        <UiTabsContent v-if="user.clinician" value="offices">
          <div class="space-y-4">
            <div v-if="isLoadingClinician" class="border border-border flex items-center justify-center py-12">
              <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
            <div v-else class="border border-border p-6">
                <template v-if="clinicianOffices.length">
                  <h3 class="mb-3.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Cabinets ({{ clinicianOffices.length }})</h3>
                  <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div v-for="office in clinicianOffices" :key="office.id" class="rounded-lg border p-4">
                      <div class="flex items-start gap-3">
                        <div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg" :style="{ backgroundColor: (office.color || '#4CAF50') + '20' }">
                          <Building2 class="h-5 w-5" :style="{ color: office.color || '#4CAF50' }" />
                        </div>
                        <div class="min-w-0 flex-1">
                          <div class="flex items-center gap-2">
                            <p class="text-sm font-semibold text-foreground">{{ office.name }}</p>
                            <span :class="['inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium', office.isActive ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400' : 'bg-muted text-muted-foreground']">
                              {{ office.isActive ? 'Actif' : 'Inactif' }}
                            </span>
                          </div>
                          <p v-if="office.address" class="mt-1 flex items-center gap-1 text-[12px] text-muted-foreground">
                            <MapPin class="h-3 w-3" />{{ office.address }}
                          </p>
                          <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
                            <span v-if="office.phone" class="inline-flex items-center gap-1"><Phone class="h-3 w-3" />{{ office.phone }}</span>
                            <span v-if="office.email" class="inline-flex items-center gap-1"><Mail class="h-3 w-3" />{{ office.email }}</span>
                            <span v-if="office.defaultDuration" class="inline-flex items-center gap-1"><Clock class="h-3 w-3" />{{ office.defaultDuration }} min</span>
                          </div>
                          <p v-if="office.description" class="mt-2 text-[12px] text-muted-foreground">{{ office.description }}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </template>
                <div v-else class="py-8 text-center">
                  <Building2 class="mx-auto h-8 w-8 text-muted-foreground/40" />
                  <p class="mt-2 text-[13px] text-muted-foreground">Aucun cabinet configure</p>
                </div>
            </div>

            <div class="border border-border p-6">
              <WeeklyAvailability :clinician-id="user.clinician.id" :offices="clinicianOffices" />
            </div>
          </div>
        </UiTabsContent>

        <UiTabsContent value="appointments">
          <div class="border border-border p-6">
              <div v-if="isLoadingAppointments" class="flex items-center justify-center py-8">
                <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
                <span class="ml-2 text-[13px] text-muted-foreground">Chargement des rendez-vous...</span>
              </div>
              <template v-else-if="userAppointments.length">
                <h3 class="mb-3.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Derniers rendez-vous ({{ userAppointments.length }})
                </h3>
                <div class="space-y-2">
                  <div v-for="apt in userAppointments" :key="apt.id" class="flex items-center gap-4 rounded-lg border p-3">
                    <div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-muted">
                      <CalendarDays class="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <p class="text-sm font-medium text-foreground">{{ formatShortDate(apt.appointmentDate) }}</p>
                        <span :class="['inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium', (appointmentStatusConfig[apt.status] || appointmentStatusConfig.pending).classes]">
                          {{ (appointmentStatusConfig[apt.status] || appointmentStatusConfig.pending).label }}
                        </span>
                      </div>
                      <div class="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-muted-foreground">
                        <span v-if="apt.patient?.user">Patient: {{ apt.patient.user.firstName }} {{ apt.patient.user.lastName }}</span>
                        <span v-if="apt.clinician">Sage-femme: {{ apt.clinician.firstName }} {{ apt.clinician.lastName }}</span>
                        <span v-if="apt.office">{{ apt.office.name }}</span>
                        <span v-if="apt.duration">{{ apt.duration }} min</span>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
              <div v-else class="py-8 text-center">
                <CalendarDays class="mx-auto h-8 w-8 text-muted-foreground/40" />
                <p class="mt-2 text-[13px] text-muted-foreground">Aucun rendez-vous trouve</p>
              </div>
          </div>
        </UiTabsContent>
      </UiTabs>
    </template>

    <div v-else class="py-20 text-center">
      <p class="text-muted-foreground">Utilisateur introuvable</p>
      <UiButton variant="outline" class="mt-4" @click="navigateTo('/users')">Retour a la liste</UiButton>
    </div>

    <RejectClinicianDialog
      :open="showRejectDialog"
      :user="user"
      @update:open="showRejectDialog = $event"
      @rejected="onRejected"
    />

    <EditPersonalInfoDialog
      :open="showEditPersonalDialog"
      :user="user"
      @update:open="showEditPersonalDialog = $event"
      @updated="onUserUpdated"
    />

    <EditProfessionalInfoDialog
      :open="showEditProfessionalDialog"
      :user="user"
      :clinician-details="clinicianDetails"
      @update:open="showEditProfessionalDialog = $event"
      @updated="onUserUpdated"
    />
  </div>
</template>
