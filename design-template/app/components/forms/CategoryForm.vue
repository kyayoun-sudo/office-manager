<script setup lang="ts">
import { z } from 'zod'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm, useField } from 'vee-validate'
import { nextTick } from 'vue'
import type { Category, CreateCategoryDto, UpdateCategoryDto } from '~~/shared/types/category'
import { createCategoryFields, COMMON_VALIDATION_RULES, type GeneralField } from '~/composables/useMultilingualForm'
import MultilingualFormFields from './MultilingualFormFields.vue'

interface Props {
  category?: Category | null
  isOpen: boolean
  isLoading?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'submit': [data: CreateCategoryDto | (UpdateCategoryDto & { id: number })]
  'cancel': []
}>()

const isEditing = computed(() => !!props.category)

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

const translationsData = ref({
  fr: { name: '', description: '' },
  en: { name: '', description: '' },
  nl: { name: '', description: '' }
})

const generalFields = ref<GeneralField[]>([
  {
    key: 'code',
    label: 'Code',
    type: 'text',
    placeholder: 'Code unique (ex: prenatal_consultation)',
    required: true
  },
  {
    key: 'isActive',
    label: 'Statut',
    type: 'select',
    placeholder: 'Selectionnez le statut',
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

const multilingualFields = createCategoryFields()
const multilingualValidationRules = {
  name: COMMON_VALIDATION_RULES.name,
  description: COMMON_VALIDATION_RULES.description
}

const isTranslationsValid = ref(false)
const translationsErrors = ref<Record<string, string[]>>({})

const extractTranslations = (category: Category | null) => {
  const defaultTranslations = {
    fr: { name: '', description: '' },
    en: { name: '', description: '' },
    nl: { name: '', description: '' }
  }

  if (!category?.translations) return defaultTranslations

  const translations = { ...defaultTranslations }
  category.translations.forEach(t => {
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

const onGeneralValuesUpdate = (newValues: Record<string, any>) => {
  generalValues.value = { ...generalValues.value, ...newValues }

  if (newValues.code !== undefined) {
    generalValues.value.code = newValues.code
    code.value = newValues.code
  }
  if (newValues.isActive !== undefined) {
    generalValues.value.isActive = newValues.isActive
    isActive.value = newValues.isActive
  }
}

const onTranslationsValidationChange = (isValid: boolean, errs: Record<string, string[]>) => {
  isTranslationsValid.value = isValid
  translationsErrors.value = errs
}

const isFormValid = computed(() => {
  return !Object.keys(errors.value || {}).length && isTranslationsValid.value
})

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
  if (!isFormValid.value) return

  const translations = convertToTranslationsArray()

  const adaptedData = isEditing.value
    ? {
        id: props.category!.id,
        code: code.value || undefined,
        isActive: isActive.value === 'true',
        translations
      } as UpdateCategoryDto & { id: number }
    : {
        code: code.value,
        isActive: isActive.value === 'true',
        translations
      } as CreateCategoryDto

  emit('submit', adaptedData)
})

const updateFieldValues = () => {
  if (props.category) {
    generalValues.value = {
      code: props.category.code || '',
      isActive: props.category.isActive ? 'true' : 'false'
    }

    code.value = props.category.code || ''
    isActive.value = props.category.isActive ? 'true' : 'false'

    translationsData.value = extractTranslations(props.category)
  } else {
    generalValues.value = { code: '', isActive: 'true' }
    code.value = ''
    isActive.value = 'true'
    translationsData.value = {
      fr: { name: '', description: '' },
      en: { name: '', description: '' },
      nl: { name: '', description: '' }
    }
  }

  nextTick(() => {
    if (props.category) {
      code.value = props.category.code || ''
      isActive.value = props.category.isActive ? 'true' : 'false'
    } else {
      code.value = ''
      isActive.value = 'true'
    }
  })
}

const onCancel = () => {
  generalValues.value = { code: '', isActive: 'true' }
  translationsData.value = {
    fr: { name: '', description: '' },
    en: { name: '', description: '' },
    nl: { name: '', description: '' }
  }

  nextTick(() => {
    code.value = ''
    isActive.value = 'true'
    resetForm()
  })

  emit('cancel')
}

watch(() => props.isOpen, (isOpen) => {
  if (isOpen) {
    nextTick(() => {
      updateFieldValues()
    })
  }
}, { immediate: false })

watch(() => props.category, () => {
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
          {{ isEditing ? 'Modifier la categorie' : 'Nouvelle categorie' }}
        </UiDialogTitle>
        <UiDialogDescription>
          {{ isEditing ? 'Modifiez les informations de la categorie.' : 'Creez une nouvelle categorie avec ses traductions.' }}
        </UiDialogDescription>
      </UiDialogHeader>

      <form
        v-if="isOpen"
        :key="`form-${props.category?.id || 'new'}-${isOpen}`"
        class="space-y-6"
        @submit="onSubmit"
      >
        <div class="space-y-4">
          <MultilingualFormFields
            v-model="translationsData"
            :general-fields="generalFields"
            :general-values="generalValues"
            :general-errors="generalErrors"
            :fields="multilingualFields"
            :validation-rules="multilingualValidationRules"
            title="Traduction des categories"
            :disabled="isLoading"
            @update:general-values="onGeneralValuesUpdate"
            @validation-change="onTranslationsValidationChange"
          />
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
          <UiButton type="submit" :disabled="isLoading || !isFormValid">
            <AppSpinner v-if="isLoading" class="mr-2 h-4 w-4" />
            {{ isEditing ? 'Modifier' : 'Enregistrer' }}
          </UiButton>
        </UiDialogFooter>
      </form>
    </UiDialogContent>
  </UiDialog>
</template>
