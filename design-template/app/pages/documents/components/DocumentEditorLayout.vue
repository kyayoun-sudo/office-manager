<script setup lang="ts">
import { z } from 'zod'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { ArrowLeft, Save, X, Eye } from 'lucide-vue-next'
import type { Document } from '~~/shared/types/document'
import { COMMON_VALIDATION_RULES } from '~/composables/useMultilingualForm'
import MultilingualFormFields from '~/components/forms/MultilingualFormFields.vue'

interface Props {
  document?: Document | null
  isLoading?: boolean
  usedDocumentTypes?: string[]
}

const props = withDefaults(defineProps<Props>(), {
  document: null,
  isLoading: false,
  usedDocumentTypes: () => [],
})

const emit = defineEmits<{
  submit: [data: Record<string, any>]
  cancel: []
}>()

const isEditing = computed(() => !!props.document)
const showMobilePreview = ref(false)
const selectedDocumentType = ref('')

const allDocumentTypes = [
  { value: 'terms', label: "Conditions Generales d'Utilisation" },
  { value: 'privacy', label: 'Politique de Confidentialite' },
  { value: 'sales_conditions', label: 'Conditions Generales de Vente' },
]

const availableDocumentTypes = computed(() => {
  if (isEditing.value) return allDocumentTypes
  return allDocumentTypes.filter((t) => !props.usedDocumentTypes.includes(t.value))
})

const validationSchema = toTypedSchema(z.object({}))

const { handleSubmit, resetForm, errors } = useForm({
  validationSchema,
  initialValues: {},
})

const translationsData = ref<Record<string, Record<string, string>>>({
  fr: { title: '', content: '' },
  en: { title: '', content: '' },
  nl: { title: '', content: '' },
})

const isActive = ref(true)

const generalValues = ref<Record<string, any>>({})

const generalErrors = computed(() => ({}))

const generalFields = ref([] as any[])

const multilingualFields = [
  {
    key: 'title',
    label: 'Titre',
    type: 'text' as const,
    required: true,
    maxLength: 200,
    minLength: 3,
    showCharCount: true,
  },
  {
    key: 'content',
    label: 'Contenu',
    type: 'markdown' as const,
    required: true,
    maxLength: 5000,
    minLength: 10,
    rows: 6,
    showCharCount: true,
  },
]

const multilingualValidationRules = {
  title: COMMON_VALIDATION_RULES.title,
  content: COMMON_VALIDATION_RULES.content,
}

const isTranslationsValid = ref(false)

const onGeneralValuesUpdate = (newValues: Record<string, any>) => {
  generalValues.value = { ...generalValues.value, ...newValues }
}

const onTranslationsValidationChange = (isValid: boolean) => {
  isTranslationsValid.value = isValid
}

const isFormValid = computed(() => {
  const hasDocumentType = isEditing.value || !!selectedDocumentType.value
  return !Object.keys(errors.value || {}).length && isTranslationsValid.value && hasDocumentType
})

const convertToTranslationsArray = () => {
  const translations = []
  for (const langCode of ['fr', 'en', 'nl']) {
    const translation = translationsData.value[langCode]
    if (translation?.title?.trim() && translation?.content?.trim()) {
      translations.push({
        languageCode: langCode,
        title: translation.title,
        content: translation.content,
      })
    }
  }
  return translations
}

const onSubmit = handleSubmit(() => {
  if (!isFormValid.value) return

  const translations = convertToTranslationsArray()
  const data: Record<string, any> = {
    isActive: isActive.value,
    translations,
  }

  if (isEditing.value && props.document) {
    data.id = props.document.id
  } else {
    data.documentType = selectedDocumentType.value
  }

  emit('submit', data)
})

const extractTranslations = (document: Document | null) => {
  const defaultTranslations: Record<string, Record<string, string>> = {
    fr: { title: '', content: '' },
    en: { title: '', content: '' },
    nl: { title: '', content: '' },
  }

  if (!document?.translations) return defaultTranslations

  const translations = { ...defaultTranslations }
  document.translations.forEach((t) => {
    const langCode = t.language.code as 'fr' | 'en' | 'nl'
    if (langCode in translations) {
      translations[langCode] = {
        title: t.title || '',
        content: t.content || '',
      }
    }
  })

  return translations
}

const populateForm = (document: Document | null) => {
  if (document) {
    isActive.value = document.isActive ?? false
    selectedDocumentType.value = document.documentType || ''
    generalValues.value = {}
    translationsData.value = extractTranslations(document)
  }
}

