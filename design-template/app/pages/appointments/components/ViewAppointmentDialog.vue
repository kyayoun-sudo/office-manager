<template>
  <UiSheet :open="open" @update:open="$emit('update:open', $event)">
    <UiSheetContent side="right" class="w-full sm:max-w-lg overflow-y-auto p-0">
      <div v-if="appointment" class="flex flex-col h-full">
        <div class="sticky top-0 z-10 border-b bg-background px-6 py-4">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-xs font-mono text-muted-foreground">#{{ appointment.id }}</p>
              <h2 class="text-lg font-semibold tracking-tight">Rendez-vous</h2>
            </div>
            <UiBadge :class="statusStyles[appointment.status] || statusStyles.pending">
              {{ statusLabels[appointment.status] || appointment.status }}
            </UiBadge>
          </div>
        </div>

        <div class="flex-1 divide-y">
          <section class="px-6 py-4 space-y-3">
            <h3 class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Rendez-vous</h3>
            <dl class="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
              <div>
                <dt class="text-muted-foreground">Date</dt>
                <dd class="font-medium">{{ formatDate(appointment.appointmentDate) }}</dd>
              </div>
              <div>
                <dt class="text-muted-foreground">Heure</dt>
                <dd class="font-medium">{{ formatTime(appointment.appointmentDate) }}</dd>
              </div>
              <div>
                <dt class="text-muted-foreground">Duree</dt>
                <dd>{{ appointment.duration ? `${appointment.duration} min` : 'Non definie' }}</dd>
              </div>
              <div>
                <dt class="text-muted-foreground">Categorie</dt>
                <dd>{{ categoryLabel }}</dd>
              </div>
              <div v-if="appointment.specialty" class="col-span-2">
                <dt class="text-muted-foreground">Specialite</dt>
                <dd>{{ appointment.specialty.name || appointment.specialty.code }}</dd>
              </div>
              <div v-if="appointment.isAdditional">
                <dt class="text-muted-foreground">Type</dt>
                <dd>Additionnel</dd>
              </div>
              <div v-if="appointment.consultationLocation">
                <dt class="text-muted-foreground">Lieu</dt>
                <dd>{{ appointment.consultationLocation }}</dd>
              </div>
            </dl>
          </section>

          <section v-if="patientData" class="px-6 py-4 space-y-3">
            <h3 class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Patient</h3>
            <div class="flex items-center gap-3">
              <UiAvatar class="h-9 w-9">
                <UiAvatarFallback class="bg-sky-100 text-sky-700 text-xs dark:bg-sky-950/30 dark:text-sky-400">
                  {{ initials2(patientData.firstName, patientData.lastName) }}
                </UiAvatarFallback>
              </UiAvatar>
              <div class="min-w-0">
                <p class="text-[13px] font-medium truncate">
                  {{ fullName(patientData.firstName, patientData.lastName) }}
                </p>
                <p class="text-xs text-muted-foreground truncate">{{ patientData.email || '-' }}</p>
              </div>
            </div>
            <dl class="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
              <div>
                <dt class="text-muted-foreground">Telephone</dt>
                <dd>{{ patientData.phone || '-' }}</dd>
              </div>
              <div v-if="patientData.birthDate">
                <dt class="text-muted-foreground">Naissance</dt>
                <dd>{{ formatDate(patientData.birthDate) }}</dd>
              </div>
              <div v-if="appointment?.patient?.user?.address" class="col-span-2">
                <dt class="text-muted-foreground">Adresse</dt>
                <dd>{{ patientAddress }}</dd>
              </div>
              <div v-if="appointment?.patient?.numberOfChildren !== undefined">
                <dt class="text-muted-foreground">Enfants</dt>
                <dd>{{ appointment.patient.numberOfChildren }}</dd>
              </div>
              <div v-if="appointment?.patient?.allergies" class="col-span-2">
                <dt class="text-muted-foreground">Allergies</dt>
                <dd>{{ appointment.patient.allergies }}</dd>
              </div>
            </dl>
          </section>

          <section v-if="clinicianData" class="px-6 py-4 space-y-3">
            <h3 class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Sage-femme</h3>
            <div class="flex items-center gap-3">
              <UiAvatar class="h-9 w-9">
                <UiAvatarFallback class="bg-emerald-100 text-emerald-700 text-xs dark:bg-emerald-950/30 dark:text-emerald-400">
                  {{ initials2(clinicianData.firstName, clinicianData.lastName) }}
                </UiAvatarFallback>
              </UiAvatar>
              <div class="min-w-0">
                <p class="text-[13px] font-medium truncate">
                  {{ fullName(clinicianData.firstName, clinicianData.lastName) }}
                </p>
                <p class="text-xs text-muted-foreground truncate">{{ clinicianData.email || '-' }}</p>
              </div>
            </div>
            <dl class="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
              <div>
                <dt class="text-muted-foreground">Telephone</dt>
                <dd>{{ clinicianData.phone || '-' }}</dd>
              </div>
              <div v-if="clinicianData.preferredLanguages?.length">
                <dt class="text-muted-foreground">Langues</dt>
                <dd>{{ clinicianData.preferredLanguages.join(', ') }}</dd>
              </div>
            </dl>
          </section>

          <section v-if="appointment.office" class="px-6 py-4 space-y-3">
            <h3 class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Cabinet</h3>
            <dl class="space-y-2 text-[13px]">
              <div>
                <dt class="text-muted-foreground">Nom</dt>
                <dd class="font-medium">{{ appointment.office.name }}</dd>
              </div>
              <div v-if="appointment.office.address">
                <dt class="text-muted-foreground">Adresse</dt>
                <dd>{{ appointment.office.address }}</dd>
              </div>
              <div v-if="appointment.office.phone" class="flex gap-6">
                <div>
                  <dt class="text-muted-foreground">Telephone</dt>
                  <dd>{{ appointment.office.phone }}</dd>
                </div>
                <div v-if="appointment.office.email">
                  <dt class="text-muted-foreground">Email</dt>
                  <dd>{{ appointment.office.email }}</dd>
                </div>
              </div>
            </dl>
          </section>

          <section v-if="appointment.notes" class="px-6 py-4 space-y-3">
            <h3 class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Notes</h3>
            <p class="text-[13px] whitespace-pre-wrap rounded-md bg-muted px-3 py-2 leading-relaxed">{{ appointment.notes }}</p>
          </section>

          <section v-if="hasPregnancyInfo" class="px-6 py-4 space-y-3">
            <h3 class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Grossesse / Accouchement</h3>
            <dl class="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
              <div v-if="appointment.expectedDeliveryDate">
                <dt class="text-muted-foreground">Date prevue</dt>
                <dd>{{ formatDate(appointment.expectedDeliveryDate) }}</dd>
              </div>
              <div v-if="appointment.deliveryDate">
                <dt class="text-muted-foreground">Date reelle</dt>
                <dd>{{ formatDate(appointment.deliveryDate) }}</dd>
              </div>
              <div v-if="appointment.deliveryTermWeeks || appointment.deliveryTermDays">
                <dt class="text-muted-foreground">Terme</dt>
                <dd>{{ appointment.deliveryTermWeeks || 0 }}s{{ appointment.deliveryTermDays ? ` ${appointment.deliveryTermDays}j` : '' }}</dd>
              </div>
              <div v-if="appointment.deliveryParity">
                <dt class="text-muted-foreground">Parite</dt>
                <dd>{{ appointment.deliveryParity }}</dd>
              </div>
              <div v-if="appointment.deliveryLocation">
                <dt class="text-muted-foreground">Lieu accouchement</dt>
                <dd>{{ appointment.deliveryLocation }}</dd>
              </div>
              <div v-if="appointment.perineum">
                <dt class="text-muted-foreground">Perinee</dt>
                <dd>{{ appointment.perineum }}</dd>
              </div>
              <div v-if="appointment.pregnancySpecifics" class="col-span-2">
                <dt class="text-muted-foreground">Specificites</dt>
                <dd>{{ appointment.pregnancySpecifics }}</dd>
              </div>
            </dl>
          </section>

          <section v-if="appointment.specialNotes || appointment.patientAddress || appointment.patientPhone" class="px-6 py-4 space-y-3">
            <h3 class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Informations supplementaires</h3>
            <dl class="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
              <div v-if="appointment.patientPhone">
                <dt class="text-muted-foreground">Tel. patient (RDV)</dt>
                <dd>{{ appointment.patientPhone }}</dd>
              </div>
              <div v-if="appointment.patientAddress" class="col-span-2">
                <dt class="text-muted-foreground">Adresse patient (RDV)</dt>
                <dd>{{ [appointment.patientAddress, appointment.patientHouseNumber, appointment.patientPostalCode].filter(Boolean).join(', ') }}</dd>
              </div>
              <div v-if="appointment.specialNotes" class="col-span-2">
                <dt class="text-muted-foreground">Notes speciales</dt>
                <dd class="whitespace-pre-wrap">{{ appointment.specialNotes }}</dd>
              </div>
            </dl>
          </section>

          <section class="px-6 py-4 space-y-3">
            <h3 class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Systeme</h3>
            <dl class="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
              <div>
                <dt class="text-muted-foreground">Cree le</dt>
                <dd>{{ formatDateTime(appointment.createdAt) }}</dd>
              </div>
              <div>
                <dt class="text-muted-foreground">Modifie le</dt>
                <dd>{{ formatDateTime(appointment.updatedAt) }}</dd>
              </div>
              <div v-if="appointment.cancelledAt" class="col-span-2">
                <dt class="text-muted-foreground">Annule le</dt>
                <dd class="text-destructive">{{ formatDateTime(appointment.cancelledAt) }}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>

      <div v-else class="flex h-full items-center justify-center">
        <p class="text-sm text-muted-foreground">Aucun rendez-vous selectionne</p>
      </div>
    </UiSheetContent>
  </UiSheet>
