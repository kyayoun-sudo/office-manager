<script setup lang="ts">
import { z } from 'zod'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm, useField } from 'vee-validate'
import { api } from '~/utils/api'
import type { Document, CreateDocumentData, UpdateDocumentData } from '~~/shared/types/document'
import { createBasicFields, COMMON_VALIDATION_RULES, type GeneralField } from '~/composables/useMultilingualForm'
import MultilingualFormFields from '~/components/forms/MultilingualFormFields.vue'

interface Props {
  document?: Document | null
  isOpen: boolean
  isLoading?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'submit': [data: CreateDocumentData | UpdateDocumentData]
  'cancel': []
}>()

const isEditing = computed(() => !!props.document)

// Validation schema pour les champs non-multilingues
const validationSchema = toTypedSchema(z.object({
  documentType: z.string().min(1, 'Le code est requis'),
  version: z.string().min(1, 'La version est requise')
}))

const { handleSubmit, resetForm, errors } = useForm({
  validationSchema,
  initialValues: {
    documentType: '',
    version: '1.0.0'
  }
})

const { value: documentType } = useField<string>('documentType')
const { value: version } = useField<string>('version')

// Données des traductions multilingues
const translationsData = ref({
  fr: { title: '', content: '' },
  en: { title: '', content: '' },
  nl: { title: '', content: '' }
})

// Configuration des champs généraux et multilingues
const generalFields = ref<GeneralField[]>([
  {
    key: 'documentType',
    label: 'Code du document',
    type: 'text',
    required: true,
    placeholder: 'Ex: terms, privacy, faq...',
  },
  {
    key: 'version',
    label: 'Version',
    type: 'text',
    required: true,
    placeholder: '1.0.0',
    description: 'Format: x.y.z (ex: 1.0.0)'
  },
  {
    key: 'isActive',
    label: 'Actif',
    type: 'select',
    required: false,
    placeholder: 'Sélectionner un statut',
    options: [
      { value: 'true', label: 'Oui' },
      { value: 'false', label: 'Non' }
    ]
  }
])

const generalValues = ref({
  documentType: '',
  version: '1.0.0',
  isActive: 'false'
})

const generalErrors = computed(() => ({
  documentType: errors.value.documentType,
  version: errors.value.version,
}))

const multilingualFields = [
  {
    key: 'title',
    label: 'Titre',
    type: 'text',
    required: true,
    maxLength: 200,
    minLength: 3,
    showCharCount: true
  },
  {
    key: 'content',
    label: 'Contenu',
    type: 'markdown',
    required: true,
    maxLength: 5000,
    minLength: 10,
    rows: 6,
    showCharCount: true
  }
]
const multilingualValidationRules = {
  title: COMMON_VALIDATION_RULES.title,
  content: COMMON_VALIDATION_RULES.content
}

// État pour la validation des traductions
const isTranslationsValid = ref(false)
const translationsErrors = ref<Record<string, string[]>>({})

// Fonction pour extraire les traductions depuis le document
const extractTranslations = (document: Document | null) => {
  const defaultTranslations = {
    fr: { title: '', content: '' },
    en: { title: '', content: '' },
    nl: { title: '', content: '' }
  }

  if (!document?.translations) return defaultTranslations

  const translations = { ...defaultTranslations }
  document.translations.forEach(t => {
    const langCode = t.language.code as keyof typeof translations
    if (langCode in translations) {
      translations[langCode] = {
        title: t.title || '',
        content: t.content || ''
      }
    }
  })

  return translations
}

// Handlers pour les champs généraux
const onGeneralValuesUpdate = (newValues: Record<string, any>) => {
  generalValues.value = { ...generalValues.value, ...newValues }
  if (newValues.documentType !== undefined) documentType.value = newValues.documentType
  if (newValues.version !== undefined) version.value = newValues.version
  if (newValues.isActive !== undefined) {
    if (newValues.isActive === 'true' || newValues.isActive === true) {
      generalValues.value.isActive = 'true'
    } else if (newValues.isActive === 'false' || newValues.isActive === false) {
      generalValues.value.isActive = 'false'
    }
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
    if (translation.title && translation.title.trim() && translation.content && translation.content.trim()) {
      translations.push({
        languageCode: langCode,
        title: translation.title,
        content: translation.content
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
        id: props.document!.id,
        documentType: documentType.value,
        version: version.value,
        isActive: generalValues.value.isActive === 'true',
        translations
      } as UpdateDocumentData
    : {
        documentType: documentType.value,
        version: version.value,
        isActive: generalValues.value.isActive === 'true',
        translations
      } as CreateDocumentData

  emit('submit', adaptedData)
})

const onCancel = () => {
  documentType.value = ''
  version.value = '1.0.0'
  generalValues.value = {
    documentType: '',
    version: '1.0.0',
    isActive: 'false'
  }
  translationsData.value = {
    fr: { title: '', content: '' },
    en: { title: '', content: '' },
    nl: { title: '', content: '' }
  }
  resetForm()
  emit('cancel')
}

// Helper function to update field values when props change
const updateFieldValues = () => {
  if (props.document) {
    documentType.value = props.document.documentType || ''
    version.value = props.document.version || '1.0.0'

    generalValues.value = {
      documentType: props.document.documentType || '',
      version: props.document.version,
      isActive: props.document.isActive ? 'true' : 'false'
    }

    // Charger les traductions
    translationsData.value = extractTranslations(props.document)
  } else {
    documentType.value = ''
    version.value = '1.0.0'
    generalValues.value = {
      documentType: '',
      version: '1.0.0',
      isActive: 'false'
    }
    translationsData.value = {
      fr: { title: '', content: '' },
      en: { title: '', content: '' },
      nl: { title: '', content: '' }
    }
  }
}

// Only update values when dialog is opened and there's data
watch(() => props.isOpen, (isOpen) => {
  if (isOpen) {
    nextTick(() => {
      updateFieldValues()
    })
  }
}, { immediate: false })

// Watch for document changes only when dialog is open
watch(() => props.document, () => {
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
          {{ isEditing ? 'Modifier le document' : 'Nouveau document' }}
        </UiDialogTitle>
        <UiDialogDescription>
          {{ isEditing ? 'Modifiez les informations du document.' : 'Créez un nouveau document avec ses traductions.' }}
        </UiDialogDescription>
      </UiDialogHeader>

      <form
        v-if="isOpen"
        :key="`form-${props.document?.id || 'new'}-${isOpen}`"
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
              title="Traduction des documents"
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
