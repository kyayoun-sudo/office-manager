<script setup lang="ts">
import type { SpecialtyFormData, CreateSpecialtyData } from '~~/shared/types/specialty'
import { Languages, Globe, Plus } from 'lucide-vue-next'

interface Props {
  open: boolean
}

interface Emits {
  (e: 'update:open', value: boolean): void
  (e: 'specialtyCreated'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const { createSpecialty } = useSpecialties()
const { getCategoryOptions, fetchCategories, categories, loading: categoriesLoading } = useSpecialtyCategories()
const toast = useToast()

const isLoading = ref(false)
const activeTab = ref('fr')

const languages = SUPPORTED_LANGUAGES

// Form data structure
const initFormData = (): SpecialtyFormData => ({
  code: '',
  category: '',
  translations: {
    fr: { name: '', description: '' },
    en: { name: '', description: '' },
    de: { name: '', description: '' },
    nl: { name: '', description: '' }
  }
})

const formData = ref<SpecialtyFormData>(initFormData())

// Validation errors
const errors = ref<Record<string, string>>({})

// Reset form when dialog closes and fetch categories when opened
watch(() => props.open, async (isOpen) => {
  if (!isOpen) {
    resetForm()
  } else {
    // Fetch categories when dialog opens
    await fetchCategories()
  }
})

const resetForm = () => {
  formData.value = initFormData()
  errors.value = {}
  activeTab.value = 'fr'
}

const validateForm = (): boolean => {
  errors.value = {}

  // Validate code
  if (!formData.value.code || formData.value.code.length < 2) {
    errors.value.code = 'Le code doit contenir au moins 2 caractères'
  }

  // Validate category
  if (!formData.value.category) {
    errors.value.category = 'Veuillez sélectionner une catégorie'
  }

  // Validate translations (at least name for each language)
  languages.forEach(lang => {
    const translation = formData.value.translations[lang.code as keyof typeof formData.value.translations]
    if (!translation.name || translation.name.trim().length < 2) {
      errors.value[`${lang.code}_name`] = `Le nom en ${lang.name} est obligatoire (min. 2 caractères)`
    }
  })

  return Object.keys(errors.value).length === 0
}

const transformToApiData = (data: SpecialtyFormData): CreateSpecialtyData => {
  return {
    specialty: {
      code: data.code.toUpperCase(),
      category: data.category
    },
    translations: languages.map(lang => ({
      languageCode: lang.code,
      name: data.translations[lang.code as keyof typeof data.translations].name.trim(),
      description: data.translations[lang.code as keyof typeof data.translations].description.trim()
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
    
    const response = await createSpecialty(apiData)
    
    if (response.success) {
      toast.handleApiSuccess('Spécialité créée avec succès')
      emit('specialtyCreated')
      emit('update:open', false)
    } else {
      toast.handleApiError(response, 'Erreur lors de la création')
    }
  } catch (error) {
    console.error('Error creating specialty:', error)
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
  return translation?.name?.trim().length >= 2
}

// Reactive computed for category options
const categoryOptions = computed(() => {
  return getCategoryOptions('fr')
})

// Handle tab change
const changeTab = (langCode: string) => {
  activeTab.value = langCode
}
</script>

<template>
  <UiDialog :open="props.open" @update:open="emit('update:open', $event)">
    <UiDialogContent class="max-w-4xl max-h-[90vh] overflow-y-auto">
      <UiDialogHeader>
        <UiDialogTitle class="flex items-center space-x-2">
          <Plus class="h-5 w-5 text-primary" />
          <span>Créer une nouvelle spécialité</span>
        </UiDialogTitle>
        <UiDialogDescription>
          Ajoutez une nouvelle spécialité avec des traductions dans les 4 langues supportées.
        </UiDialogDescription>
      </UiDialogHeader>

      <div class="space-y-6">
        <!-- Basic Information -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="space-y-2">
            <label class="text-sm font-medium text-foreground">
              Code de la spécialité *
            </label>
            <UiInput
              v-model="formData.code"
              placeholder="Ex: CARDIO"
              :disabled="isLoading"
              :class="{ 'border-red-500': errors.code }"
              @input="formData.code = $event.target.value.toUpperCase()"
            />
            <p v-if="errors.code" class="text-xs text-red-600">{{ errors.code }}</p>
          </div>

          <div class="space-y-2">
            <label class="text-sm font-medium text-foreground">
              Catégorie * ({{ categoryOptions.length }} disponibles)
            </label>
            <UiSelect v-model="formData.category" :disabled="isLoading || categoriesLoading">
              <UiSelectTrigger :class="{ 'border-red-500': errors.category }">
                <UiSelectValue placeholder="Choisir une catégorie" />
              </UiSelectTrigger>
              <UiSelectContent>
                <UiSelectItem 
                  v-for="option in categoryOptions" 
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </UiSelectItem>
              </UiSelectContent>
            </UiSelect>
            <p v-if="errors.category" class="text-xs text-red-600">{{ errors.category }}</p>
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
                        Nom de la spécialité * ({{ lang.name }})
                      </label>
                      <UiInput
                        v-model="formData.translations[lang.code as keyof typeof formData.translations].name"
                        :placeholder="lang.code === 'fr' ? 'Ex: Cardiologie' : lang.code === 'en' ? 'Ex: Cardiology' : 'Nom de la spécialité'"
                        :disabled="isLoading"
                        :class="{ 'border-red-500': errors[`${lang.code}_name`] }"
                      />
                      <p v-if="errors[`${lang.code}_name`]" class="text-xs text-red-600">
                        {{ errors[`${lang.code}_name`] }}
                      </p>
                    </div>

                    <div class="space-y-2">
                      <label class="text-sm font-medium text-foreground">
                        Description ({{ lang.name }})
                      </label>
                      <UiTextarea
                        v-model="formData.translations[lang.code as keyof typeof formData.translations].description"
                        :placeholder="lang.code === 'fr' ? 'Description de la spécialité...' : lang.code === 'en' ? 'Specialty description...' : 'Description...'"
                        :disabled="isLoading"
                        class="min-h-[100px]"
                      />
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
          @click="emit('update:open', false)"
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
            <Languages class="mr-2 h-4 w-4" />
            Créer la spécialité
          </template>
        </UiButton>
      </UiDialogFooter>
    </UiDialogContent>
  </UiDialog>
</template>