</template>

<script setup lang="ts">
import type { Appointment } from '~~/shared/types/appointment'

const statusLabels: Record<string, string> = {
  pending: 'En attente',
  scheduled: 'Planifie',
  confirmed: 'Confirme',
  completed: 'Termine',
  cancelled: 'Annule',
  in_progress: 'En cours',
  no_show: 'Absent',
}

const statusStyles: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-400',
  scheduled: 'bg-blue-100 text-blue-800 dark:bg-blue-950/30 dark:text-blue-400',
  confirmed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400',
  completed: 'bg-muted text-muted-foreground',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-950/30 dark:text-red-400',
  in_progress: 'bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-400',
  no_show: 'bg-red-100 text-red-800 dark:bg-red-950/30 dark:text-red-400',
}

const props = defineProps<{ open: boolean; appointment: Appointment | null }>()

const clinicianData = computed(() => {
  const a = props.appointment
  if (!a) return null
  const c = a.clinician
  const cu = (a as any).clinicianUser
  return {
    firstName: c?.firstName || cu?.firstName,
    lastName: c?.lastName || cu?.lastName,
    email: c?.email || cu?.email,
    phone: c?.phone || cu?.phone,
    preferredLanguages: c?.preferredLanguages || cu?.preferredLanguages,
  }
})

