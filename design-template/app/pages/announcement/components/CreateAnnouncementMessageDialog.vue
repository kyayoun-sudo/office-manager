<template>
  <UiDialog :open="open" @update:open="$emit('update:open', $event)">
    <UiDialogContent class="max-w-4xl max-h-[90vh] overflow-y-auto">
      <UiDialogHeader>
        <UiDialogTitle class="flex items-center space-x-2">
          <MegaphoneIcon class="h-5 w-5 text-primary" />
          <span>Créer un nouveau message d'annonce</span>
        </UiDialogTitle>
        <UiDialogDescription>
          Ajoutez un nouveau message d'annonce avec des traductions dans les 4 langues supportées.
        </UiDialogDescription>
      </UiDialogHeader>
      
      <div class="space-y-6">
        <!-- Basic Information -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="space-y-2">
            <label class="text-sm font-medium text-foreground">
              Type de message *
            </label>
            <UiSelect v-model="formData.message.type" :disabled="isLoading">
              <UiSelectTrigger :class="{ 'border-red-500': errors.type }">
                <UiSelectValue placeholder="Choisir un type" />
              </UiSelectTrigger>
              <UiSelectContent>
                <UiSelectItem value="feature">Fonctionnalité</UiSelectItem>
                <UiSelectItem value="maintenance">Maintenance</UiSelectItem>
                <UiSelectItem value="security">Sécurité</UiSelectItem>
                <UiSelectItem value="billing_system">Facturation</UiSelectItem>
                <UiSelectItem value="general">Général</UiSelectItem>
                <UiSelectItem value="promotion">Promotion</UiSelectItem>
                <UiSelectItem value="update">Mise à jour</UiSelectItem>
              </UiSelectContent>
            </UiSelect>
            <p v-if="errors.type" class="text-xs text-red-600">{{ errors.type }}</p>
          </div>

          <div class="space-y-2">
            <label class="text-sm font-medium text-foreground">
              Priorité *
            </label>
            <UiSelect v-model="formData.message.priority" :disabled="isLoading">
              <UiSelectTrigger :class="{ 'border-red-500': errors.priority }">
                <UiSelectValue placeholder="Choisir une priorité" />
              </UiSelectTrigger>
              <UiSelectContent>
                <UiSelectItem value="info">Information</UiSelectItem>
                <UiSelectItem value="normal">Normale</UiSelectItem>
                <UiSelectItem value="medium">Moyenne</UiSelectItem>
                <UiSelectItem value="high">Haute</UiSelectItem>
                <UiSelectItem value="urgent">Urgent</UiSelectItem>
              </UiSelectContent>
            </UiSelect>
            <p v-if="errors.priority" class="text-xs text-red-600">{{ errors.priority }}</p>
          </div>

          <div class="space-y-2">
            <label class="text-sm font-medium text-foreground">
              Destinataires
            </label>
            <UiSelect v-model="formData.message.targetType" :disabled="isLoading">
              <UiSelectTrigger>
                <UiSelectValue placeholder="Tous les utilisateurs" />
              </UiSelectTrigger>
              <UiSelectContent>
                <UiSelectItem value="all">Tous les utilisateurs</UiSelectItem>
                <UiSelectItem value="provider">Prestataires</UiSelectItem>
                <UiSelectItem value="clinician">Cliniciens</UiSelectItem>
                <UiSelectItem value="midwives">Sages-femmes</UiSelectItem>
                <UiSelectItem value="patients">Patients</UiSelectItem>
                <UiSelectItem value="patient">Patient</UiSelectItem>
              </UiSelectContent>
            </UiSelect>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="space-y-2">
            <label class="text-sm font-medium text-foreground">
              Programmer l'envoi (optionnel)
            </label>
            <UiInput
              v-model="formData.message.scheduledAt"
              type="datetime-local"
              :disabled="isLoading"
            />
            <p class="text-xs text-muted-foreground">Si vide, le message sera créé en brouillon</p>
          </div>

          <div class="space-y-2">
            <label class="text-sm font-medium text-foreground">
              Statut initial
            </label>
            <UiSelect v-model="formData.message.isActive" :disabled="isLoading">
              <UiSelectTrigger>
                <UiSelectValue />
              </UiSelectTrigger>
              <UiSelectContent>
                <UiSelectItem :value="true">Actif</UiSelectItem>
                <UiSelectItem :value="false">Inactif</UiSelectItem>
              </UiSelectContent>
            </UiSelect>
          </div>
        </div>

        <!-- Language Tabs -->
        <div class="space-y-4">
          <div class="flex items-center space-x-2">
            <Globe class="h-4 w-4 text-primary" />
            <h3 class="text-lg font-semibold">Traductions</h3>
          </div>

          <ClientOnly>
            <!-- Language Tab Navigation -->
            <div class="flex space-x-1 border-b">
              <button
                v-for="lang in languages"
                :key="lang.code"
                :class="{
                  'border-b-2 border-primary text-primary': activeTab === lang.code,
                  'text-muted-foreground hover:text-foreground': activeTab !== lang.code,
                  'border-red-500': hasTabErrors(lang.code),
                  'border-green-500': isTabComplete(lang.code) && !hasTabErrors(lang.code)
                }"
                class="px-4 py-2 text-sm font-medium transition-colors relative"
                :disabled="isLoading"
                @click="changeTab(lang.code)"
              >
                <div class="flex items-center space-x-2">
                  <span>{{ lang.flag }}</span>
                  <span>{{ lang.name }}</span>
                  <!-- Completion indicator -->
                  <div 
                    v-if="isTabComplete(lang.code)" 
                    class="w-2 h-2 bg-green-500 rounded-full"
                    title="Traduction complète"
                  />
                  <div 
                    v-else-if="hasTabErrors(lang.code)" 
                    class="w-2 h-2 bg-red-500 rounded-full"
                    title="Erreurs dans cette traduction"
                  />
                </div>
              </button>
            </div>

            <!-- Language Tab Content -->
            <div class="space-y-4 p-4 border rounded-lg bg-muted/20">
              <template v-for="lang in languages" :key="lang.code">
                <div v-if="activeTab === lang.code" class="space-y-4">
                  <div class="flex items-center space-x-2 mb-4">
                    <span class="text-2xl">{{ lang.flag }}</span>
                    <h4 class="text-lg font-medium">{{ lang.name }}</h4>
                  </div>

                  <div class="grid grid-cols-1 gap-4">
                    <div class="space-y-2">
                      <label class="text-sm font-medium text-foreground">
                        Titre du message * ({{ lang.name }})
                      </label>
                      <UiInput
                        v-model="formData.translations[lang.code as keyof typeof formData.translations].title"
                        :placeholder="lang.code === 'fr' ? 'Ex: Nouvelle fonctionnalité' : lang.code === 'en' ? 'Ex: New Feature' : 'Titre du message'"
                        :disabled="isLoading"
                        :class="{ 'border-red-500': errors[`${lang.code}_title`] }"
                      />
                      <p v-if="errors[`${lang.code}_title`]" class="text-xs text-red-600">
                        {{ errors[`${lang.code}_title`] }}
                      </p>
                    </div>

                    <div class="space-y-2">
                      <label class="text-sm font-medium text-foreground">
                        Résumé * ({{ lang.name }})
                      </label>
                      <UiInput
                        v-model="formData.translations[lang.code as keyof typeof formData.translations].summary"
                        :placeholder="lang.code === 'fr' ? 'Ex: Nouvelle fonction de rendez-vous' : lang.code === 'en' ? 'Ex: New appointment feature' : 'Résumé'"
                        :disabled="isLoading"
                        :class="{ 'border-red-500': errors[`${lang.code}_summary`] }"
                      />
                      <p v-if="errors[`${lang.code}_summary`]" class="text-xs text-red-600">
                        {{ errors[`${lang.code}_summary`] }}
                      </p>
                    </div>

                    <div class="space-y-2">
                      <label class="text-sm font-medium text-foreground">
                        Contenu * ({{ lang.name }})
                      </label>
                      <UiTextarea
                        v-model="formData.translations[lang.code as keyof typeof formData.translations].content"
                        :placeholder="lang.code === 'fr' ? 'Contenu détaillé du message...' : lang.code === 'en' ? 'Detailed message content...' : 'Contenu...'"
                        :disabled="isLoading"
                        class="min-h-[120px]"
                        :class="{ 'border-red-500': errors[`${lang.code}_content`] }"
                      />
                      <p v-if="errors[`${lang.code}_content`]" class="text-xs text-red-600">
                        {{ errors[`${lang.code}_content`] }}
                      </p>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </ClientOnly>
        </div>
      </div>

      <UiDialogFooter class="flex flex-col sm:flex-row gap-2 mt-6">
        <UiButton 
          type="button" 
          variant="outline" 
          class="w-full sm:w-auto"
          :disabled="isLoading"
          @click="$emit('update:open', false)"
        >
          Annuler
        </UiButton>
        <UiButton 
          type="button"
          class="w-full sm:w-auto"
          :disabled="isLoading"
          @click="handleSubmit"
        >
          <template v-if="isLoading">
            <div class="mr-2 h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin"/>
            Création en cours...
          </template>
          <template v-else>
            <MegaphoneIcon class="mr-2 h-4 w-4" />
            Créer le message
          </template>
        </UiButton>
      </UiDialogFooter>
    </UiDialogContent>
  </UiDialog>
