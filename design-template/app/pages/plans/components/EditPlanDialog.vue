<script setup lang="ts">
import type { Plan, UpdatePlanRequest, CreatePlanTranslationData } from '~~/shared/types/subscription-plan'

interface Props {
  open: boolean
  plan: Plan | null
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  'success': []
}>()

const { updatePlan } = usePlans()
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
]

const translationFormFields = [
  { key: 'name', label: 'Nom du plan', type: 'text' as const, required: true, maxLength: 100 },
  { key: 'description', label: 'Description', type: 'textarea' as const, required: true, maxLength: 500, rows: 3 },
]

const editForm = ref<UpdatePlanRequest>({})
const translationValues = ref<Record<string, Record<string, string>>>({
  fr: { name: '', description: '' },
  en: { name: '', description: '' },
  nl: { name: '', description: '' },
})

const updateGeneralValues = (newValues: Record<string, any>) => {
  for (const [key, value] of Object.entries(newValues)) {
    ;(editForm.value as any)[key] = NUMERIC_FIELDS.has(key)
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

const populateForm = (plan: Plan) => {
  editForm.value = {
    price: parseFloat(plan.price),
    promotionalPrice: plan.promotionalPrice ? parseFloat(plan.promotionalPrice) : undefined,
    promotionalDurationMonths: plan.promotionalDurationMonths,
    vatRate: plan.vatRate,
    currency: plan.currency,
    billingInterval: plan.billingInterval,
    trialPeriodDays: plan.trialPeriodDays,
    isActive: plan.isActive,
    displayOrder: plan.displayOrder,
    translations: [],
  }

  const langs: Record<string, Record<string, string>> = {
    fr: { name: '', description: '' },
    en: { name: '', description: '' },
    nl: { name: '', description: '' },
  }
  plan.translations?.forEach(t => {
    const code = t.language.code
    if (langs[code]) {
      langs[code] = { name: t.name || '', description: t.description || '' }
    }
  })
  translationValues.value = langs
}

const handleSubmit = async () => {
  if (!props.plan) return
  try {
    editForm.value.translations = buildTranslationsData()
    const success = await updatePlan(props.plan.id, editForm.value)
    if (success) {
      toast.handleApiSuccess('Plan mis à jour avec succès.')
      emit('update:open', false)
      emit('success')
    } else {
      toast.handleApiError({ success: false, error: 'Impossible de mettre à jour le plan' }, 'Erreur')
    }
  } catch (err: any) {
    toast.handleApiError({ success: false, error: err.message }, 'Erreur')
  }
}

watch(() => props.plan, (plan) => {
  if (plan) populateForm(plan)
})
</script>

<template>
  <UiDialog :open="open" @update:open="$emit('update:open', $event)">
    <UiDialogContent class="max-w-4xl max-h-[90vh] overflow-y-auto">
      <UiDialogHeader>
        <UiDialogTitle>Modifier le Plan</UiDialogTitle>
        <UiDialogDescription>
          Modifiez les informations du plan et ses traductions
        </UiDialogDescription>
      </UiDialogHeader>

      <div v-if="plan" class="space-y-6">
        <MultilingualFormFields
          v-model="translationValues"
          :general-fields="generalFields"
          :general-values="editForm"
          :fields="translationFormFields"
          title="Traductions des plans d'abonnement"
          :disabled="false"
          @update:general-values="updateGeneralValues"
        />
      </div>

      <UiDialogFooter>
        <UiButton variant="outline" @click="$emit('update:open', false)">Annuler</UiButton>
        <UiButton @click="handleSubmit">Mettre à jour</UiButton>
      </UiDialogFooter>
    </UiDialogContent>
  </UiDialog>
</template>
