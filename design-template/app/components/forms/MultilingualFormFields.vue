<template>
  <div class="space-y-4">
    <!-- Champs généraux (non-multilingues) -->
    <div v-if="generalFields && generalFields.length > 0" class="space-y-4">
      <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div
          v-for="field in generalFields"
          :key="field.key"
          class="space-y-1"
        >
          <label class="text-xs font-medium flex items-center space-x-1">
            <span>{{ field.label }}</span>
            <span v-if="field.required" class="text-red-500">*</span>
          </label>
          
          <!-- Champ texte général -->
          <UiInput
            v-if="field.type === 'text'"
            :model-value="generalValues?.[field.key] || ''"
            :placeholder="field.placeholder || ''"
            :disabled="disabled"
            :class="generalErrors?.[field.key] ? 'border-red-500' : ''"
            @input="updateGeneralField(field.key, $event.target.value)"
          />

          <!-- Champ select général -->
          <UiSelect
            v-else-if="field.type === 'select'"
            :model-value="generalValues?.[field.key] || ''"
            :disabled="disabled || field.loading"
            @update:model-value="updateGeneralField(field.key, $event)"
          >
            <UiSelectTrigger :class="generalErrors?.[field.key] ? 'border-red-500' : ''">
              <UiSelectValue :placeholder="field.loading ? 'Chargement...' : field.placeholder || 'Sélectionner'" />
            </UiSelectTrigger>
            <UiSelectContent>
              <UiSelectItem 
                v-for="option in field.options" 
                :key="option.value" 
                :value="option.value"
              >
                {{ option.label }}
              </UiSelectItem>
            </UiSelectContent>
          </UiSelect>
          
          <!-- Champ textarea général -->
          <UiTextarea
            v-else-if="field.type === 'textarea'"
            :model-value="generalValues?.[field.key] || ''"
            :placeholder="field.placeholder || ''"
            :disabled="disabled"
            :class="`min-h-[60px] ${generalErrors?.[field.key] ? 'border-red-500' : ''}`"
            @input="updateGeneralField(field.key, $event.target.value)"
          />
          
          <!-- Champ switch général -->
          <div v-else-if="field.type === 'switch'" class="flex items-center space-x-3">
            <UiSwitch
              :checked="generalValues?.[field.key] || false"
              :disabled="disabled"
              @update:checked="updateGeneralField(field.key, $event)"
            />
            <span class="text-sm">{{ field.switchLabel }}</span>
          </div>
          
          <!-- Description du champ -->
          <p v-if="field.description" class="text-[10px] text-muted-foreground">
            {{ field.description }}
          </p>
          
          <!-- Message d'erreur pour champs généraux -->
          <p v-if="generalErrors?.[field.key]" class="text-[10px] text-red-600">
            {{ generalErrors[field.key] }}
          </p>
        </div>
      </div>
    </div>

    <!-- Traductions -->
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <Globe class="h-3.5 w-3.5 text-muted-foreground" />
          <h4 class="text-sm font-medium">{{ title }}</h4>
        </div>

        <UiButton
          v-if="hasAnyContent(activeTab)"
          variant="ghost"
          size="sm"
          class="h-7 px-2 text-xs text-muted-foreground"
          :disabled="disabled"
          title="Effacer cette langue"
          @click="clearLanguage(activeTab)"
        >
          <Trash2 class="h-3 w-3" />
        </UiButton>
      </div>

      <!-- Onglets pill -->
      <div class="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
        <button
          v-for="lang in supportedLanguages"
          :key="lang.code"
          type="button"
          class="relative inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150"
          :class="activeTab === lang.code
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'"
          :disabled="disabled"
          @click="changeTab(lang.code)"
        >
          <span>{{ lang.flag }}</span>
          <span>{{ lang.name }}</span>
          <CheckCircle2
            v-if="isLanguageComplete(lang.code) && !hasLanguageErrors(lang.code)"
            class="h-3 w-3 text-green-500"
          />
        </button>
      </div>
    </div>

    <!-- Contenu de l'onglet actif -->
    <div class="space-y-3">
      <template v-for="lang in supportedLanguages" :key="lang.code">
        <div v-if="activeTab === lang.code" class="grid gap-3">
          <div
            v-for="field in fields"
            :key="field.key"
            class="space-y-1"
          >
            <label class="text-xs font-medium flex items-center space-x-1">
              <span>{{ field.label }} ({{ lang.name }})</span>
              <span v-if="field.required" class="text-red-500">*</span>
            </label>

            <!-- Champ texte simple -->
            <UiInput
              v-if="field.type === 'text'"
              v-model="modelValue[lang.code][field.key]"
              :placeholder="getPlaceholder(field, lang)"
              :disabled="disabled"
              :class="getFieldError(lang.code, field.key) ? 'border-red-500' : ''"
              @input="validateField(lang.code, field.key)"
            />

            <!-- Champ textarea -->
            <UiTextarea
              v-else-if="field.type === 'textarea'"
              v-model="modelValue[lang.code][field.key]"
              :placeholder="getPlaceholder(field, lang)"
              :disabled="disabled"
              :class="`${field.rows ? `min-h-[${field.rows * 20}px]` : 'min-h-[60px]'} ${getFieldError(lang.code, field.key) ? 'border-red-500' : ''}`"
              @input="validateField(lang.code, field.key)"
            />

            <!-- Champ markdown/rich text -->
            <UiMarkdownEditor
              v-else-if="field.type === 'markdown'"
              v-model="modelValue[lang.code][field.key]"
              :placeholder="getPlaceholder(field, lang)"
              :disabled="disabled"
              :min-height="500"
              :max-length="field.maxLength"
              :show-word-count="field.showCharCount"
              :class="getFieldError(lang.code, field.key) ? 'border-red-500' : ''"
              @update:model-value="validateField(lang.code, field.key)"
            />

            <!-- Message d'erreur -->
            <p v-if="getFieldError(lang.code, field.key)" class="text-[10px] text-red-600">
              {{ getFieldError(lang.code, field.key) }}
            </p>
          </div>
        </div>
      </template>
    </div>

  </div>
