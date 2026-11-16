<script setup lang="ts">
import type { Patient } from '~~/shared/types/patient'

interface Props {
  open: boolean
  patient: Patient | null
}

interface Emits {
  (e: 'update:open', value: boolean): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleDateString('fr-FR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}
</script>

<template>
  <UiDialog :open="props.open" @update:open="emit('update:open', $event)">
    <UiDialogContent :prevent-outside-click="true" class="max-w-[90vw] sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
      <UiDialogHeader>
        <UiDialogTitle class="text-primary">Profil Patient</UiDialogTitle>
        <UiDialogDescription>
          Informations détaillées du patient
        </UiDialogDescription>
      </UiDialogHeader>

      <div v-if="props.patient" class="space-y-6">
        <!-- Avatar et infos principales -->
        <div class="flex items-start space-x-4 pb-4 border-b">
          <UiAvatar class="h-16 w-16 flex-shrink-0">
            <UiAvatarImage 
              :src="`https://api.dicebear.com/7.x/initials/svg?seed=${props.patient.user.firstName} ${props.patient.user.lastName}`" 
              :alt="`${props.patient.user.firstName} ${props.patient.user.lastName}`" 
            />
            <UiAvatarFallback class="text-lg">
              {{ props.patient.user.firstName.charAt(0) }}{{ props.patient.user.lastName.charAt(0) }}
            </UiAvatarFallback>
          </UiAvatar>
          
          <div class="flex-1 min-w-0">
            <h3 class="text-xl font-semibold truncate">
              {{ props.patient.user.firstName }} {{ props.patient.user.lastName }}
            </h3>
            <p class="text-muted-foreground break-all">{{ props.patient.user.email }}</p>
            <p v-if="props.patient.bio" class="text-sm text-muted-foreground">{{ props.patient.bio }}</p>
            <div class="flex flex-wrap items-center gap-2 mt-2">
              <UiBadge variant="outline">
                {{ props.patient.numberOfChildren || 0 }} enfant{{ (props.patient.numberOfChildren || 0) > 1 ? 's' : '' }}
              </UiBadge>
            </div>
          </div>
        </div>

        <!-- Informations détaillées -->
        <div class="grid gap-6 md:grid-cols-2">
          <div class="space-y-4">
            <div>
              <label class="text-sm font-medium text-muted-foreground">Prénom</label>
              <p class="text-sm">{{ props.patient.user.firstName }}</p>
            </div>
            
            <div>
              <label class="text-sm font-medium text-muted-foreground">Nom</label>
              <p class="text-sm">{{ props.patient.user.lastName }}</p>
            </div>
            
            <div>
              <label class="text-sm font-medium text-muted-foreground">Email</label>
              <p class="text-sm break-all">{{ props.patient.user.email }}</p>
            </div>
            
            <div>
              <label class="text-sm font-medium text-muted-foreground">Téléphone</label>
              <p class="text-sm">{{ props.patient.user.phone }}</p>
            </div>
            
            <div>
              <label class="text-sm font-medium text-muted-foreground">Date de naissance</label>
              <p class="text-sm">{{ props.patient.birthDate ? formatDate(props.patient.birthDate) : 'Non renseignée' }}</p>
            </div>
            
            <div>
              <label class="text-sm font-medium text-muted-foreground">Adresse</label>
              <p class="text-sm">{{ props.patient.user.address }}</p>
            </div>

          </div>
          
          <div class="space-y-4">
            <div>
              <label class="text-sm font-medium text-muted-foreground">Code postal</label>
              <p class="text-sm">{{ props.patient.user.postalCode || 'Non renseigné' }}</p>
            </div>
            
            <div>
              <label class="text-sm font-medium text-muted-foreground">Bio</label>
              <p class="text-sm">{{ props.patient.bio || 'Aucune bio renseignée' }}</p>
            </div>
            
            <div>
              <label class="text-sm font-medium text-muted-foreground">Allergies</label>
              <p class="text-sm">{{ props.patient.allergies || 'Aucune allergie renseignée' }}</p>
            </div>
            
            <div>
              <label class="text-sm font-medium text-muted-foreground">Nombre d'enfants</label>
              <p class="text-sm">{{ props.patient.numberOfChildren || 0 }}</p>
            </div>
            
            <div>
              <label class="text-sm font-medium text-muted-foreground">ID Patient</label>
              <p class="text-sm font-mono">#{{ props.patient.id }}</p>
            </div>
          </div>
        </div>

        <!-- Informations supplémentaires -->
        <div class="grid gap-4 md:grid-cols-2 pt-4 border-t">
          <div class="text-center p-4 bg-muted rounded-lg">
            <div class="text-2xl font-bold text-primary">{{ props.patient.numberOfChildren || 0 }}</div>
            <div class="text-sm text-muted-foreground">enfant{{ (props.patient.numberOfChildren || 0) > 1 ? 's' : '' }}</div>
          </div>

          <div class="text-center p-4 bg-muted rounded-lg">
            <div class="text-2xl font-bold text-secondary">
              {{ props.patient.user.isActive ? 'ACTIF' : 'INACTIF' }}
            </div>
            <div class="text-sm text-muted-foreground">Statut compte</div>
          </div>
        </div>

        <!-- Distance (si recherche géographique) -->
        <div v-if="props.patient.distance" class="pt-4 border-t">
          <div>
            <label class="text-sm font-medium text-muted-foreground">Distance</label>
            <p class="text-sm">{{ props.patient.distance }} km</p>
          </div>
        </div>
      </div>

      <UiDialogFooter class="flex flex-col sm:flex-row gap-2">
        <UiButton 
          variant="outline" 
          class="w-full sm:w-auto"
          @click="emit('update:open', false)"
        >
          <span class="truncate">Fermer</span>
        </UiButton>
      </UiDialogFooter>
    </UiDialogContent>
  </UiDialog>
</template>