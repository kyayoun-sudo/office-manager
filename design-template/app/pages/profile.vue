<template>
  <div class="container mx-auto py-6 px-4">
    <div class="max-w-4xl mx-auto">
      <!-- Header -->
      <div class="mb-8">
        <h1 class="text-3xl font-bold text-foreground mb-2">Mon Profil</h1>
        <p class="text-muted-foreground">
          Gérez vos informations personnelles et vos préférences
        </p>
      </div>

      <div v-if="isLoading" class="flex justify-center py-12">
        <AppSpinner class="w-8 h-8" />
      </div>

      <div v-else-if="error" class="mb-6">
        <UiAlert variant="destructive">
          <AlertCircle class="h-4 w-4" />
          <UiAlertTitle>Erreur</UiAlertTitle>
          <UiAlertDescription>{{ error }}</UiAlertDescription>
        </UiAlert>
      </div>

      <div v-else-if="profile" class="grid gap-6">
        <!-- Profile Information Card -->
        <UiCard>
          <UiCardHeader>
            <div class="flex items-center space-x-4">
              <UiAvatar class="h-20 w-20">
                <UiAvatarImage :src="`/avatars/0${(profile.id % 5) + 1}.png`" />
                <UiAvatarFallback class="bg-primary text-white text-lg">
                  {{ profile.firstName.charAt(0) }}{{ profile.lastName.charAt(0) }}
                </UiAvatarFallback>
              </UiAvatar>
              <div>
                <UiCardTitle class="text-2xl">
                  {{ profile.firstName }} {{ profile.lastName }}
                </UiCardTitle>
                <UiCardDescription class="text-base">
                  {{ profile.email }}
                </UiCardDescription>
                <UiBadge :variant="profile.isActive ? 'default' : 'destructive'" class="mt-2">
                  {{ profile.isActive ? 'Actif' : 'Inactif' }}
                </UiBadge>
              </div>
            </div>
          </UiCardHeader>
        </UiCard>

        <!-- Edit Profile Form -->
        <UiCard>
          <UiCardHeader>
            <UiCardTitle>Informations Personnelles</UiCardTitle>
            <UiCardDescription>
              Modifiez vos informations personnelles ci-dessous
            </UiCardDescription>
          </UiCardHeader>
          <UiCardContent>
            <form class="space-y-6" @submit.prevent="handleSubmit">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <!-- First Name -->
                <div class="space-y-2">
                  <UiLabel for="firstName">Prénom</UiLabel>
                  <UiInput
                    id="firstName"
                    v-model="formData.firstName"
                    required
                  />
                </div>

                <!-- Last Name -->
                <div class="space-y-2">
                  <UiLabel for="lastName">Nom</UiLabel>
                  <UiInput
                    id="lastName"
                    v-model="formData.lastName"
                    required
                  />
                </div>

                <!-- Phone -->
                <div class="space-y-2">
                  <UiLabel for="phone">Téléphone</UiLabel>
                  <UiInput
                    id="phone"
                    v-model="formData.phone"
                    type="tel"
                    required
                  />
                </div>

                <!-- Preferred Language -->
                <div class="space-y-2">
                  <UiLabel for="preferredLanguage">Langue Préférée</UiLabel>
                  <UiSelect v-model="formData.preferredLanguage">
                    <UiSelectTrigger>
                      <UiSelectValue placeholder="Sélectionnez une langue" />
                    </UiSelectTrigger>
                    <UiSelectContent>
                      <UiSelectItem value="fr">Français</UiSelectItem>
                      <UiSelectItem value="en">English</UiSelectItem>
                      <UiSelectItem value="nl">Nederlands</UiSelectItem>
                      <UiSelectItem value="de">Deutsch</UiSelectItem>
                    </UiSelectContent>
                  </UiSelect>
                </div>

                <!-- Country -->
                <div class="space-y-2">
                  <UiLabel for="country">Pays</UiLabel>
                  <UiSelect v-model="formData.countryId">
                    <UiSelectTrigger>
                      <UiSelectValue placeholder="Sélectionnez un pays" />
                    </UiSelectTrigger>
                    <UiSelectContent>
                      <UiSelectItem
                        v-for="country in countries"
                        :key="country.id"
                        :value="country.id"
                      >
                        {{ country.name }} ({{ country.code }})
                      </UiSelectItem>
                    </UiSelectContent>
                  </UiSelect>
                </div>

                <!-- City -->
                <div class="space-y-2">
                  <UiLabel for="city">Ville</UiLabel>
                  <UiSelect v-model="formData.cityId">
                    <UiSelectTrigger>
                      <UiSelectValue placeholder="Sélectionnez une ville" />
                    </UiSelectTrigger>
                    <UiSelectContent>
                      <UiSelectItem
                        v-for="city in cities"
                        :key="city.id"
                        :value="city.id"
                      >
                        {{ city.name }} ({{ city.postalCode }})
                      </UiSelectItem>
                    </UiSelectContent>
                  </UiSelect>
                </div>
              </div>

              <!-- Google Calendar Integration -->
              <div class="flex items-center space-x-2">
                <UiSwitch
                  id="googleCalendar"
                  v-model:checked="formData.googleCalendarEnabled"
                />
                <UiLabel for="googleCalendar" class="cursor-pointer">
                  Activer l'intégration Google Calendar
                </UiLabel>
              </div>

              <div class="flex justify-end space-x-4 pt-4">
                <UiButton
                  type="button"
                  variant="outline"
                  :disabled="isLoading"
                  @click="resetForm"
                >
                  Annuler
                </UiButton>
                <UiButton
                  type="submit"
                  :disabled="isLoading"
                >
                  <Loader2 v-if="isLoading" class="w-4 h-4 mr-2 animate-spin" />
                  Enregistrer
                </UiButton>
              </div>
            </form>
          </UiCardContent>
        </UiCard>

        <!-- Account Information -->
        <UiCard>
          <UiCardHeader>
            <UiCardTitle>Informations du Compte</UiCardTitle>
            <UiCardDescription>
              Détails sur votre compte et vos permissions
            </UiCardDescription>
          </UiCardHeader>
          <UiCardContent class="space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <UiLabel class="text-sm font-medium text-muted-foreground">Rôle</UiLabel>
                <p class="text-sm font-semibold">{{ profile.role.description }}</p>
              </div>
              <div>
                <UiLabel class="text-sm font-medium text-muted-foreground">Date de Création</UiLabel>
                <p class="text-sm">{{ formatDate(profile.createdAt) }}</p>
              </div>
              <div>
                <UiLabel class="text-sm font-medium text-muted-foreground">Statut</UiLabel>
                <p class="text-sm">{{ profile.isActive ? 'Compte Actif' : 'Compte Inactif' }}</p>
              </div>
              <div>
                <UiLabel class="text-sm font-medium text-muted-foreground">ID Utilisateur</UiLabel>
                <p class="text-sm font-mono">#{{ profile.id }}</p>
              </div>
            </div>
          </UiCardContent>
        </UiCard>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { AlertCircle, Loader2 } from 'lucide-vue-next'
