<script setup lang="ts">
import type { AdminUser } from '~~~/shared/types/user'
import type { Midwife } from '~~~/shared/types/midwife'
import { Loader2 } from 'lucide-vue-next'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm, useField } from 'vee-validate'
import { z } from 'zod'

const props = defineProps<{
  open: boolean
  user: AdminUser | null
  clinicianDetails: Midwife | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'updated': []
}>()

const { handleApiResponse } = useApiResponse()
const toast = useToast()
const isSubmitting = ref(false)

const schema = toTypedSchema(z.object({
  inamiNumber: z.string(),
  bio: z.string().max(1000, 'La biographie ne peut pas depasser 1000 caracteres'),
  appliesConventionalRates: z.boolean(),
  travelFees: z.string(),
}))

const { handleSubmit, errors, resetForm, setValues } = useForm({ validationSchema: schema })

const { value: inamiNumber } = useField<string>('inamiNumber')
const { value: bio } = useField<string>('bio')
const { value: appliesConventionalRates } = useField<boolean>('appliesConventionalRates')
const { value: travelFees } = useField<string>('travelFees')

const handleClose = () => {
  if (isSubmitting.value) return
  emit('update:open', false)
}

const onSubmit = handleSubmit(async (values) => {
  if (!props.user) return
  isSubmitting.value = true

  const payload: Record<string, any> = {
    appliesConventionalRates: values.appliesConventionalRates,
  }
  if (values.inamiNumber) payload.inamiNumber = values.inamiNumber
  if (values.bio) payload.bio = values.bio
  if (values.travelFees) {
    const fees = parseFloat(values.travelFees)
    if (!isNaN(fees) && fees >= 0) payload.travelFees = fees
  }

  const response = await api.patch<any>(`/users/${props.user.id}`, payload)
  const { success } = handleApiResponse(response)
  isSubmitting.value = false

  if (success) {
    toast.handleApiSuccess('Informations professionnelles mises a jour')
    emit('updated')
    handleClose()
  } else {
    toast.handleApiError({ success: false, message: 'Erreur lors de la mise a jour' })
  }
})

watch(() => props.open, (newOpen) => {
  if (newOpen) {
    const clinician = props.user?.clinician
    const details = props.clinicianDetails
    setValues({
      inamiNumber: clinician?.inamiNumber ?? details?.inamiNumber ?? '',
      bio: clinician?.bio ?? details?.bio ?? '',
      appliesConventionalRates: details?.appliesConventionalRates ?? false,
      travelFees: details?.travelFees ?? '',
    })
  } else {
    resetForm()
  }
})
</script>

<template>
  <UiDialog :open="open" @update:open="handleClose">
    <UiDialogContent class="sm:max-w-lg">
      <UiDialogHeader>
        <UiDialogTitle>Modifier les informations professionnelles</UiDialogTitle>
        <UiDialogDescription>
          Modifiez les informations professionnelles de <strong>{{ user?.firstName }} {{ user?.lastName }}</strong>.
        </UiDialogDescription>
      </UiDialogHeader>

      <form class="space-y-4" @submit="onSubmit">
        <div class="space-y-2">
          <UiLabel for="edit-inamiNumber">Numero INAMI</UiLabel>
          <UiInput
            id="edit-inamiNumber" v-model="inamiNumber"
            placeholder="1-12345-67-890" :disabled="isSubmitting"
          />
        </div>

        <div class="space-y-2">
          <UiLabel for="edit-bio">Biographie</UiLabel>
          <UiTextarea
            id="edit-bio" v-model="bio" :rows="4"
            placeholder="Biographie de la sage-femme..." :disabled="isSubmitting"
          />
          <p v-if="errors.bio" class="text-sm text-destructive">{{ errors.bio }}</p>
          <p v-if="bio" class="text-xs text-muted-foreground">{{ bio.length }}/1000</p>
        </div>

        <div class="flex items-center justify-between rounded-lg border p-3">
          <div>
            <UiLabel for="edit-conventionalRates" class="text-sm font-medium">
              Tarifs conventionnes
            </UiLabel>
            <p class="text-xs text-muted-foreground">
              La sage-femme applique les tarifs conventionnes
            </p>
          </div>
          <UiSwitch
            id="edit-conventionalRates"
            :checked="appliesConventionalRates"
            :disabled="isSubmitting"
            @update:checked="appliesConventionalRates = $event"
          />
        </div>

        <div class="space-y-2">
          <UiLabel for="edit-travelFees">Frais de deplacement (EUR)</UiLabel>
          <UiInput
            id="edit-travelFees" v-model="travelFees" type="number"
            min="0" step="0.01" placeholder="0.00" :disabled="isSubmitting"
          />
        </div>

        <UiDialogFooter>
          <UiButton type="button" variant="outline" :disabled="isSubmitting" @click="handleClose">
            Annuler
          </UiButton>
          <UiButton type="submit" :disabled="isSubmitting">
            <Loader2 v-if="isSubmitting" class="mr-2 h-4 w-4 animate-spin" />
            Enregistrer
          </UiButton>
        </UiDialogFooter>
      </form>
    </UiDialogContent>
  </UiDialog>
</template>