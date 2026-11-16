<script setup lang="ts">
import type { AdminUser } from '~~~/shared/types/user'
import { Loader2, AlertTriangle } from 'lucide-vue-next'

const props = defineProps<{
  open: boolean
  user: AdminUser | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'rejected': []
}>()

const { rejectClinician } = useUsers()
const { fetchActiveReasons } = useRejectionReasons()
const toast = useToast()

const rejectionReasons = ref<Array<{ id: number; code: string; label: string }>>([])
const isLoadingReasons = ref(false)
const selectedReasonId = ref<string>('')
const customReason = ref('')
const customReasonLang = ref('')
const isSubmitting = ref(false)

const isCustom = computed(() => selectedReasonId.value === 'custom')

const clinicianName = computed(() => {
  if (!props.user) return ''
  return `${props.user.firstName} ${props.user.lastName}`
})

const clinicianLanguages = computed(() => {
  const langs = props.user?.clinician?.languages || props.user?.preferredLanguages || []
  return langs.length > 0 ? langs : ['fr']
})

const languageLabels: Record<string, string> = {
  fr: 'Français',
  en: 'English',
  nl: 'Nederlands',
}

const canSubmit = computed(() => {
  if (!selectedReasonId.value) return false
  if (isCustom.value) {
    return customReason.value.trim().length >= 10 && !!customReasonLang.value
  }
  return true
})

const loadReasons = async () => {
  isLoadingReasons.value = true
  rejectionReasons.value = await fetchActiveReasons()
  isLoadingReasons.value = false
}

const onSubmit = async () => {
  if (!props.user?.clinician?.id || !canSubmit.value) return

  isSubmitting.value = true

  const payload = isCustom.value
    ? { reason: customReason.value.trim(), reasonLang: customReasonLang.value }
    : { rejectionReasonId: Number(selectedReasonId.value) }

  const result = await rejectClinician(props.user.clinician.id, payload)
  isSubmitting.value = false

  if (result.success) {
    toast.handleApiSuccess(`${clinicianName.value} a été rejetée`)
    emit('rejected')
    handleClose()
  } else {
    toast.handleApiError({ success: false, message: result.error || 'Erreur lors du rejet' })
  }
}

const handleClose = () => {
  if (isSubmitting.value) return
  emit('update:open', false)
  resetForm()
}

const resetForm = () => {
  selectedReasonId.value = ''
  customReason.value = ''
  customReasonLang.value = ''
}

watch(() => props.open, (newOpen) => {
  if (newOpen) {
    loadReasons()
  } else {
    resetForm()
  }
})
</script>

<template>
  <UiDialog :open="open" @update:open="handleClose">
    <UiDialogContent class="sm:max-w-lg">
      <UiDialogHeader>
        <UiDialogTitle>Rejeter la sage-femme</UiDialogTitle>
        <UiDialogDescription>
          Sélectionnez le motif du rejet pour <strong>{{ clinicianName }}</strong>.
        </UiDialogDescription>
      </UiDialogHeader>

      <div class="space-y-4">
        <div class="rounded-lg border border-orange-200 bg-orange-50 p-3 dark:border-orange-900 dark:bg-orange-950">
          <div class="flex items-start gap-2">
            <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
            <p class="text-sm text-orange-800 dark:text-orange-200">
              La sage-femme recevra une notification et un email avec le motif du rejet,
              traduit dans sa langue d'inscription.
            </p>
          </div>
        </div>

        <div v-if="isLoadingReasons" class="flex items-center justify-center py-6">
          <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
        </div>

        <div v-else class="space-y-2">
          <UiLabel>Motif du rejet *</UiLabel>
          <UiRadioGroup v-model="selectedReasonId" class="space-y-2">
            <div
              v-for="reason in rejectionReasons" :key="reason.id"
              class="flex items-start space-x-3 rounded-lg border p-3 transition-colors"
              :class="selectedReasonId === String(reason.id) ? 'border-primary bg-primary/5' : 'border-border'"
            >
              <UiRadioGroupItem
                :id="`reason-${reason.id}`"
                :value="String(reason.id)" class="mt-0.5"
              />
              <UiLabel
                :for="`reason-${reason.id}`"
                class="cursor-pointer text-sm font-normal leading-relaxed"
              >
                {{ reason.label }}
              </UiLabel>
            </div>

            <div
              class="flex items-start space-x-3 rounded-lg border p-3 transition-colors"
              :class="isCustom ? 'border-primary bg-primary/5' : 'border-border'"
            >
              <UiRadioGroupItem id="custom" value="custom" class="mt-0.5" />
              <UiLabel for="custom" class="cursor-pointer text-sm font-medium">
                Autre (motif personnalisé)
              </UiLabel>
            </div>
          </UiRadioGroup>
        </div>

        <template v-if="isCustom">
          <div class="space-y-2">
            <UiLabel>
              Langue du motif *
              <span class="text-xs text-muted-foreground ml-1">
                (langues de la sage-femme)
              </span>
            </UiLabel>
            <UiRadioGroup v-model="customReasonLang" class="flex gap-3">
              <div
                v-for="lang in clinicianLanguages" :key="lang"
                class="flex items-center space-x-2"
              >
                <UiRadioGroupItem :id="`lang-${lang}`" :value="lang" />
                <UiLabel :for="`lang-${lang}`" class="cursor-pointer text-sm font-normal">
                  {{ languageLabels[lang] || lang.toUpperCase() }}
                </UiLabel>
              </div>
            </UiRadioGroup>
          </div>

          <div class="space-y-2">
            <UiLabel for="custom-reason">
              Motif personnalisé *
              <span v-if="customReasonLang" class="text-xs text-muted-foreground ml-1">
                (rédigez en {{ languageLabels[customReasonLang] || customReasonLang }})
              </span>
            </UiLabel>
            <UiTextarea
              id="custom-reason"
              v-model="customReason"
              :placeholder="customReasonLang
                ? `Rédigez le motif en ${languageLabels[customReasonLang] || customReasonLang}... (minimum 10 caractères)`
                : 'Sélectionnez d\'abord la langue...'"
              :rows="4"
              :disabled="!customReasonLang"
              :class="{ 'border-destructive': customReason.length > 0 && customReason.length < 10 }"
            />
            <p v-if="customReason.length > 0 && customReason.length < 10" class="text-xs text-destructive">
              Le motif doit contenir au moins 10 caractères ({{ customReason.length }}/10)
            </p>
          </div>
        </template>
      </div>

      <UiDialogFooter>
        <UiButton
          type="button" variant="outline"
          :disabled="isSubmitting"
          @click="handleClose"
        >
          Annuler
        </UiButton>
        <UiButton
          variant="destructive"
          :disabled="isSubmitting || !canSubmit"
          @click="onSubmit"
        >
          <Loader2 v-if="isSubmitting" class="mr-2 h-4 w-4 animate-spin" />
          Rejeter
        </UiButton>
      </UiDialogFooter>
    </UiDialogContent>
  </UiDialog>
</template>
