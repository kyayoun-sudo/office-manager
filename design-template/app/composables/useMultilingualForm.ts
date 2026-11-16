import { ref, computed, watch, nextTick } from 'vue'

// Types
export interface FormLanguage {
  code: string
  name: string
  flag: string
  required: boolean
}

export interface FormField {
  key: string
  label: string
  type: 'text' | 'textarea' | 'markdown'
  required?: boolean
  maxLength?: number
  minLength?: number
  rows?: number
  showCharCount?: boolean
  description?: string
  placeholder?: Record<string, string>
}

export interface ValidationRule {
  (value: string, lang: string): string | null
}

export interface MultilingualFormConfig {
  fields: FormField[]
  validationRules?: Record<string, ValidationRule>
  initialData?: Record<string, Record<string, string>>
}

export interface MultilingualFormData {
  [langCode: string]: {
    [fieldKey: string]: string
  }
}

// Configuration fixe des 3 langues obligatoires
export const REQUIRED_LANGUAGES: FormLanguage[] = [
  { code: 'fr', name: 'Français', flag: '🇫🇷', required: true },
  { code: 'en', name: 'English', flag: '🇬🇧', required: true },
  { code: 'nl', name: 'Nederlands', flag: '🇳🇱', required: true }
]

// Règles de validation communes
export const COMMON_VALIDATION_RULES = {
  title: (value: string, lang: string): string | null => {
    if (!value.trim()) return null
    if (value.trim().length < 3) return 'Le titre doit contenir au moins 3 caractères'
    if (value.trim().length > 200) return 'Le titre ne peut pas dépasser 200 caractères'
    return null
  },
  
  content: (value: string, lang: string): string | null => {
    if (!value.trim()) return null
    if (value.trim().length < 10) return 'Le contenu doit contenir au moins 10 caractères'
    if (value.trim().length > 5000) return 'Le contenu ne peut pas dépasser 5000 caractères'
    return null
  },
  
  summary: (value: string, lang: string): string | null => {
    if (!value.trim()) return null
    if (value.trim().length < 5) return 'Le résumé doit contenir au moins 5 caractères'
    if (value.trim().length > 500) return 'Le résumé ne peut pas dépasser 500 caractères'
    return null
  },
  
  description: (value: string, lang: string): string | null => {
    if (!value.trim()) return null
    if (value.trim().length < 10) return 'La description doit contenir au moins 10 caractères'
    if (value.trim().length > 1000) return 'La description ne peut pas dépasser 1000 caractères'
    return null
  },
  
  name: (value: string, lang: string): string | null => {
    if (!value.trim()) return null
    if (value.trim().length < 2) return 'Le nom doit contenir au moins 2 caractères'
    if (value.trim().length > 100) return 'Le nom ne peut pas dépasser 100 caractères'
    return null
  },

  body: (value: string, lang: string): string | null => {
    if (!value.trim()) return null
    if (value.trim().length < 5) return 'Le message doit contenir au moins 5 caractères'
    if (value.trim().length > 500) return 'Le message ne peut pas dépasser 500 caractères'
    return null
  }
}

