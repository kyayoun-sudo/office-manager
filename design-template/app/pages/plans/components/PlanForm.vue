<script setup lang="ts">
import type { Plan, CreatePlanRequest, UpdatePlanRequest, CreatePlanTranslationData } from '~~/shared/types/subscription-plan'
import MultilingualFormFields from '~/components/forms/MultilingualFormFields.vue'

interface Props {
  plan?: Plan | null
  plans?: Plan[]
  isLoading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  plans: () => [],
})

const emit = defineEmits<{
  'submit': [data: CreatePlanRequest | UpdatePlanRequest]
  'cancel': []
}>()

const isEditing = computed(() => !!props.plan)

const NUMERIC_FIELDS = new Set(['price', 'promotionalPrice', 'promotionalDurationMonths', 'vatRate', 'trialPeriodDays', 'displayOrder'])

const generalFields = computed(() => [
  { key: 'price', label: 'Prix', type: 'text' as const, required: true, placeholder: '0.00' },
  { key: 'promotionalPrice', label: 'Prix promotionnel', type: 'text' as const, required: false, placeholder: '0.00', description: 'Prix réduit pendant la période promotionnelle' },
  { key: 'promotionalDurationMonths', label: 'Durée promotionnelle (mois)', type: 'text' as const, required: false, placeholder: '0', description: 'Nombre de mois à ce prix promotionnel' },
  { key: 'vatRate', label: 'Taux de TVA (%)', type: 'text' as const, required: false, placeholder: '21', description: 'Taux de TVA applicable au plan' },
  { key: 'currency', label: 'Devise', type: 'select' as const, required: true, options: [{ value: 'EUR', label: 'EUR (Euro)' }, { value: 'USD', label: 'USD (Dollar)' }, { value: 'GBP', label: 'GBP (Livre)' }] },
  { key: 'trialPeriodDays', label: "Période d'essai (jours)", type: 'text' as const, required: false, placeholder: '0' },
  { key: 'billingInterval', label: 'Période de facturation', type: 'select' as const, required: true, options: [{ value: 'day', label: 'Journalier' }, { value: 'week', label: 'Hebdomadaire' }, { value: 'month', label: 'Mensuel' }, { value: 'quarter', label: 'Trimestriel' }, { value: 'semester', label: 'Semestriel' }, { value: 'year', label: 'Annuel' }] },
  ...(!isEditing.value ? [{ key: 'createInStripe', label: 'Intégration Stripe', type: 'switch' as const, required: false, switchLabel: 'Créer automatiquement dans Stripe (RECOMMANDÉ)' }] : []),
])

const translationFormFields = [
  { key: 'name', label: 'Nom du plan', type: 'text' as const, required: true, maxLength: 100 },
  { key: 'description', label: 'Description', type: 'textarea' as const, required: true, maxLength: 500, rows: 3 },
]

const formData = ref<Record<string, any>>({
  code: '', price: 0, promotionalPrice: undefined, promotionalDurationMonths: undefined,
  vatRate: undefined, currency: 'EUR', billingInterval: 'month', trialPeriodDays: 0,
  isActive: true, displayOrder: 1, createInStripe: true,
})

const translationValues = ref<Record<string, Record<string, string>>>({
  fr: { name: '', description: '' },
  en: { name: '', description: '' },
  nl: { name: '', description: '' },
})

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
    formData.value[key] = NUMERIC_FIELDS.has(key)
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

const handleSubmit = () => {
  const translations = buildTranslationsData()
  const data = { ...formData.value, translations }
  emit('submit', data)
}

const populateForm = (plan: Plan) => {
  formData.value = {
    code: plan.code,
    price: parseFloat(plan.price),
    promotionalPrice: plan.promotionalPrice ? parseFloat(plan.promotionalPrice) : undefined,
    promotionalDurationMonths: plan.promotionalDurationMonths,
    vatRate: plan.vatRate,
    currency: plan.currency,
    billingInterval: plan.billingInterval,
    trialPeriodDays: plan.trialPeriodDays,
    isActive: plan.isActive,
    displayOrder: plan.displayOrder,
  }

  const langs: Record<string, Record<string, string>> = {
    fr: { name: '', description: '' },
    en: { name: '', description: '' },
    nl: { name: '', description: '' },
  }
  plan.translations?.forEach((t) => {
    const code = t.language.code
    if (langs[code]) {
      langs[code] = { name: t.name || '', description: t.description || '' }
    }
  })
  translationValues.value = langs
}

watch(() => props.plan, (plan) => {
  if (plan) populateForm(plan)
}, { immediate: true })

watch(() => translationValues.value.fr?.name, (newName) => {
  if (!isEditing.value && newName && !codeManuallyEdited.value) {
    const generatedCode = generateUniquePlanCode(newName)
    if (generatedCode) formData.value.code = generatedCode
  }
})
</script>

<template>
  <form class="space-y-6" @submit.prevent="handleSubmit">
    <MultilingualFormFields
      v-model="translationValues"
      :general-fields="generalFields"
      :general-values="formData"
      :fields="translationFormFields"
      title="Traductions du plan d'abonnement"
      :disabled="isLoading"
      @update:general-values="updateGeneralValues"
    />

    <div class="flex justify-end gap-3 pt-4 border-t">
      <UiButton type="button" variant="outline" :disabled="isLoading" @click="emit('cancel')">
        Annuler
      </UiButton>
      <UiButton type="submit" :disabled="isLoading">
        <AppSpinner v-if="isLoading" class="mr-2 h-4 w-4" />
        {{ isEditing ? 'Mettre à jour' : 'Créer le Plan' }}
      </UiButton>
    </div>
  </form>
</template>
