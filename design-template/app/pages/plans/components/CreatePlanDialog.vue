<script setup lang="ts">
import type { Plan, CreatePlanRequest, CreatePlanTranslationData } from '~~/shared/types/subscription-plan'

interface Props {
  open: boolean
  plans: Plan[]
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  'success': []
}>()

const { createPlan } = usePlans()
const toast = useToast()

const NUMERIC_FIELDS = new Set(['price', 'promotionalPrice', 'promotionalDurationMonths', 'vatRate', 'trialPeriodDays', 'displayOrder'])

const generalFields = [
  { key: 'price', label: 'Prix', type: 'text' as const, required: true, placeholder: '0.00' },
  { key: 'promotionalPrice', label: 'Prix promotionnel', type: 'text' as const, required: false, placeholder: '0.00', description: 'Prix réduit pendant la période promotionnelle' },
  { key: 'promotionalDurationMonths', label: 'Durée promotionnelle (mois)', type: 'text' as const, required: false, placeholder: '0', description: 'Nombre de mois à ce prix promotionnel' },
  { key: 'vatRate', label: 'Taux de TVA (%)', type: 'text' as const, required: false, placeholder: '21', description: 'Taux de TVA applicable au plan' },
  { key: 'currency', label: 'Devise', type: 'select' as const, required: true, options: [{ value: 'EUR', label: 'EUR (Euro)' }, { value: 'USD', label: 'USD (Dollar)' }, { value: 'GBP', label: 'GBP (Livre)' }] },
  { key: 'trialPeriodDays', label: "Période d'essai (jours)", type: 'text' as const, required: false, placeholder: '0' },
  { key: 'billingInterval', label: 'Période de facturation', type: 'select' as const, required: true, options: [{ value: 'day', label: 'Journalier' }, { value: 'week', label: 'Hebdomadaire' }, { value: 'month', label: 'Mensuel' }, { value: 'quarter', label: 'Trimestriel' }, { value: 'semester', label: 'Semestriel' }, { value: 'year', label: 'Annuel' }] },
  { key: 'displayOrder', label: "Ordre d'affichage", type: 'text' as const, required: false, placeholder: '0' },
  { key: 'createInStripe', label: 'Intégration Stripe', type: 'switch' as const, required: false, switchLabel: 'Créer automatiquement dans Stripe (RECOMMANDÉ)' },
]

const translationFormFields = [
  { key: 'name', label: 'Nom du plan', type: 'text' as const, required: true, maxLength: 100 },
  { key: 'description', label: 'Description', type: 'textarea' as const, required: true, maxLength: 500, rows: 3 },
]

const defaultForm = (): CreatePlanRequest => ({
  code: '', price: 0, promotionalPrice: undefined, promotionalDurationMonths: undefined,
  vatRate: undefined, currency: 'EUR', billingInterval: 'month', trialPeriodDays: 0,
  isActive: true, displayOrder: 1, createInStripe: true, translations: [],
})

const defaultTranslations = () => ({
  fr: { name: '', description: '' },
  en: { name: '', description: '' },
  nl: { name: '', description: '' },
})

const createForm = ref<CreatePlanRequest>(defaultForm())
const translationValues = ref<Record<string, Record<string, string>>>(defaultTranslations())
const codeManuallyEdited = ref(false)

const generatePlanCode = (name: string): string => {
  if (!name) return ''
  return name.toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase()
}

const generateUniquePlanCode = (name: string): string => {
  const baseCode = generatePlanCode(name)
  if (!baseCode) return ''
  let uniqueCode = baseCode
  let suffix = 1
  while (props.plans.some(p => p.code.toLowerCase() === uniqueCode.toLowerCase())) {
    uniqueCode = `${baseCode}-${suffix}`
    suffix++
  }
  return uniqueCode
}

const updateGeneralValues = (newValues: Record<string, any>) => {
  for (const [key, value] of Object.entries(newValues)) {
    ;(createForm.value as any)[key] = NUMERIC_FIELDS.has(key)
      ? (value !== undefined && value !== '' ? Number(value) : undefined)
      : value
  }
}

const buildTranslationsData = (): CreatePlanTranslationData[] => {
  const result: CreatePlanTranslationData[] = []
  for (const [langCode, fields] of Object.entries(translationValues.value)) {
    if (fields.name.trim()) {
      result.push({ languageCode: langCode, name: fields.name.trim(), description: fields.description.trim() })
    }
  }
  return result
}

const resetForm = () => {
  createForm.value = defaultForm()
  translationValues.value = defaultTranslations()
  codeManuallyEdited.value = false
}

const handleSubmit = async () => {
  try {
    createForm.value.translations = buildTranslationsData()
    const success = await createPlan(createForm.value)
    if (success) {
      toast.handleApiSuccess('Plan créé avec succès.')
      emit('update:open', false)
      emit('success')
      resetForm()
    } else {
      toast.handleApiError({ success: false, error: 'Impossible de créer le plan' }, 'Erreur')
    }
  } catch (err: any) {
    toast.handleApiError({ success: false, error: err.message }, 'Erreur')
  }
}

const handleCancel = () => {
  emit('update:open', false)
  resetForm()
}

watch(() => translationValues.value.fr.name, (newName) => {
  if (props.open && newName && !codeManuallyEdited.value) {
    const generatedCode = generateUniquePlanCode(newName)
    if (generatedCode) createForm.value.code = generatedCode
  }
})
</script>

<template>
  <UiDialog :open="open" @update:open="$emit('update:open', $event)">
    <UiDialogContent class="max-w-4xl max-h-[90vh] overflow-y-auto">
      <UiDialogHeader>
        <UiDialogTitle>Nouveau Plan d'Abonnement</UiDialogTitle>
        <UiDialogDescription>
          Créez un nouveau plan avec traductions et intégration Stripe
        </UiDialogDescription>
      </UiDialogHeader>

      <div class="space-y-6">
        <MultilingualFormFields
          v-model="translationValues"
          :general-fields="generalFields"
          :general-values="createForm"
          :fields="translationFormFields"
          title="Traductions des plans d'abonnement"
          :disabled="false"
          @update:general-values="updateGeneralValues"
        />
      </div>

      <UiDialogFooter>
        <UiButton variant="outline" @click="handleCancel">Annuler</UiButton>
        <UiButton @click="handleSubmit">Créer le Plan</UiButton>
      </UiDialogFooter>
    </UiDialogContent>
  </UiDialog>
</template>
