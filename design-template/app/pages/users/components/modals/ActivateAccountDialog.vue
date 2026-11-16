<script setup lang="ts">
import { Loader2, KeyRound } from 'lucide-vue-next'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { z } from 'zod'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'activated': []
}>()

const { activateAccount } = useUsers()
const toast = useToast()

const schema = toTypedSchema(
  z.object({
    code: z.string().length(32, 'Le code doit contenir exactement 32 caractères'),
  }),
)

const { handleSubmit, resetForm, errors, defineField, meta } = useForm({
  validationSchema: schema,
})

const [code, codeAttrs] = defineField('code')
const isSubmitting = ref(false)

const onSubmit = handleSubmit(async (values) => {
  isSubmitting.value = true
  const result = await activateAccount(values.code)
  isSubmitting.value = false

  if (result.success) {
    toast.handleApiSuccess(result.message || 'Compte activé avec succès')
    emit('activated')
    handleClose()
  } else {
    toast.handleApiError({ success: false, message: result.error || "Erreur lors de l'activation" })
  }
})

const handleClose = () => {
  if (isSubmitting.value) return
  emit('update:open', false)
  resetForm()
}

watch(() => props.open, (newOpen) => {
  if (!newOpen) resetForm()
})
</script>

<template>
  <UiDialog :open="open" @update:open="handleClose">
    <UiDialogContent class="sm:max-w-md">
      <UiDialogHeader>
        <UiDialogTitle>Activer un compte</UiDialogTitle>
        <UiDialogDescription>
          Entrez le code d'activation à 32 caractères pour confirmer le compte utilisateur.
        </UiDialogDescription>
      </UiDialogHeader>

      <form class="space-y-4" @submit.prevent="onSubmit">
        <div class="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950">
          <div class="flex items-start gap-2">
            <KeyRound class="mt-0.5 h-4 w-4 text-blue-600" />
            <p class="text-sm text-blue-800 dark:text-blue-200">
              Le code d'activation est envoyé par email lors de l'inscription. Il est valide pendant 10 minutes.
            </p>
          </div>
        </div>

        <div class="space-y-2">
          <UiLabel for="activation-code">Code d'activation *</UiLabel>
          <UiInput
            id="activation-code"
            v-model="code"
            v-bind="codeAttrs"
            placeholder="Collez le code à 32 caractères..."
            class="font-mono text-sm"
            :class="{ 'border-destructive': errors.code }"
          />
          <p v-if="errors.code" class="text-xs text-destructive">{{ errors.code }}</p>
          <p v-else class="text-xs text-muted-foreground">{{ (code || '').length }}/32 caractères</p>
        </div>

        <UiDialogFooter>
          <UiButton
            type="button"
            variant="outline"
            :disabled="isSubmitting"
            @click="handleClose"
          >
            Annuler
          </UiButton>
          <UiButton
            type="submit"
            :disabled="isSubmitting || !meta.valid"
          >
            <Loader2 v-if="isSubmitting" class="mr-2 h-4 w-4 animate-spin" />
            Activer le compte
          </UiButton>
        </UiDialogFooter>
      </form>
    </UiDialogContent>
  </UiDialog>
</template>
