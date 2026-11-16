<template>
  <MultilingualFormFields
    v-model="internalValue"
    :fields="computedFields"
    :validation-rules="computedValidationRules"
    :title="title"
    :disabled="disabled"
    :show-validation-summary="showValidationSummary"
    @update:model-value="$emit('update:modelValue', $event)"
    @validation-change="$emit('validation-change', $event.isValid, $event.errors)"
  />
</template>

<script setup lang="ts">
import MultilingualFormFields from './MultilingualFormFields.vue'
import { 
  createNotificationFields, 
  createSpecialtyFields, 
  createAnnouncementFields, 
  createBasicFields,
  COMMON_VALIDATION_RULES,
  type FormField 
} from '~/composables/useMultilingualForm'

interface Props {
  modelValue: Record<string, Record<string, string>>
  preset?: 'notification' | 'specialty' | 'announcement' | 'basic' | 'custom'
  customFields?: FormField[]
  customValidationRules?: Record<string, (value: string, lang: string) => string | null>
  title?: string
  disabled?: boolean
  showValidationSummary?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  preset: 'basic',
  title: 'Traductions multilingues',
  disabled: false,
  showValidationSummary: true
})

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, Record<string, string>>]
  'validation-change': [isValid: boolean, errors: Record<string, string[]>]
}>()

const internalValue = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

// Configuration des champs selon le preset
const computedFields = computed(() => {
  if (props.preset === 'custom') {
    return props.customFields || createBasicFields()
  }
  
  switch (props.preset) {
    case 'notification':
      return createNotificationFields()
    case 'specialty':
      return createSpecialtyFields()
    case 'announcement':
      return createAnnouncementFields()
    case 'basic':
    default:
      return createBasicFields()
  }
})

// Configuration des règles de validation selon le preset
const computedValidationRules = computed(() => {
  if (props.preset === 'custom') {
    return props.customValidationRules || {}
  }
  
  const rules: Record<string, (value: string, lang: string) => string | null> = {}
  
  switch (props.preset) {
    case 'notification':
      rules.title = COMMON_VALIDATION_RULES.title
      rules.body = COMMON_VALIDATION_RULES.body
      break
      
    case 'specialty':
      rules.name = COMMON_VALIDATION_RULES.name
      rules.description = COMMON_VALIDATION_RULES.description
      break
      
    case 'announcement':
      rules.title = COMMON_VALIDATION_RULES.title
      rules.summary = COMMON_VALIDATION_RULES.summary
      rules.content = COMMON_VALIDATION_RULES.content
      break
      
    case 'basic':
    default:
      rules.title = COMMON_VALIDATION_RULES.title
      rules.content = COMMON_VALIDATION_RULES.content
      break
  }
  
  return rules
})
</script>

<script lang="ts">
export default {
  name: 'SimpleMultilingualForm'
}
</script>