import type { UpdateProfileRequest } from '~~/shared/types/profile'

definePageMeta({
  layout: 'default',
  middleware: 'auth'
})

const { profile, isLoading, error, cities, countries, fetchProfile, updateProfile, fetchCities, fetchCountries } = useProfile()
const toast = useToast()

const formData = ref<UpdateProfileRequest>({
  firstName: '',
  lastName: '',
  phone: '',
  cityId: 0,
  countryId: 0,
  preferredLanguage: 'fr',
  googleCalendarEnabled: false
})

const resetForm = () => {
  if (profile.value) {
    formData.value = {
      firstName: profile.value.firstName,
      lastName: profile.value.lastName,
      phone: profile.value.phone,
      cityId: profile.value.city.id,
      countryId: profile.value.country.id,
      preferredLanguage: profile.value.preferredLanguage,
      googleCalendarEnabled: profile.value.googleCalendarEnabled
    }
  }
}

const handleSubmit = async () => {
  const success = await updateProfile(formData.value)
  
  if (success) {
    toast.handleApiSuccess('Vos informations ont été sauvegardées avec succès.')
  } else {
    toast.handleApiError({ success: false, error: error.value || 'Une erreur est survenue lors de la mise à jour.' }, 'Erreur')
  }
}

const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleDateString('fr-FR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}

// Initialize data
onMounted(async () => {
  await Promise.all([
    fetchProfile(),
    fetchCities(),
    fetchCountries()
  ])
  resetForm()
})

// Watch for profile changes to reset form
watch(profile, () => {
  if (profile.value) {
    resetForm()
  }
})
</script>