</template>

<script setup lang="ts">
import { Globe, Copy, Trash2, CheckCircle2 } from 'lucide-vue-next'
import { nextTick, watch, ref, computed, onMounted } from 'vue'
import UiMarkdownEditor from '~/components/ui/markdown-editor/MarkdownEditor.vue'

// Types pour la configuration
interface Language {
  code: string
  name: string
  flag: string
  required?: boolean
}

interface FormField {
  key: string
  label: string
  type: 'text' | 'textarea' | 'markdown'
  required?: boolean
  maxLength?: number
  rows?: number
  showCharCount?: boolean
  description?: string
  placeholder?: Record<string, string>
}

interface GeneralField {
  key: string
  label: string
  type: 'text' | 'textarea' | 'select'
  required?: boolean
  maxLength?: number
  placeholder?: string
  options?: Array<{value: string | number, label: string}>
  loading?: boolean
  description?: string
}

interface Props {
  modelValue: Record<string, Record<string, string>>
  generalFields?: GeneralField[]
  generalValues?: Record<string, any>
  generalErrors?: Record<string, string>
  fields: FormField[]
  disabled?: boolean
  title?: string
  showValidationSummary?: boolean
  validationRules?: Record<string, (value: string, lang: string) => string | null>
}

// Configuration fixe des 3 langues obligatoires
const REQUIRED_LANGUAGES = [
  { code: 'fr', name: 'Français', flag: '🇫🇷', required: true },
  { code: 'en', name: 'English', flag: '🇬🇧', required: true },
  { code: 'nl', name: 'Nederlands', flag: '🇳🇱', required: true }
]

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  title: 'Traductions multilingues',
  showValidationSummary: true,
  validationRules: () => ({})
})

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, Record<string, string>>]
  'update:generalValues': [value: Record<string, any>]
  'validation-change': [isValid: boolean, errors: Record<string, string[]>]
}>()

// État local
const activeTab = ref('fr')
const errors = ref<Record<string, Record<string, string>>>({})
const touchedFields = ref<Record<string, Record<string, boolean>>>({})

// Langues supportées - toujours les 3 langues obligatoires
const supportedLanguages = computed(() => REQUIRED_LANGUAGES)

// Fonctions utilitaires
const changeTab = (langCode: string) => {
  activeTab.value = langCode
}

const isRequired = (langCode: string): boolean => {
  // Toutes les langues sont obligatoires maintenant
  return true
}

