<script setup lang="ts">
import { z } from 'zod'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm, useField } from 'vee-validate'
import type { RejectionReason, CreateRejectionReasonDto, UpdateRejectionReasonDto } from '~~/shared/types/rejection-reason'
import {
  createRejectionReasonFields,
  createRejectionReasonGeneralFields,
  COMMON_VALIDATION_RULES,
  type GeneralField,
} from '~/composables/useMultilingualForm'
import MultilingualFormFields from '~/components/forms/MultilingualFormFields.vue'

interface Props {
  rejectionReason?: RejectionReason | null
  isLoading?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'submit': [data: CreateRejectionReasonDto | (UpdateRejectionReasonDto & { id: number })]
  'cancel': []
}>()

const isEditing = computed(() => !!props.rejectionReason)

const validationSchema = toTypedSchema(z.object({
  code: z.string().min(3, 'Le code doit contenir au moins 3 caractères')
    .regex(/^[a-z_]+$/, 'Le code doit être en snake_case'),
  isActive: z.string().optional(),
}))

const { handleSubmit, resetForm, errors } = useForm({
  validationSchema,
  initialValues: { code: '', isActive: 'true' },
})

const { value: code } = useField<string>('code')
const { value: isActive } = useField<string>('isActive')

const translationsData = ref({
  fr: { name: '', description: '' },
  en: { name: '', description: '' },
  nl: { name: '', description: '' },
})

const generalFields = ref<GeneralField[]>(createRejectionReasonGeneralFields())
const generalValues = ref({ code: '', isActive: 'true' })
const generalErrors = computed(() => ({
  code: errors.value.code,
  isActive: errors.value.isActive,
}))

const multilingualFields = createRejectionReasonFields()
const multilingualValidationRules = {
  name: COMMON_VALIDATION_RULES.name,
  description: COMMON_VALIDATION_RULES.description,
}

const isTranslationsValid = ref(false)

const onGeneralValuesUpdate = (newValues: Record<string, any>) => {
  generalValues.value = { ...generalValues.value, ...newValues }
  if (newValues.code !== undefined) code.value = newValues.code
  if (newValues.isActive !== undefined) isActive.value = newValues.isActive
}

const onTranslationsValidationChange = (isValid: boolean) => {
  isTranslationsValid.value = isValid
}

const isFormValid = computed(() => {
  return !Object.keys(errors.value || {}).length && isTranslationsValid.value
})

const convertToTranslationsArray = () => {
  const translations: Array<{ languageCode: string; name: string; description?: string }> = []
  for (const langCode of ['fr', 'en', 'nl']) {
    const t = translationsData.value[langCode as keyof typeof translationsData.value]
    if (t.name?.trim()) {
      translations.push({
        languageCode: langCode,
        name: t.name,
        description: t.description || undefined,
      })
    }
  }
  return translations
}

const onSubmit = handleSubmit(() => {
  if (!isFormValid.value) return

  const translations = convertToTranslationsArray()

  if (isEditing.value) {
    emit('submit', {
      id: props.rejectionReason!.id,
      code: code.value,
      isActive: isActive.value === 'true',
      translations,
    } as UpdateRejectionReasonDto & { id: number })
  } else {
    emit('submit', {
      code: code.value,
      isActive: isActive.value === 'true',
      translations,
    } as CreateRejectionReasonDto)
  }
})

const extractTranslations = (reason: RejectionReason | null) => {
  const defaults = {
    fr: { name: '', description: '' },
    en: { name: '', description: '' },
    nl: { name: '', description: '' },
  }
  if (!reason?.translations) return defaults

  const result = { ...defaults }
  reason.translations.forEach((t) => {
    const lang = t.languageCode as keyof typeof result
    if (lang in result) {
      result[lang] = { name: t.name || '', description: t.description || '' }
    }
  })
  return result
}

const updateFieldValues = () => {
  if (props.rejectionReason) {
    code.value = props.rejectionReason.code || ''
    isActive.value = props.rejectionReason.isActive ? 'true' : 'false'
    generalValues.value = {
      code: props.rejectionReason.code || '',
      isActive: props.rejectionReason.isActive ? 'true' : 'false',
    }
    translationsData.value = extractTranslations(props.rejectionReason)
  } else {
    code.value = ''
    isActive.value = 'true'
    generalValues.value = { code: '', isActive: 'true' }
    translationsData.value = {
      fr: { name: '', description: '' },
      en: { name: '', description: '' },
      nl: { name: '', description: '' },
    }
  }
}

watch(() => props.rejectionReason, () => {
  nextTick(() => updateFieldValues())
}, { immediate: true })
</script>

<template>
  <form class="space-y-6" @submit="onSubmit">
    <MultilingualFormFields
      v-model="translationsData"
      :general-fields="generalFields"
      :general-values="generalValues"
      :general-errors="generalErrors"
      :fields="multilingualFields"
      :validation-rules="multilingualValidationRules"
      title="Traductions du motif de rejet"
      :disabled="isLoading"
      @update:general-values="onGeneralValuesUpdate"
      @validation-change="onTranslationsValidationChange"
    />

    <div class="flex justify-end gap-3 pt-4 border-t">
      <UiButton type="button" variant="outline" :disabled="isLoading" @click="emit('cancel')">
        Annuler
      </UiButton>
      <UiButton type="submit" :disabled="isLoading || !isFormValid">
        <AppSpinner v-if="isLoading" class="mr-2 h-4 w-4" />
        {{ isEditing ? 'Modifier' : 'Enregistrer' }}
      </UiButton>
    </div>
  </form>
</template>