export function useMultilingualForm(config: MultilingualFormConfig) {
  const {
    fields,
    validationRules = {},
    initialData = {}
  } = config

  // État réactif
  const formData = ref<MultilingualFormData>(initializeFormData())
  const errors = ref<Record<string, Record<string, string>>>({})
  const isValid = ref(false)

  // Initialisation des données
  function initializeFormData(): MultilingualFormData {
    const data: MultilingualFormData = {}
    
    REQUIRED_LANGUAGES.forEach(lang => {
      data[lang.code] = {}
      fields.forEach(field => {
        data[lang.code][field.key] = initialData[lang.code]?.[field.key] || ''
      })
    })
    
    return data
  }

  // Validation
  function validateField(langCode: string, fieldKey: string): string | null {
    const value = formData.value[langCode]?.[fieldKey] || ''
    const field = fields.find(f => f.key === fieldKey)
    const lang = REQUIRED_LANGUAGES.find(l => l.code === langCode)
    
    if (!field || !lang) return null

    // Validation obligatoire - toutes les langues sont requises
    if (field.required && !value.trim()) {
      return `${field.label} est requis en ${lang.name}`
    }

    // Validation longueur min
    if (field.minLength && value.length > 0 && value.length < field.minLength) {
      return `Minimum ${field.minLength} caractères`
    }

    // Validation longueur max
    if (field.maxLength && value.length > field.maxLength) {
      return `Maximum ${field.maxLength} caractères`
    }

    // Validation personnalisée
    if (validationRules[fieldKey]) {
      return validationRules[fieldKey](value, langCode)
    }

    return null
  }

  function validateAllFields(): boolean {
    const newErrors: Record<string, Record<string, string>> = {}
    let hasErrors = false

    REQUIRED_LANGUAGES.forEach(lang => {
      newErrors[lang.code] = {}
      
      fields.forEach(field => {
        const error = validateField(lang.code, field.key)
        if (error) {
          newErrors[lang.code][field.key] = error
          hasErrors = true
        }
      })
    })

    errors.value = newErrors
    isValid.value = !hasErrors
    return !hasErrors
  }

  // Computed properties
  const validationSummary = computed(() => {
    const summary: Record<string, { isComplete: boolean; hasErrors: boolean; status: string }> = {}
    
    REQUIRED_LANGUAGES.forEach(lang => {
      const langErrors = errors.value[lang.code] || {}
      const hasErrors = Object.keys(langErrors).length > 0
      
      const requiredFields = fields.filter(f => f.required)
      const isComplete = requiredFields.every(field => {
        const value = formData.value[lang.code]?.[field.key] || ''
        return value.trim().length > 0
      })

      let status = 'Incomplète'
      if (hasErrors) status = 'Erreurs présentes'
      else if (isComplete) status = 'Complète'
      else status = 'Requise - Incomplète'

      summary[lang.code] = {
        isComplete,
        hasErrors,
        status
      }
    })
    
    return summary
  })

  // Actions
  function updateField(langCode: string, fieldKey: string, value: string) {
    if (!formData.value[langCode]) {
      formData.value[langCode] = {}
    }
    formData.value[langCode][fieldKey] = value
    
    // Valider le champ modifié
    nextTick(() => {
      const error = validateField(langCode, fieldKey)
      if (!errors.value[langCode]) {
        errors.value[langCode] = {}
      }
      
      if (error) {
        errors.value[langCode][fieldKey] = error
      } else {
        delete errors.value[langCode][fieldKey]
      }
      
      // Mettre à jour la validité globale
      validateAllFields()
    })
  }

  function copyFromFrench(targetLangCode: string) {
    if (!formData.value.fr || targetLangCode === 'fr') return
    
    if (!formData.value[targetLangCode]) {
      formData.value[targetLangCode] = {}
    }
    
    fields.forEach(field => {
      const frenchValue = formData.value.fr[field.key] || ''
      if (frenchValue.trim()) {
        formData.value[targetLangCode][field.key] = frenchValue
      }
    })
    
    // Re-valider après copie
    nextTick(() => {
      fields.forEach(field => {
        const error = validateField(targetLangCode, field.key)
        if (!errors.value[targetLangCode]) {
          errors.value[targetLangCode] = {}
        }
        
        if (error) {
          errors.value[targetLangCode][field.key] = error
        } else {
          delete errors.value[targetLangCode][field.key]
        }
      })
      validateAllFields()
    })
  }

  function clearLanguage(langCode: string) {
    if (!formData.value[langCode]) return
    
    fields.forEach(field => {
      formData.value[langCode][field.key] = ''
    })
    
    // Nettoyer les erreurs
    errors.value[langCode] = {}
    validateAllFields()
  }

  function resetForm(newInitialData?: Record<string, Record<string, string>>) {
    const dataToUse = newInitialData || initialData
    
    REQUIRED_LANGUAGES.forEach(lang => {
      formData.value[lang.code] = {}
      fields.forEach(field => {
        formData.value[lang.code][field.key] = dataToUse[lang.code]?.[field.key] || ''
      })
    })
    
    errors.value = {}
    validateAllFields()
  }

  // Transformation pour API
  function toApiFormat(): Record<string, any> {
    const result: Record<string, any> = {}
    
    REQUIRED_LANGUAGES.forEach(lang => {
      const langData: Record<string, string> = {}
      fields.forEach(field => {
        langData[field.key] = formData.value[lang.code]?.[field.key] || ''
      })
      result[lang.code] = langData
    })
    
    return result
  }

  function toTranslationArray() {
    return REQUIRED_LANGUAGES.map(lang => {
      const translation: Record<string, any> = { languageCode: lang.code }
      fields.forEach(field => {
        translation[field.key] = formData.value[lang.code]?.[field.key] || ''
      })
      return translation
    })
  }

  // Chargement de données depuis l'API
  function fromApiFormat(apiData: Record<string, any>) {
    REQUIRED_LANGUAGES.forEach(lang => {
      if (apiData[lang.code]) {
        if (!formData.value[lang.code]) {
          formData.value[lang.code] = {}
        }
        fields.forEach(field => {
          formData.value[lang.code][field.key] = apiData[lang.code][field.key] || ''
        })
      }
    })
    validateAllFields()
  }

  function fromTranslationArray(translations: Array<Record<string, any>>) {
    translations.forEach(translation => {
      const langCode = translation.languageCode
      const lang = REQUIRED_LANGUAGES.find(l => l.code === langCode)
      
      if (lang) {
        if (!formData.value[langCode]) {
          formData.value[langCode] = {}
        }
        fields.forEach(field => {
          formData.value[langCode][field.key] = translation[field.key] || ''
        })
      }
    })
    validateAllFields()
  }

  // Validation initiale
  watch(() => formData.value, () => {
    validateAllFields()
  }, { deep: true, immediate: true })

  return {
    // État
    formData: readonly(formData),
    errors: readonly(errors),
    isValid: readonly(isValid),
    
    // Configuration
    languages: REQUIRED_LANGUAGES,
    fields,
    
    // Computed
    validationSummary,
    
    // Actions
    updateField,
    validateField,
    validateAllFields,
    copyFromFrench,
    clearLanguage,
    resetForm,
    
    // Transformation
    toApiFormat,
    toTranslationArray,
    fromApiFormat,
    fromTranslationArray
  }
}