const getPlaceholder = (field: FormField, lang: Language): string => {
  if (field.placeholder?.[lang.code]) {
    return field.placeholder[lang.code]
  }
  
  // Placeholders par défaut basés sur la langue
  const defaultPlaceholders = {
    fr: {
      text: `${field.label} en français`,
      textarea: `${field.label} en français...`,
      markdown: `${field.label} en markdown français...`
    },
    en: {
      text: `${field.label} in English`,
      textarea: `${field.label} in English...`, 
      markdown: `${field.label} in English markdown...`
    },
    nl: {
      text: `${field.label} in het Nederlands`,
      textarea: `${field.label} in het Nederlands...`,
      markdown: `${field.label} in het Nederlands markdown...`
    },
    de: {
      text: `${field.label} auf Deutsch`,
      textarea: `${field.label} auf Deutsch...`,
      markdown: `${field.label} auf Deutsch markdown...`
    }
  }
  
  return defaultPlaceholders[lang.code as keyof typeof defaultPlaceholders]?.[field.type] || `${field.label}...`
}

const markFieldTouched = (langCode: string, fieldKey: string) => {
  if (!touchedFields.value[langCode]) {
    touchedFields.value[langCode] = {}
  }
  touchedFields.value[langCode][fieldKey] = true
}

const validateField = (langCode: string, fieldKey: string) => {
  // Marquer le champ comme touché
  markFieldTouched(langCode, fieldKey)

  const value = props.modelValue[langCode]?.[fieldKey] || ''
  const field = props.fields.find(f => f.key === fieldKey)

  if (!field) return

  const fieldErrors = []

  // Validation obligatoire
  if (field.required && isRequired(langCode) && !value.trim()) {
    fieldErrors.push(`${field.label} est requis en ${supportedLanguages.value.find(l => l.code === langCode)?.name}`)
  }

  // Validation longueur max
  if (field.maxLength && value.length > field.maxLength) {
    fieldErrors.push(`Maximum ${field.maxLength} caractères`)
  }

  // Validation personnalisée
  if (props.validationRules[fieldKey]) {
    const customError = props.validationRules[fieldKey](value, langCode)
    if (customError) {
      fieldErrors.push(customError)
    }
  }

  // Mettre à jour les erreurs
  if (!errors.value[langCode]) {
    errors.value[langCode] = {}
  }

  if (fieldErrors.length > 0) {
    errors.value[langCode][fieldKey] = fieldErrors[0]
  } else {
    delete errors.value[langCode][fieldKey]
  }

  // Émettre les changements de validation
  emitValidationChange()
}

const getFieldError = (langCode: string, fieldKey: string): string | null => {
  // Ne retourner l'erreur que si le champ a été touché
  const isTouched = touchedFields.value[langCode]?.[fieldKey] || false
  return isTouched ? errors.value[langCode]?.[fieldKey] || null : null
}

const hasLanguageErrors = (langCode: string): boolean => {
  const langErrors = errors.value[langCode] || {}
  const langTouched = touchedFields.value[langCode] || {}

  // Vérifier s'il y a des erreurs pour les champs qui ont été touchés
  return Object.keys(langErrors).some(fieldKey => langTouched[fieldKey])
}

const isLanguageComplete = (langCode: string): boolean => {
  if (hasLanguageErrors(langCode)) return false

  const requiredFields = props.fields.filter(f => f.required)
  return requiredFields.every(field => {
    const value = props.modelValue[langCode]?.[field.key] || ''
    // For required field completion, we only consider it complete if it has content
    // But we should also consider if the field has been touched to show the complete status properly
    return value.trim().length > 0
  })
}

const hasAnyContent = (langCode: string): boolean => {
  return props.fields.some(field => {
    const value = props.modelValue[langCode]?.[field.key] || ''
    return value.trim().length > 0
  })
}

const getLanguageStatus = (langCode: string): string => {
  if (hasLanguageErrors(langCode)) return 'Erreurs présentes'
  if (isLanguageComplete(langCode)) return 'Complète'
  return 'Requise - Incomplète'
}

const copyFromFrench = (targetLangCode: string) => {
  if (!props.modelValue.fr) return
  
  const newValue = { ...props.modelValue }
  if (!newValue[targetLangCode]) {
    newValue[targetLangCode] = {}
  }
  
  props.fields.forEach(field => {
    const frenchValue = props.modelValue.fr[field.key] || ''
    if (frenchValue.trim()) {
      newValue[targetLangCode][field.key] = frenchValue
    }
  })
  
  emit('update:modelValue', newValue)
  nextTick(() => {
    // Re-valider après copie
    props.fields.forEach(field => {
      validateField(targetLangCode, field.key)
    })
  })
}

