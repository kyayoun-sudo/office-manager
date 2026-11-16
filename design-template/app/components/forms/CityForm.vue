<script setup lang="ts">
import { z } from 'zod'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm, useField } from 'vee-validate'
import { api } from '~/utils/api'
import type { City, CreateCityDto, UpdateCityDto } from '#shared/types/city'
import type { Country } from '#shared/types/country'
import { createCityFields, createCityGeneralFields, COMMON_VALIDATION_RULES, type GeneralField } from '~/composables/useMultilingualForm'
import MultilingualFormFields from './MultilingualFormFields.vue'

interface Props {
  city?: City | null
  isOpen: boolean
  isLoading?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'submit': [data: CreateCityDto | (UpdateCityDto & { id: number })]
  'cancel': []
}>()

const isEditing = computed(() => !!props.city)

const validationSchema = toTypedSchema(z.object({
  postalCode: z.string().min(1, 'Le code postal est requis'),
  country: z.string().min(1, 'Le pays est requis'),
  isActive: z.string().optional(),
}))

const { handleSubmit, resetForm, errors } = useForm({
  validationSchema,
  initialValues: {
    postalCode: '',
    country: '',
    isActive: 'true',
  },
})

const { value: postalCode } = useField<string>('postalCode')
const { value: country } = useField<string>('country')
const { value: isActive } = useField<string>('isActive')

const translationsData = ref({
  fr: { name: '' },
  en: { name: '' },
  nl: { name: '' },
})

const generalFields = ref<GeneralField[]>(createCityGeneralFields())
const generalValues = ref({
  postalCode: '',
  country: '',
  isActive: 'true',
})
const generalErrors = computed(() => ({
  postalCode: errors.value.postalCode,
  country: errors.value.country,
  isActive: errors.value.isActive,
}))

const multilingualFields = createCityFields()
const multilingualValidationRules = {
  name: COMMON_VALIDATION_RULES.name,
}

const isTranslationsValid = ref(false)
const translationsErrors = ref<Record<string, string[]>>({})

const countries = ref<Country[]>([])
const countriesLoading = ref(false)

const languages = ref<Array<{ id: number; code: string }>>([])

const fetchCountries = async () => {
  try {
    countriesLoading.value = true
    const response = await api.get('/countries', {
      params: { active: true, includeAllTranslations: false },
    })
    if (response.success && response.data) {
      countries.value = Array.isArray(response.data) ? response.data : []
    }
  } catch {
    countries.value = []
  } finally {
    countriesLoading.value = false
  }
}

const fetchLanguages = async () => {
  try {
    const response = await api.get('/languages/enabled')
    if (response.success && response.data) {
      const data = Array.isArray(response.data)
        ? response.data
        : (response.data as any)?.data || []
      languages.value = data.map((l: any) => ({ id: l.id, code: l.code }))
    }
  } catch {
    languages.value = []
  }
}

const availableCountries = computed(() => {
  return countries.value.map((c) => {
    const frTranslation = c.translations?.find((t) => t.language?.code === 'fr')
    return {
      value: c.id.toString(),
      label: frTranslation?.name || c.code,
    }
  })
})

const langIdMap = computed(() => {
  const map: Record<string, number> = {}
  languages.value.forEach((l) => {
    map[l.code] = l.id
  })
  return map
})

onMounted(async () => {
  await Promise.all([fetchCountries(), fetchLanguages()])
})

const extractTranslations = (city: City | null) => {
  const defaultTranslations = {
    fr: { name: '' },
    en: { name: '' },
    nl: { name: '' },
  }
  if (!city?.translations) return defaultTranslations

  const translations = { ...defaultTranslations }
  city.translations.forEach((t) => {
    const langCode = t.language.code as keyof typeof translations
    if (langCode in translations) {
      translations[langCode] = { name: t.name || '' }
    }
  })
  return translations
}

