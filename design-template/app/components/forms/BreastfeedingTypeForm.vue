<script setup lang="ts">
import { z } from 'zod'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm, useField } from 'vee-validate'
import { api } from '~/utils/api'
import { nextTick } from 'vue'
import type { BreastfeedingType, CreateBreastfeedingTypeDto, UpdateBreastfeedingTypeDto } from '#shared/types/breastfeeding-type'
import { createBreastfeedingTypeFields, COMMON_VALIDATION_RULES, type GeneralField } from '~/composables/useMultilingualForm'
import MultilingualFormFields from './MultilingualFormFields.vue'

interface Props {
  breastfeedingType?: BreastfeedingType | null
  isOpen: boolean
  isLoading?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'submit': [data: CreateBreastfeedingTypeDto | (UpdateBreastfeedingTypeDto & { id: number })]
  'cancel': []
}>()

const isEditing = computed(() => !!props.breastfeedingType)

// Validation schema pour les champs non-multilingues
const validationSchema = toTypedSchema(z.object({
  code: z.string().min(1, 'Le code est requis'),
  isActive: z.string().optional()
}))

const { handleSubmit, resetForm, errors } = useForm({
  validationSchema,
  initialValues: {
    isActive: 'true',
    code: ''
  }
})

const { value: isActive } = useField<string>('isActive')
const { value: code } = useField<string>('code')

// Données des traductions multilingues
const translationsData = ref({
  fr: { name: '', description: '' },
  en: { name: '', description: '' },
  nl: { name: '', description: '' }
})

// Configuration des champs généraux et multilingues
const generalFields = ref<GeneralField[]>([
  {
    key: 'code',
    label: 'Code',
    type: 'text',
    placeholder: 'Code unique (ex: exclusive_breastfeeding)',
    required: true
  },
  {
    key: 'isActive',
    label: 'Statut',
    type: 'select',
    placeholder: 'Sélectionnez le statut',
    options: [
      { value: 'true', label: 'Actif' },
      { value: 'false', label: 'Inactif' }
    ],
    required: true
  }
])

const generalValues = ref({ code: '', isActive: 'true' })
const generalErrors = computed(() => ({
  code: errors.value.code,
  isActive: errors.value.isActive
}))

const multilingualFields = createBreastfeedingTypeFields()
const multilingualValidationRules = {
  name: COMMON_VALIDATION_RULES.name,
  description: COMMON_VALIDATION_RULES.description
}

// État pour la validation des traductions
const isTranslationsValid = ref(false)
const translationsErrors = ref<Record<string, string[]>>({})

// Fonction pour extraire les traductions depuis le type d'allaitement
const extractTranslations = (breastfeedingType: BreastfeedingType | null) => {
  const defaultTranslations = {
    fr: { name: '', description: '' },
    en: { name: '', description: '' },
    nl: { name: '', description: '' }
  }

  if (!breastfeedingType?.translations) return defaultTranslations

  const translations = { ...defaultTranslations }
  breastfeedingType.translations.forEach(t => {
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

  // Mettre à jour les champs du formulaire vee-validate
  if (newValues.code !== undefined) {
    generalValues.value.code = newValues.code
    code.value = newValues.code
  }
  if (newValues.isActive !== undefined) {
    generalValues.value.isActive = newValues.isActive
    isActive.value = newValues.isActive
  }
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
        id: props.breastfeedingType!.id,
        code: code.value || undefined,
        isActive: isActive.value === 'true',
        translations
      } as UpdateBreastfeedingTypeDto & { id: number }
    : {
        code: code.value,
        isActive: isActive.value === 'true',
        translations
      } as CreateBreastfeedingTypeDto

  emit('submit', adaptedData)
})

// Helper function to update field values when props change
const updateFieldValues = () => {
  if (props.breastfeedingType) {
    console.log('🔍 DEBUG - BreastfeedingType object:', props.breastfeedingType)

    generalValues.value = {
      code: props.breastfeedingType.code || '',
      isActive: props.breastfeedingType.isActive ? 'true' : 'false'
    }

    // Mettre à jour les champs du formulaire
    code.value = props.breastfeedingType.code || ''
    isActive.value = props.breastfeedingType.isActive ? 'true' : 'false'

    // Charger les traductions
    translationsData.value = extractTranslations(props.breastfeedingType)
  } else {
    // Reset to empty values for new breastfeeding type
    generalValues.value = { code: '', isActive: 'true' }
    code.value = ''
    isActive.value = 'true'
    translationsData.value = {
      fr: { name: '', description: '' },
      en: { name: '', description: '' },
      nl: { name: '', description: '' }
    }
  }

  // Mettre à jour les valeurs du formulaire vee-validate
  nextTick(() => {
    if (props.breastfeedingType) {
      // Mise à jour des valeurs du formulaire vee-validate
      code.value = props.breastfeedingType.code || ''
      isActive.value = props.breastfeedingType.isActive ? 'true' : 'false'
    } else {
      code.value = ''
      isActive.value = 'true'
    }
  })
}

const onCancel = () => {
  // Reset form values
  generalValues.value = { code: '', isActive: 'true' }
  translationsData.value = {
    fr: { name: '', description: '' },
    en: { name: '', description: '' },
    nl: { name: '', description: '' }
  }

  // Réinitialiser les champs du formulaire vee-validate
  nextTick(() => {
    code.value = ''
    isActive.value = 'true'
    resetForm()
  })

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

// Watch for breastfeedingType changes only when dialog is open
watch(() => props.breastfeedingType, () => {
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
          {{ isEditing ? 'Modifier le type d\'allaitement' : 'Nouveau type d\'allaitement' }}
        </UiDialogTitle>
        <UiDialogDescription>
          {{ isEditing ? 'Modifiez les informations du type d\'allaitement.' : 'Créez un nouveau type d\'allaitement avec ses traductions.' }}
        </UiDialogDescription>
      </UiDialogHeader>

      <form
        v-if="isOpen"
        :key="`form-${props.breastfeedingType?.id || 'new'}-${isOpen}`"
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
              title="Traduction des types d'allaitement"
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