const clearLanguage = (langCode: string) => {
  const newValue = { ...props.modelValue }
  if (newValue[langCode]) {
    props.fields.forEach(field => {
      newValue[langCode][field.key] = ''
    })
  }
  
  emit('update:modelValue', newValue)
  
  // Nettoyer les erreurs
  if (errors.value[langCode]) {
    errors.value[langCode] = {}
  }
  emitValidationChange()
}

// Fonction pour mettre à jour les champs généraux
const updateGeneralField = (fieldKey: string, value: any) => {
  const newGeneralValues = { ...(props.generalValues || {}), [fieldKey]: value }
  emit('update:generalValues', newGeneralValues)
}

const emitValidationChange = () => {
  const flatErrors: Record<string, string[]> = {}

  // Ne considérer que les erreurs pour les champs touchés
  const isValid = supportedLanguages.value.every(lang => {
    const langCode = lang.code
    const langErrors = errors.value[langCode] || {}
    const langTouched = touchedFields.value[langCode] || {}

    // Vérifier s'il y a des erreurs pour les champs touchés dans cette langue
    const hasTouchedErrors = Object.keys(langErrors).some(fieldKey => langTouched[fieldKey])

    if (hasTouchedErrors) {
      Object.keys(langErrors).forEach(fieldKey => {
        if (langTouched[fieldKey]) {
          const errorKey = `${langCode}_${fieldKey}`
          flatErrors[errorKey] = [langErrors[fieldKey]]
        }
      })
    }

    return !hasTouchedErrors
  })

  emit('validation-change', isValid, flatErrors)
}

// Validation initiale (sans marquer comme touché pour éviter les erreurs prématurées)
onMounted(() => {
  nextTick(() => {
    supportedLanguages.value.forEach(lang => {
      props.fields.forEach(field => {
        // On fait la validation initiale mais sans marquer les champs comme touchés
        const langCode = lang.code
        const fieldKey = field.key
        const value = props.modelValue[langCode]?.[fieldKey] || ''

        const fieldErrors = []

        // Validation obligatoire
        if (field.required && isRequired(langCode) && !value.trim()) {
          fieldErrors.push(`${field.label} est requis en ${supportedLanguages.value.find(l => l.code === langCode)?.name}`)
        }

        // Validation longueur max
        if (field.maxLength && value.length > field.maxLength) {
          fieldErrors.push(`Maximum ${field.maxLength} caractères`)
        }

        // Validation personnalisée
        if (props.validationRules[fieldKey]) {
          const customError = props.validationRules[fieldKey](value, langCode)
          if (customError) {
            fieldErrors.push(customError)
          }
        }

        // Mettre à jour les erreurs (sans marquer comme touché)
        if (!errors.value[langCode]) {
          errors.value[langCode] = {}
        }

        if (fieldErrors.length > 0) {
          errors.value[langCode][fieldKey] = fieldErrors[0]
        } else {
          delete errors.value[langCode][fieldKey]
        }
      })
    })
    // Émettre l'état de validation initial
    emitValidationChange()
  })
})

// Assurer que le model a la bonne structure
watch(() => props.modelValue, (newValue) => {
  const correctedValue = { ...newValue }
  let hasChanges = false

  supportedLanguages.value.forEach(lang => {
    if (!correctedValue[lang.code]) {
      correctedValue[lang.code] = {}
      hasChanges = true
    }

    props.fields.forEach(field => {
      if (!(field.key in correctedValue[lang.code])) {
        correctedValue[lang.code][field.key] = ''
        hasChanges = true
      }
    })
  })

  if (hasChanges) {
    // Ne pas émettre l'événement si la structure est déjà correcte
    // pour éviter de réinitialiser les valeurs de validation
    emit('update:modelValue', correctedValue)
  }
}, { immediate: true, deep: true })
</script>

<style scoped>
/* Animation pour les onglets */
button[class*="border-b-2"] {
  transform: translateY(1px);
}

/* Scrollbar personnalisé */
.overflow-y-auto::-webkit-scrollbar {
  width: 6px;
}

.overflow-y-auto::-webkit-scrollbar-track {
  background: transparent;
}

.overflow-y-auto::-webkit-scrollbar-thumb {
  background: hsl(var(--border));
  border-radius: 3px;
}

.overflow-y-auto::-webkit-scrollbar-thumb:hover {
  background: hsl(var(--muted-foreground));
}
</style>