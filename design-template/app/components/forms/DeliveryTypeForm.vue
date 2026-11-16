<script setup lang="ts">
import { z } from 'zod'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm, useField } from 'vee-validate'
import type { DeliveryType, CreateDeliveryTypeDto, UpdateDeliveryTypeDto } from '~~/shared/types/delivery-type'
import { COMMON_VALIDATION_RULES, type GeneralField, type FormField } from '~/composables/useMultilingualForm'
import MultilingualFormFields from './MultilingualFormFields.vue'

interface Props {
  deliveryType?: DeliveryType | null
  isOpen: boolean
  isLoading?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'submit': [data: CreateDeliveryTypeDto | (UpdateDeliveryTypeDto & { id: number })]
  'cancel': []
}>()

const isEditing = computed(() => !!props.deliveryType)

// Validation schema pour les champs non-multilingues
const validationSchema = toTypedSchema(z.object({
  code: z.string()
    .min(1, 'Le code est requis')
    .max(100, 'Le code ne peut pas dépasser 100 caractères')
    .regex(/^[a-z_]+$/, 'Le code doit être en minuscules avec underscores (ex: vaginal_delivery)'),
  isActive: z.string().optional()
}))

const { handleSubmit, resetForm, errors, setValues } = useForm({
  validationSchema,
  initialValues: {
    code: '',
    isActive: 'true'
  }
})

const { value: code } = useField<string>('code')
const { value: isActive } = useField<string>('isActive')

// Données des traductions multilingues
const translationsData = ref({
  fr: { name: '', description: '' },
  en: { name: '', description: '' },
  nl: { name: '', description: '' }
})

// Configuration des champs généraux
const generalFields = ref<GeneralField[]>([
  {
    key: 'code',
    label: 'Code',
    type: 'text',
    required: true,
    placeholder: 'ex: vaginal_delivery',
    description: 'Code unique en minuscules avec underscores'
  },
  {
    key: 'isActive',
    label: 'Statut',
    type: 'select',
    required: false,
    placeholder: 'Sélectionner',
    options: [
      { value: 'true', label: 'Actif' },
      { value: 'false', label: 'Inactif' }
    ]
  }
])

const generalValues = ref({ code: '', isActive: 'true' })
const generalErrors = computed(() => ({
  code: errors.value.code,
  isActive: errors.value.isActive
}))

// Configuration des champs multilingues
const multilingualFields: FormField[] = [
  {
    key: 'name',
    label: 'Nom',
    type: 'text',
    required: true,
    maxLength: 100
  },
  {
    key: 'description',
    label: 'Description',
    type: 'textarea',
    required: false,
    maxLength: 500,
    rows: 3
  }
]

const multilingualValidationRules = {
  name: COMMON_VALIDATION_RULES.name,
  description: COMMON_VALIDATION_RULES.description
}

// État pour la validation des traductions
const isTranslationsValid = ref(false)
const translationsErrors = ref<Record<string, string[]>>({})

// Fonction pour extraire les traductions depuis le type d'accouchement
const extractTranslations = (deliveryType: DeliveryType | null) => {
  const defaultTranslations = {
    fr: { name: '', description: '' },
    en: { name: '', description: '' },
    nl: { name: '', description: '' }
  }

  if (!deliveryType?.translations) return defaultTranslations

  const translations = { ...defaultTranslations }
  deliveryType.translations.forEach(t => {
    const langCode = (t.language?.code || t.languageCode) as keyof typeof translations
    if (langCode && langCode in translations) {
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
  if (newValues.isActive !== undefined) isActive.value = newValues.isActive
}

// Validation handler pour les traductions
const onTranslationsValidationChange = (isValid: boolean, validationErrors: Record<string, string[]>) => {
  isTranslationsValid.value = isValid
  translationsErrors.value = validationErrors
}

// Computed pour vérifier si tout le formulaire est valide
const isFormValid = computed(() => {
  return !Object.keys(errors.value || {}).length && isTranslationsValid.value
})

// Fonction pour convertir les données multilingues vers le format API
const convertToTranslationsArray = () => {
  const translations = []

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

  const translations = convertToTranslationsArray()

  const data = isEditing.value
    ? {
        id: props.deliveryType!.id,
        code: code.value,
        isActive: isActive.value === 'true',
        translations
      } as UpdateDeliveryTypeDto & { id: number }
    : {
        code: code.value,
        isActive: isActive.value === 'true',
        translations
      } as CreateDeliveryTypeDto

  emit('submit', data)
})

const updateFieldValues = () => {
  if (props.deliveryType) {
    code.value = props.deliveryType.code || ''
    isActive.value = props.deliveryType.isActive ? 'true' : 'false'

    generalValues.value = {
      code: props.deliveryType.code || '',
      isActive: props.deliveryType.isActive ? 'true' : 'false'
    }

    translationsData.value = extractTranslations(props.deliveryType)
  } else {
    code.value = ''
    isActive.value = 'true'
    generalValues.value = { code: '', isActive: 'true' }
    translationsData.value = {
      fr: { name: '', description: '' },
      en: { name: '', description: '' },
      nl: { name: '', description: '' }
    }
  }
}

const onCancel = () => {
  code.value = ''
  isActive.value = 'true'
  generalValues.value = { code: '', isActive: 'true' }
  translationsData.value = {
    fr: { name: '', description: '' },
    en: { name: '', description: '' },
    nl: { name: '', description: '' }
  }
  resetForm()
  emit('cancel')
}

// Mettre à jour les valeurs quand le dialog s'ouvre
watch(() => props.isOpen, (isOpen) => {
  if (isOpen) {
    nextTick(() => {
      updateFieldValues()
    })
  }
}, { immediate: false })

// Watch pour les changements quand le dialog est ouvert
watch(() => props.deliveryType, () => {
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
          {{ isEditing ? 'Modifier le type d\'accouchement' : 'Nouveau type d\'accouchement' }}
        </UiDialogTitle>
        <UiDialogDescription>
          {{ isEditing ? 'Modifiez les informations du type d\'accouchement.' : 'Créez un nouveau type d\'accouchement avec ses traductions.' }}
        </UiDialogDescription>
      </UiDialogHeader>

      <form
        v-if="isOpen"
        :key="`form-${props.deliveryType?.id || 'new'}-${isOpen}`"
        class="space-y-6"
        @submit="onSubmit"
      >
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
              title="Traductions"
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
            @click="onCancel"
          >
            Annuler
          </UiButton>
          <UiButton
            type="submit"
            :disabled="isLoading || !isFormValid"
          >
            <AppSpinner v-if="isLoading" class="mr-2 h-4 w-4" />
            {{ isEditing ? 'Modifier' : 'Enregistrer' }}
          </UiButton>
        </UiDialogFooter>
      </form>
    </UiDialogContent>
  </UiDialog>
</template>
