<script setup lang="ts">
import { z } from 'zod'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm, useField } from 'vee-validate'
import { nextTick } from 'vue'
import type { DeliveryParity, CreateDeliveryParityDto, UpdateDeliveryParityDto } from '#shared/types/delivery-parity'
import { createDeliveryParityFields, COMMON_VALIDATION_RULES, type GeneralField } from '~/composables/useMultilingualForm'
import MultilingualFormFields from './MultilingualFormFields.vue'

interface Props {
  deliveryParity?: DeliveryParity | null
  isOpen: boolean
  isLoading?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'submit': [data: CreateDeliveryParityDto | (UpdateDeliveryParityDto & { id: number })]
  'cancel': []
}>()

const isEditing = computed(() => !!props.deliveryParity)

const validationSchema = toTypedSchema(z.object({
  code: z.string().min(1, 'Le code est requis'),
}))

const { handleSubmit, resetForm, errors } = useForm({
  validationSchema,
  initialValues: { code: '' }
})

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
    placeholder: 'Code unique (ex: G1P0)',
    required: true
  },
])

const generalValues = ref({ code: '' })
const generalErrors = computed(() => ({
  code: errors.value.code,
}))

const multilingualFields = createDeliveryParityFields()
const multilingualValidationRules = {
  name: COMMON_VALIDATION_RULES.name,
  description: COMMON_VALIDATION_RULES.description
}

const isTranslationsValid = ref(false)
const translationsErrors = ref<Record<string, string[]>>({})

const extractTranslations = (parity: DeliveryParity | null) => {
  const defaultTranslations = {
    fr: { name: '', description: '' },
    en: { name: '', description: '' },
    nl: { name: '', description: '' }
  }

  if (!parity?.translations) return defaultTranslations

  const translations = { ...defaultTranslations }
  parity.translations.forEach(t => {
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
        id: props.deliveryParity!.id,
        code: code.value || undefined,
        translations
      } as UpdateDeliveryParityDto & { id: number }
    : {
        code: code.value,
        translations
      } as CreateDeliveryParityDto

  emit('submit', adaptedData)
})

const updateFieldValues = () => {
  if (props.deliveryParity) {
    generalValues.value = { code: props.deliveryParity.code || '' }
    code.value = props.deliveryParity.code || ''
    translationsData.value = extractTranslations(props.deliveryParity)
  } else {
    generalValues.value = { code: '' }
    code.value = ''
    translationsData.value = {
      fr: { name: '', description: '' },
      en: { name: '', description: '' },
      nl: { name: '', description: '' }
    }
  }

  nextTick(() => {
    if (props.deliveryParity) {
      code.value = props.deliveryParity.code || ''
    } else {
      code.value = ''
    }
  })
}

const onCancel = () => {
  generalValues.value = { code: '' }
  translationsData.value = {
    fr: { name: '', description: '' },
    en: { name: '', description: '' },
    nl: { name: '', description: '' }
  }
  nextTick(() => {
    code.value = ''
    resetForm()
  })
  emit('cancel')
}

watch(() => props.isOpen, (isOpen) => {
  if (isOpen) {
    nextTick(() => updateFieldValues())
  }
}, { immediate: false })

watch(() => props.deliveryParity, () => {
  if (props.isOpen) {
    nextTick(() => updateFieldValues())
  }
}, { immediate: false })
</script>

<template>
  <UiDialog :open="isOpen" @update:open="$event || onCancel()">
    <UiDialogContent class="max-w-4xl max-h-[90vh] overflow-y-auto">
      <UiDialogHeader>
        <UiDialogTitle>
          {{ isEditing ? "Modifier le quantieme d'accouchement" : "Nouveau quantieme d'accouchement" }}
        </UiDialogTitle>
        <UiDialogDescription>
          {{ isEditing ? "Modifiez les informations du quantieme d'accouchement." : "Creez un nouveau quantieme d'accouchement avec ses traductions." }}
        </UiDialogDescription>
      </UiDialogHeader>

      <form
        v-if="isOpen"
        :key="`form-${props.deliveryParity?.id || 'new'}-${isOpen}`"
        class="space-y-6"
        @submit="onSubmit"
      >
        <div class="space-y-6">
          <div class="space-y-4">
            <MultilingualFormFields
              v-model="translationsData"
              :general-fields="generalFields"
              :general-values="generalValues"
              :general-errors="generalErrors"
              :fields="multilingualFields"
              :validation-rules="multilingualValidationRules"
              title="Traduction des quantiemes d'accouchement"
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
          <UiButton type="submit" :disabled="isLoading || !isFormValid">
            <AppSpinner v-if="isLoading" class="mr-2 h-4 w-4" />
            {{ isEditing ? 'Modifier' : 'Enregistrer' }}
          </UiButton>
        </UiDialogFooter>
      </form>
    </UiDialogContent>
  </UiDialog>
</template>