watch(() => props.document, (doc) => {
  if (doc) {
    nextTick(() => populateForm(doc))
  }
}, { immediate: true })
</script>

<template>
  <div class="flex flex-col h-[calc(100vh-4rem)] -mx-4 -mb-4">
    <div class="flex items-center justify-between border-b bg-background px-4 py-3 md:px-6 shrink-0">
      <div class="flex items-center gap-3">
        <UiButton variant="ghost" size="icon" @click="emit('cancel')">
          <ArrowLeft class="h-4 w-4" />
        </UiButton>
        <div>
          <h1 class="text-lg font-semibold">
            {{ isEditing ? 'Modifier le document' : 'Nouveau document' }}
          </h1>
          <p class="text-xs text-muted-foreground hidden sm:block">
            {{ isEditing ? 'Modifiez les informations du document.' : 'Creez un nouveau document avec ses traductions.' }}
          </p>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <label class="flex items-center gap-2 text-sm cursor-pointer">
          <UiSwitch :checked="isActive" @update:checked="isActive = $event" />
          <span class="text-xs font-medium" :class="isActive ? 'text-green-600' : 'text-muted-foreground'">
            {{ isActive ? 'Actif' : 'Inactif' }}
          </span>
        </label>
        <div class="h-4 w-px bg-border" />
        <UiButton
          variant="outline"
          size="sm"
          class="md:hidden"
          @click="showMobilePreview = true"
        >
          <Eye class="h-4 w-4" />
        </UiButton>
        <UiButton variant="outline" size="sm" :disabled="isLoading" @click="emit('cancel')">
          <X class="h-4 w-4 mr-1.5 hidden sm:inline" />
          Annuler
        </UiButton>
        <UiButton size="sm" :disabled="isLoading || !isFormValid" @click="onSubmit">
          <AppSpinner v-if="isLoading" class="mr-2 h-4 w-4" />
          <Save v-else class="h-4 w-4 mr-1.5 hidden sm:inline" />
          {{ isEditing ? 'Modifier' : 'Enregistrer' }}
        </UiButton>
      </div>
    </div>

    <div class="flex-1 flex overflow-hidden">
      <div class="flex-1 overflow-y-auto p-4 md:p-6 md:w-[55%] md:flex-none">
        <form class="space-y-6 max-w-3xl" @submit.prevent="onSubmit">
          <div v-if="!isEditing" class="space-y-2">
            <label class="text-sm font-medium">Type de document <span class="text-destructive">*</span></label>
            <UiSelect v-model="selectedDocumentType" :disabled="isLoading">
              <UiSelectTrigger class="w-full">
                <UiSelectValue placeholder="Selectionner un type de document" />
              </UiSelectTrigger>
              <UiSelectContent>
                <UiSelectItem
                  v-for="dt in availableDocumentTypes"
                  :key="dt.value"
                  :value="dt.value"
                >
                  {{ dt.label }}
                </UiSelectItem>
              </UiSelectContent>
            </UiSelect>
            <p v-if="availableDocumentTypes.length === 0" class="text-sm text-muted-foreground">
              Tous les types de documents sont deja utilises.
            </p>
          </div>
          <div v-else class="space-y-2">
            <label class="text-sm font-medium">Type de document</label>
            <p class="text-sm text-muted-foreground">
              {{ allDocumentTypes.find((t) => t.value === selectedDocumentType)?.label || selectedDocumentType }}
            </p>
          </div>

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
        </form>
      </div>

      <div class="hidden md:flex md:w-[45%] md:flex-none border-l">
        <DocumentPreviewPanel
          :translations-data="translationsData"
          class="w-full"
        />
      </div>
    </div>

    <Teleport to="body">
      <Transition
        enter-active-class="transition-transform duration-200 ease-out"
        enter-from-class="translate-y-full"
        enter-to-class="translate-y-0"
        leave-active-class="transition-transform duration-200 ease-in"
        leave-from-class="translate-y-0"
        leave-to-class="translate-y-full"
      >
        <div
          v-if="showMobilePreview"
          class="fixed inset-0 z-50 bg-background flex flex-col md:hidden"
        >
          <div class="flex items-center justify-between border-b px-4 py-3">
            <h2 class="text-sm font-medium">Apercu du document</h2>
            <UiButton variant="ghost" size="sm" @click="showMobilePreview = false">
              <X class="h-4 w-4" />
            </UiButton>
          </div>
          <DocumentPreviewPanel
            :translations-data="translationsData"
            class="flex-1"
          />
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