</template>

<script setup lang="ts">
import type { CreateAnnouncementMessageRequest, MessageTranslationInput } from '~~/shared/types/announcement-message'
import { MegaphoneIcon, Globe } from 'lucide-vue-next'

interface Props {
  open: boolean
}

interface MessageFormData {
  message: {
    type: string
    priority: string
    isActive: boolean
    targetType: string
    scheduledAt?: string
  }
  translations: {
    fr: { title: string; content: string; summary: string }
    en: { title: string; content: string; summary: string }
    de: { title: string; content: string; summary: string }
    nl: { title: string; content: string; summary: string }
  }
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'success': []
}>()

const { createMessage } = useAnnouncementMessages()
const toast = useToast()

const isLoading = ref(false)
const activeTab = ref('fr')

const languages = SUPPORTED_LANGUAGES

// Form data structure
const initFormData = (): MessageFormData => ({
  message: {
    type: 'general',
    priority: 'info',
    isActive: true,
    targetType: 'all'
  },
  translations: {
    fr: { title: '', content: '', summary: '' },
    en: { title: '', content: '', summary: '' },
    de: { title: '', content: '', summary: '' },
    nl: { title: '', content: '', summary: '' }
  }
})

const formData = ref<MessageFormData>(initFormData())

// Validation errors
const errors = ref<Record<string, string>>({})