// Helpers pour créer des configurations de champs communes
export function createBasicFields(): FormField[] {
  return [
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
      type: 'textarea',
      required: true,
      maxLength: 5000,
      minLength: 10,
      rows: 5,
      showCharCount: true
    }
  ]
}

export function createAnnouncementFields(): FormField[] {
  return [
    {
      key: 'title',
      label: 'Titre',
      type: 'text',
      required: true,
      maxLength: 200,
      minLength: 5,
      showCharCount: true
    },
    {
      key: 'summary',
      label: 'Résumé',
      type: 'text',
      required: true,
      maxLength: 500,
      minLength: 3,
      showCharCount: true
    },
    {
      key: 'content',
      label: 'Contenu',
      type: 'textarea',
      required: true,
      maxLength: 5000,
      minLength: 10,
      rows: 6,
      showCharCount: true
    }
  ]
}

export function createSpecialtyFields(): FormField[] {
  return [
    {
      key: 'name',
      label: 'Nom',
      type: 'text',
      required: true,
      maxLength: 100,
      minLength: 2,
      showCharCount: true
    },
    {
      key: 'description',
      label: 'Description',
      type: 'textarea',
      required: false,
      maxLength: 1000,
      minLength: 10,
      rows: 4,
      showCharCount: true,
      description: 'Description détaillée de la spécialité'
    }
  ]
}

export function createNotificationFields(): FormField[] {
  return [
    {
      key: 'title',
      label: 'Titre',
      type: 'text',
      required: true,
      maxLength: 100,
      minLength: 3,
      showCharCount: true
    },
    {
      key: 'body',
      label: 'Message',
      type: 'textarea',
      required: true,
      maxLength: 500,
      minLength: 5,
      rows: 3,
      showCharCount: true
    }
  ]
}

// Helper pour créer des champs généraux
export interface GeneralField {
  key: string
  label: string
  type: 'text' | 'textarea' | 'select'
  required?: boolean
  maxLength?: number
  placeholder?: string
  options?: Array<{value: string | number | boolean, label: string}>
  loading?: boolean
  description?: string
}

