<script setup lang="ts">
import { z } from 'zod'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm, useField } from 'vee-validate'
import { api } from '~/utils/api'
import type { Specialty, CreateSpecialtyDto, UpdateSpecialtyDto } from '#shared/types/specialty'
import { createSpecialtyFields, createSpecialtyGeneralFields, COMMON_VALIDATION_RULES, type GeneralField } from '~/composables/useMultilingualForm'
import MultilingualFormFields from './MultilingualFormFields.vue'

interface Props {
  specialty?: Specialty | null
  isOpen: boolean
  isLoading?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'submit': [data: CreateSpecialtyDto | (UpdateSpecialtyDto & { id: number })]
  'cancel': []
}>()

const isEditing = computed(() => !!props.specialty)

const validationSchema = toTypedSchema(z.object({
  code: z.string().min(1, 'Le code est requis'),
  category: z.string().min(1, 'La categorie est requise'),
  isActive: z.string().optional(),
  isDefault: z.string().optional(),
  clinicianSetsAppointmentDate: z.string().optional()
}))

const { handleSubmit, resetForm, errors } = useForm({
  validationSchema,
  initialValues: {
    code: '',
    category: '',
    isActive: 'true',
    isDefault: 'false',
    clinicianSetsAppointmentDate: 'false'
  }
})

const { value: code } = useField<string>('code')
const { value: category } = useField<string>('category')
const { value: isActive } = useField<string>('isActive')
const { value: isDefault } = useField<string>('isDefault')
const { value: clinicianSetsAppointmentDate } = useField<string>('clinicianSetsAppointmentDate')

// Données des traductions multilingues
const translationsData = ref({
  fr: { name: '', description: '' },
  en: { name: '', description: '' },
  nl: { name: '', description: '' }
})

// Configuration des champs généraux et multilingues
const generalFields = ref<GeneralField[]>(createSpecialtyGeneralFields())
const generalValues = ref({
  code: '',
  category: '',
  isActive: 'true',
  isDefault: 'false',
  clinicianSetsAppointmentDate: 'false',
})
const generalErrors = computed(() => ({
  code: errors.value.code,
  category: errors.value.category,
  isActive: errors.value.isActive,
  isDefault: errors.value.isDefault,
  clinicianSetsAppointmentDate: errors.value.clinicianSetsAppointmentDate
}))

const multilingualFields = createSpecialtyFields()
const multilingualValidationRules = {
  name: COMMON_VALIDATION_RULES.name,
  description: COMMON_VALIDATION_RULES.description
}

// État pour la validation des traductions
const isTranslationsValid = ref(false)
const translationsErrors = ref<Record<string, string[]>>({})

// Récupération dynamique des catégories
const categories = ref([])
const categoriesLoading = ref(false)

const fetchCategories = async () => {
  try {
    categoriesLoading.value = true
    const response = await api.get('/categories', { 
      params: { lang: 'fr' } 
    })
    
    if (response.success && response.data) {
      categories.value = response.data
    } else {
      categories.value = []
    }
  } catch (error) {
    console.error('Erreur lors du chargement des catégories:', error)
    categories.value = []
  } finally {
    categoriesLoading.value = false
  }
}

const availableCategories = computed(() => {
  if (!categories.value || !Array.isArray(categories.value)) return []
  
  return categories.value.map(category => {
    // Trouver la traduction française
    const frTranslation = category.translations?.find(t => t.language.code === 'fr')
    
    return {
      value: category.id.toString(),
      label: frTranslation?.name || category.code
    }
  })
})

// Charger les catégories au montage du composant
onMounted(() => {
  fetchCategories()
})

// Fonction pour extraire les traductions depuis la spécialité
const extractTranslations = (specialty: Specialty | null) => {
  const defaultTranslations = {
    fr: { name: '', description: '' },
    en: { name: '', description: '' },
    nl: { name: '', description: '' }
  }

  if (!specialty?.translations) return defaultTranslations

  const translations = { ...defaultTranslations }
  specialty.translations.forEach(t => {
    const langCode = t.language.code as keyof typeof translations
    if (langCode in translations) {
      translations[langCode] = {
        name: t.name || '',
        description: t.description || ''
      }
    }
  })

  return translations
}

// Handlers pour les champs généraux
const onGeneralValuesUpdate = (newValues: Record<string, any>) => {
  generalValues.value = { ...generalValues.value, ...newValues }
  if (newValues.code !== undefined) code.value = newValues.code
  if (newValues.category !== undefined) category.value = newValues.category
  if (newValues.isActive !== undefined) isActive.value = newValues.isActive
  if (newValues.isDefault !== undefined) isDefault.value = newValues.isDefault
  if (newValues.clinicianSetsAppointmentDate !== undefined) clinicianSetsAppointmentDate.value = newValues.clinicianSetsAppointmentDate
}

// Validation handler pour les traductions
const onTranslationsValidationChange = (isValid: boolean, errors: Record<string, string[]>) => {
  isTranslationsValid.value = isValid
  translationsErrors.value = errors
}

// Computed pour vérifier si tout le formulaire est valide
const isFormValid = computed(() => {
  return !Object.keys(errors.value || {}).length && isTranslationsValid.value
})

// Fonction pour convertir les données multilingues vers le format API
const convertToTranslationsArray = () => {
  const translations = []
  
  // Traductions obligatoires
  for (const langCode of ['fr', 'en', 'nl']) {
    const translation = translationsData.value[langCode as keyof typeof translationsData.value]
    if (translation.name && translation.name.trim()) {
      translations.push({
        languageCode: langCode,
        name: translation.name,
        description: translation.description || undefined
      })
    }
  }
  
  return translations
}