const onGeneralValuesUpdate = (newValues: Record<string, any>) => {
  generalValues.value = { ...generalValues.value, ...newValues }
  if (newValues.postalCode !== undefined) postalCode.value = newValues.postalCode
  if (newValues.country !== undefined) country.value = newValues.country
  if (newValues.isActive !== undefined) isActive.value = newValues.isActive
}

const onTranslationsValidationChange = (valid: boolean, errs: Record<string, string[]>) => {
  isTranslationsValid.value = valid
  translationsErrors.value = errs
}

const isFormValid = computed(() => {
  return !Object.keys(errors.value || {}).length && isTranslationsValid.value
})

const convertToTranslationsArray = () => {
  const translations: Array<{ languageId: number; name: string }> = []
  for (const langCode of ['fr', 'en', 'nl'] as const) {
    const translation = translationsData.value[langCode]
    const langId = langIdMap.value[langCode]
    if (translation.name?.trim() && langId) {
      translations.push({ languageId: langId, name: translation.name })
    }
  }
  return translations
}

const onSubmit = handleSubmit(() => {
  if (!isFormValid.value) return

  const translations = convertToTranslationsArray()

  const adaptedData = isEditing.value
    ? {
        id: props.city!.id,
        postalCode: postalCode.value || undefined,
        countryId: parseInt(country.value) || undefined,
        isActive: isActive.value === 'true',
        translations,
      } as UpdateCityDto & { id: number }
    : {
        postalCode: postalCode.value,
        countryId: parseInt(country.value),
        isActive: isActive.value === 'true',
        translations,
      } as CreateCityDto

  emit('submit', adaptedData)
})

watch(() => availableCountries.value, (newCountries) => {
  if (generalFields.value) {
    const countryField = generalFields.value.find((f) => f.key === 'country')
    if (countryField) {
      countryField.options = newCountries
      countryField.loading = countriesLoading.value
    }
  }
}, { immediate: true })

const updateFieldValues = () => {
  if (props.city) {
    const countryVal = props.city.country?.id?.toString() || ''

    postalCode.value = props.city.postalCode || ''
    country.value = countryVal
    isActive.value = props.city.isActive ? 'true' : 'false'

    generalValues.value = {
      postalCode: props.city.postalCode || '',
      country: countryVal,
      isActive: props.city.isActive ? 'true' : 'false',
    }

    translationsData.value = extractTranslations(props.city)
  } else {
    postalCode.value = ''
    country.value = ''
    isActive.value = 'true'
    generalValues.value = { postalCode: '', country: '', isActive: 'true' }
    translationsData.value = { fr: { name: '' }, en: { name: '' }, nl: { name: '' } }
  }
}

const onCancel = () => {
  postalCode.value = ''
  country.value = ''
  isActive.value = 'true'
  generalValues.value = { postalCode: '', country: '', isActive: 'true' }
  translationsData.value = { fr: { name: '' }, en: { name: '' }, nl: { name: '' } }
  resetForm()
  emit('cancel')
}

watch(() => props.isOpen, (isOpen) => {
  if (isOpen) {
    nextTick(() => updateFieldValues())
  }
}, { immediate: false })

watch(() => props.city, () => {
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
          {{ isEditing ? 'Modifier la ville' : 'Nouvelle ville' }}
        </UiDialogTitle>
        <UiDialogDescription>
          {{ isEditing ? 'Modifiez les informations de la ville.' : 'Ajoutez une nouvelle ville avec ses traductions.' }}
        </UiDialogDescription>
      </UiDialogHeader>

      <form
        v-if="isOpen"
        :key="`form-${props.city?.id || 'new'}-${isOpen}`"
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
              title="Traduction des villes"
              :disabled="isLoading"
              @update:general-values="onGeneralValuesUpdate"
              @validation-change="onTranslationsValidationChange"
            />
          </div>
        </div>

        <UiDialogFooter class="pt-6 border-t">
          <UiButton type="button" variant="outline" :disabled="isLoading" @click="onCancel">
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