const patientData = computed(() => {
  const a = props.appointment
  if (!a) return null
  const u = a.patient?.user
  const p = a.patient as any
  return {
    firstName: u?.firstName || p?.firstName,
    lastName: u?.lastName || p?.lastName,
    email: u?.email || p?.email,
    phone: u?.phone || p?.phone,
    birthDate: u?.birthDate || p?.birthDate,
  }
})

const categoryLabel = computed(() => {
  const cat = props.appointment?.category
  if (!cat) return '-'
  if (cat.name) return cat.name
  const translations = (cat as any)?.translations
  if (translations?.length) {
    const fr = translations.find((t: any) => t.language?.code === 'fr' || t.languageCode === 'fr')
    return fr?.name || translations[0]?.name || cat.code
  }
  return cat.code || '-'
})

const fullName = (first?: string, last?: string) =>
  first && last ? `${first} ${last}` : 'Inconnu'

const initials2 = (first?: string, last?: string) =>
  `${first?.[0] || ''}${last?.[0] || ''}`.toUpperCase() || '?'

const hasPregnancyInfo = computed(() => {
  const a = props.appointment
  return a?.expectedDeliveryDate || a?.deliveryDate || a?.deliveryTermWeeks
    || a?.deliveryTermDays || a?.deliveryParity || a?.deliveryLocation
    || a?.perineum || a?.pregnancySpecifics
})

const patientAddress = computed(() => {
  const u = props.appointment?.patient?.user
  if (!u) return '-'
  return [u.street ? `${u.street}${u.houseNumber ? ` ${u.houseNumber}` : ''}` : u.address, u.postalCode].filter(Boolean).join(', ') || '-'
})

defineEmits<{
  'update:open': [value: boolean]
}>()

const fmt = (d: string | undefined, opts: Intl.DateTimeFormatOptions) => {
  if (!d) return '-'
  try { return new Date(d).toLocaleDateString('fr-FR', opts) }
  catch { return '-' }
}

const formatDate = (d?: string) => fmt(d, { year: 'numeric', month: 'long', day: 'numeric' })

const formatTime = (d?: string) => {
  if (!d) return '-'
  try { return new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) }
  catch { return '-' }
}

const formatDateTime = (d?: string) => fmt(d, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
</script>