const onSubmit = handleSubmit(() => {
  if (!isFormValid.value) {
    console.error('Formulaire invalide')
    return
  }

  // Construire le tableau des traductions
  const translations = convertToTranslationsArray()

  const adaptedData = isEditing.value
    ? {
        id: props.specialty!.id,
        code: code.value || undefined,
        categoryId: parseInt(category.value) || undefined,
        isActive: isActive.value === 'true',
        isDefault: isDefault.value === 'true',
        clinicianSetsAppointmentDate: clinicianSetsAppointmentDate.value === 'true',
        translations
      } as UpdateSpecialtyDto & { id: number }
    : {
        code: code.value,
        categoryId: parseInt(category.value) || undefined,
        isActive: isActive.value === 'true',
        isDefault: isDefault.value === 'true',
        clinicianSetsAppointmentDate: clinicianSetsAppointmentDate.value === 'true',
        translations
      } as CreateSpecialtyDto
  
  emit('submit', adaptedData)
})

// Mettre à jour les options de catégories dans les champs généraux
watch(() => availableCategories.value, (newCategories) => {
  if (generalFields.value) {
    const categoryField = generalFields.value.find(f => f.key === 'category')
    if (categoryField) {
      categoryField.options = newCategories
      categoryField.loading = categoriesLoading.value
    }
  }
}, { immediate: true })

// Helper function to update field values when props change
const updateFieldValues = () => {
  if (props.specialty) {
    let categoryVal = ''
    if (props.specialty.category) {
      if (typeof props.specialty.category === 'object' && props.specialty.category !== null) {
        categoryVal = props.specialty.category.id?.toString() || ''
      } else if (typeof props.specialty.category === 'string') {
        categoryVal = props.specialty.category
      }
    }

    code.value = props.specialty.code || ''
    category.value = categoryVal
    isActive.value = props.specialty.isActive ? 'true' : 'false'
    isDefault.value = props.specialty.isDefault ? 'true' : 'false'
    clinicianSetsAppointmentDate.value = props.specialty.clinicianSetsAppointmentDate ? 'true' : 'false'

    generalValues.value = {
      code: props.specialty.code || '',
      category: categoryVal,
      isActive: props.specialty.isActive ? 'true' : 'false',
      isDefault: props.specialty.isDefault ? 'true' : 'false',
      clinicianSetsAppointmentDate: props.specialty.clinicianSetsAppointmentDate ? 'true' : 'false',
    }

    translationsData.value = extractTranslations(props.specialty)
  } else {
    code.value = ''
    category.value = ''
    isActive.value = 'true'
    isDefault.value = 'false'
    clinicianSetsAppointmentDate.value = 'false'
    generalValues.value = {
      code: '',
      category: '',
      isActive: 'true',
      isDefault: 'false',
      clinicianSetsAppointmentDate: 'false',
    }
    translationsData.value = {
      fr: { name: '', description: '' },
      en: { name: '', description: '' },
      nl: { name: '', description: '' },
    }
  }
}

const onCancel = () => {
  code.value = ''
  category.value = ''
  isActive.value = 'true'
  isDefault.value = 'false'
  clinicianSetsAppointmentDate.value = 'false'
  generalValues.value = {
    code: '',
    category: '',
    isActive: 'true',
    isDefault: 'false',
    clinicianSetsAppointmentDate: 'false',
  }
  translationsData.value = {
    fr: { name: '', description: '' },
    en: { name: '', description: '' },
    nl: { name: '', description: '' },
  }
  resetForm()
  emit('cancel')
}

// Only update values when dialog is opened and there's data
watch(() => props.isOpen, (isOpen) => {
  if (isOpen) {
    nextTick(() => {
      updateFieldValues()
    })
  }
}, { immediate: false })

// Watch for specialty changes only when dialog is open
watch(() => props.specialty, () => {
  if (props.isOpen) {
    nextTick(() => {
      updateFieldValues()
    })
  }
}, { immediate: false })
</script>

<template>
  <UiDialog :open="isOpen" @update:open="$event || onCancel()">
    <UiDialogContent class="max-w-4xl max-h-[90vh] overflow-y-auto">
      <UiDialogHeader>
        <UiDialogTitle>
          {{ isEditing ? 'Modifier la spécialité' : 'Nouvelle spécialité' }}
        </UiDialogTitle>
        <UiDialogDescription>
          {{ isEditing ? 'Modifiez les informations de la spécialité.' : 'Créez une nouvelle spécialité avec ses traductions.' }}
        </UiDialogDescription>
      </UiDialogHeader>

      <form
v-if="isOpen"
:key="`form-${props.specialty?.id || 'new'}-${isOpen}`"
class="space-y-6"
@submit="onSubmit">
        <div class="space-y-6">
          <!-- Formulaire avec champs généraux et multilingues -->
          <div class="space-y-4">
            <MultilingualFormFields
              v-model="translationsData"
              :general-fields="generalFields"
              :general-values="generalValues"
              :general-errors="generalErrors"
              :fields="multilingualFields"
              :validation-rules="multilingualValidationRules"
              title="Traduction des spécialités"
              :disabled="isLoading"
              @update:general-values="onGeneralValuesUpdate"
              @validation-change="onTranslationsValidationChange"
            />
          </div>
        </div>

        <UiDialogFooter class="pt-6 border-t">
          <UiButton
type="button"
variant="outline"
:disabled="isLoading"
@click="onCancel">
            Annuler
          </UiButton>
          <UiButton type="submit" :disabled="isLoading || !isFormValid">
            <AppSpinner v-if="isLoading" class="mr-2 h-4 w-4" />
            {{ isEditing ? 'Modifier' : 'Enregistrer' }}
          </UiButton>
        </UiDialogFooter>
      </form>
    </UiDialogContent>
  </UiDialog>
</template>