// Reset form when dialog closes
watch(() => props.open, (isOpen) => {
  if (!isOpen) {
    resetForm()
  }
})

const resetForm = () => {
  formData.value = initFormData()
  errors.value = {}
  activeTab.value = 'fr'
}

const validateForm = (): boolean => {
  errors.value = {}

  // Validate message fields
  if (!formData.value.message.type) {
    errors.value.type = 'Le type de message est requis'
  }

  if (!formData.value.message.priority) {
    errors.value.priority = 'La priorité est requise'
  }

  // Validate translations (at least title, summary and content for each language)
  languages.forEach(lang => {
    const translation = formData.value.translations[lang.code as keyof typeof formData.value.translations]
    
    if (!translation.title || translation.title.trim().length < 5) {
      errors.value[`${lang.code}_title`] = `Le titre en ${lang.name} est obligatoire (min. 5 caractères)`
    }
    
    if (!translation.summary || translation.summary.trim().length < 3) {
      errors.value[`${lang.code}_summary`] = `Le résumé en ${lang.name} est obligatoire (min. 3 caractères)`
    }
    
    if (!translation.content || translation.content.trim().length < 10) {
      errors.value[`${lang.code}_content`] = `Le contenu en ${lang.name} est obligatoire (min. 10 caractères)`
    }
  })

  return Object.keys(errors.value).length === 0
}

const transformToApiData = (data: MessageFormData): CreateAnnouncementMessageRequest => {
  const cleanedMessage = { ...data.message }
  
  // Clean up empty scheduledAt
  if (!cleanedMessage.scheduledAt?.trim()) {
    delete cleanedMessage.scheduledAt
  }
  
  return {
    message: cleanedMessage,
    translations: languages.map(lang => ({
      languageCode: lang.code,
      title: data.translations[lang.code as keyof typeof data.translations].title.trim(),
      content: data.translations[lang.code as keyof typeof data.translations].content.trim(),
      summary: data.translations[lang.code as keyof typeof data.translations].summary.trim()
    }))
  }
}

const handleSubmit = async () => {
  if (!validateForm()) {
    // Focus on first error tab if it's a translation error
    const firstErrorKey = Object.keys(errors.value)[0]
    if (firstErrorKey.includes('_')) {
      const langCode = firstErrorKey.split('_')[0]
      if (languages.some(l => l.code === langCode)) {
        activeTab.value = langCode
      }
    }
    return
  }

  isLoading.value = true
  
  try {
    const apiData = transformToApiData(formData.value)
    
    const response = await createMessage(apiData)
    
    if (response.success) {
      toast.handleApiSuccess('Message créé avec succès')
      emit('success')
      emit('update:open', false)
    } else {
      toast.handleApiError(response, 'Erreur lors de la création')
    }
  } catch (error) {
    console.error('Error creating announcement message:', error)
    toast.handleApiError({ success: false, error: 'Erreur inattendue' }, 'Erreur')
  }
  
  isLoading.value = false
}

// Check if a tab has errors
const hasTabErrors = (langCode: string) => {
  return Object.keys(errors.value).some(key => key.startsWith(langCode + '_'))
}

// Check if all required fields for a language are filled
const isTabComplete = (langCode: string) => {
  const translation = formData.value.translations[langCode as keyof typeof formData.value.translations]
  return translation?.title?.trim().length >= 5 && 
         translation?.summary?.trim().length >= 3 &&
         translation?.content?.trim().length >= 10
}

// Handle tab change
const changeTab = (langCode: string) => {
  activeTab.value = langCode
}
</script>