export function createSpecialtyGeneralFields(): GeneralField[] {
  return [
    {
      key: 'code',
      label: 'Code',
      type: 'text',
      required: true,
      placeholder: 'Code unique (ex: consultation_prenatale)'
    },
    {
      key: 'category',
      label: 'Categorie',
      type: 'select',
      required: true,
      placeholder: 'Selectionner une categorie',
      options: [],
      loading: false
    },
    {
      key: 'isActive',
      label: 'Statut',
      type: 'select',
      required: true,
      placeholder: 'Selectionner le statut',
      options: [
        { value: 'true', label: 'Actif' },
        { value: 'false', label: 'Inactif' }
      ]
    },
    {
      key: 'isDefault',
      label: 'Par defaut',
      type: 'select',
      required: false,
      placeholder: 'Selectionner',
      options: [
        { value: 'false', label: 'Non' },
        { value: 'true', label: 'Oui' }
      ],
      description: 'Attribuee automatiquement a tous les cliniciens'
    },
    {
      key: 'clinicianSetsAppointmentDate',
      label: 'Planification clinicien',
      type: 'select',
      required: false,
      placeholder: 'Selectionner une option',
      options: [
        { value: 'false', label: 'Non' },
        { value: 'true', label: 'Oui' }
      ],
      description: 'Le clinicien definit la date de rendez-vous'
    }
  ]
}

export function createCategoryFields(): FormField[] {
  return [
    {
      key: 'name',
      label: 'Nom',
      type: 'text',
      required: true,
      maxLength: 100,
      minLength: 2,
      showCharCount: true
    },
    {
      key: 'description',
      label: 'Description',
      type: 'textarea',
      required: false,
      maxLength: 1000,
      minLength: 10,
      rows: 4,
      showCharCount: true,
      description: 'Description detaillee de la categorie'
    }
  ]
}

export function createCityFields(): FormField[] {
  return [
    {
      key: 'name',
      label: 'Nom',
      type: 'text',
      required: true,
      maxLength: 100,
      minLength: 2,
      showCharCount: true
    }
  ]
}

export function createCityGeneralFields(): GeneralField[] {
  return [
    {
      key: 'postalCode',
      label: 'Code postal',
      type: 'text',
      required: true,
      placeholder: 'Ex: 1000'
    },
    {
      key: 'country',
      label: 'Pays',
      type: 'select',
      required: true,
      placeholder: 'Selectionner un pays',
      options: [],
      loading: false
    },
    {
      key: 'isActive',
      label: 'Statut',
      type: 'select',
      required: true,
      placeholder: 'Selectionner le statut',
      options: [
        { value: 'true', label: 'Actif' },
        { value: 'false', label: 'Inactif' }
      ]
    }
  ]
}

export function createBreastfeedingTypeFields(): FormField[] {
  return [
    {
      key: 'name',
      label: 'Nom',
      type: 'text',
      required: true,
      maxLength: 100,
      minLength: 2,
      showCharCount: true
    },
    {
      key: 'description',
      label: 'Description',
      type: 'textarea',
      required: false,
      maxLength: 1000,
      minLength: 10,
      rows: 4,
      showCharCount: true,
      description: 'Description détaillée du type d\'allaitement'
    }
  ]
}

export function createRejectionReasonFields(): FormField[] {
  return [
    {
      key: 'name',
      label: 'Nom',
      type: 'text',
      required: true,
      maxLength: 255,
      minLength: 5,
      showCharCount: true
    },
    {
      key: 'description',
      label: 'Description',
      type: 'textarea',
      required: false,
      maxLength: 1000,
      minLength: 10,
      rows: 3,
      showCharCount: true,
      description: 'Description detaillee du motif de rejet'
    }
  ]
}

export function createRejectionReasonGeneralFields(): GeneralField[] {
  return [
    {
      key: 'code',
      label: 'Code',
      type: 'text',
      required: true,
      placeholder: 'Code unique (ex: invalid_documents)'
    },
    {
      key: 'isActive',
      label: 'Statut',
      type: 'select',
      required: true,
      placeholder: 'Selectionner le statut',
      options: [
        { value: 'true', label: 'Actif' },
        { value: 'false', label: 'Inactif' }
      ]
    }
  ]
}

export function createDeliveryParityFields(): FormField[] {
  return [
    {
      key: 'name',
      label: 'Nom',
      type: 'text',
      required: true,
      maxLength: 255,
      minLength: 2,
      showCharCount: true
    },
    {
      key: 'description',
      label: 'Description',
      type: 'textarea',
      required: false,
      maxLength: 1000,
      minLength: 10,
      rows: 4,
      showCharCount: true,
      description: 'Description du quantieme d\'accouchement'
    }
  ]
}