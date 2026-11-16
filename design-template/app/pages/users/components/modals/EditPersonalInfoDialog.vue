<script setup lang="ts">
import type { AdminUser } from '~~~/shared/types/user'
import { Loader2 } from 'lucide-vue-next'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm, useField } from 'vee-validate'
import { z } from 'zod'

const props = defineProps<{
  open: boolean
  user: AdminUser | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'updated': []
}>()

const { handleApiResponse } = useApiResponse()
const toast = useToast()
const isSubmitting = ref(false)

const schema = toTypedSchema(z.object({
  firstName: z.string().min(1, 'Le prenom est requis'),
  lastName: z.string().min(1, 'Le nom est requis'),
  email: z.string().email('Email invalide'),
  phone: z.string().min(1, 'Le telephone est requis'),
  address: z.string(),
  postalCode: z.string(),
}))

const { handleSubmit, errors, resetForm, setValues } = useForm({ validationSchema: schema })

const { value: firstName } = useField<string>('firstName')
const { value: lastName } = useField<string>('lastName')
const { value: email } = useField<string>('email')
const { value: phone } = useField<string>('phone')
const { value: address } = useField<string>('address')
const { value: postalCode } = useField<string>('postalCode')

const handleClose = () => {
  if (isSubmitting.value) return
  emit('update:open', false)
}

const onSubmit = handleSubmit(async (values) => {
  if (!props.user) return
  isSubmitting.value = true

  const payload: Record<string, string> = {
    firstName: values.firstName,
    lastName: values.lastName,
    email: values.email,
    phone: values.phone,
  }
  if (values.address) payload.address = values.address
  if (values.postalCode) payload.postalCode = values.postalCode

  const response = await api.patch<any>(`/users/${props.user.id}`, payload)
  const { success } = handleApiResponse(response)
  isSubmitting.value = false

  if (success) {
    toast.handleApiSuccess('Informations personnelles mises a jour')
    emit('updated')
    handleClose()
  } else {
    toast.handleApiError({ success: false, message: 'Erreur lors de la mise a jour' })
  }
})

watch(() => props.open, (newOpen) => {
  if (newOpen && props.user) {
    setValues({
      firstName: props.user.firstName ?? '',
      lastName: props.user.lastName ?? '',
      email: props.user.email ?? '',
      phone: props.user.phone ?? '',
      address: props.user.address ?? '',
      postalCode: props.user.postalCode ?? '',
    })
  } else if (!newOpen) {
    resetForm()
  }
})
</script>

<template>
  <UiDialog :open="open" @update:open="handleClose">
    <UiDialogContent class="sm:max-w-lg">
      <UiDialogHeader>
        <UiDialogTitle>Modifier les informations personnelles</UiDialogTitle>
        <UiDialogDescription>
          Modifiez les informations de <strong>{{ user?.firstName }} {{ user?.lastName }}</strong>.
        </UiDialogDescription>
      </UiDialogHeader>

      <form class="space-y-4" @submit="onSubmit">
        <div class="grid grid-cols-2 gap-4">
          <div class="space-y-2">
            <UiLabel for="edit-firstName">Prenom *</UiLabel>
            <UiInput id="edit-firstName" v-model="firstName" :disabled="isSubmitting" />
            <p v-if="errors.firstName" class="text-sm text-destructive">{{ errors.firstName }}</p>
          </div>
          <div class="space-y-2">
            <UiLabel for="edit-lastName">Nom *</UiLabel>
            <UiInput id="edit-lastName" v-model="lastName" :disabled="isSubmitting" />
            <p v-if="errors.lastName" class="text-sm text-destructive">{{ errors.lastName }}</p>
          </div>
        </div>

        <div class="space-y-2">
          <UiLabel for="edit-email">Email *</UiLabel>
          <UiInput id="edit-email" v-model="email" type="email" :disabled="isSubmitting" />
          <p v-if="errors.email" class="text-sm text-destructive">{{ errors.email }}</p>
        </div>

        <div class="space-y-2">
          <UiLabel for="edit-phone">Telephone *</UiLabel>
          <UiInput id="edit-phone" v-model="phone" :disabled="isSubmitting" />
          <p v-if="errors.phone" class="text-sm text-destructive">{{ errors.phone }}</p>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div class="space-y-2">
            <UiLabel for="edit-address">Adresse</UiLabel>
            <UiInput id="edit-address" v-model="address" :disabled="isSubmitting" />
          </div>
          <div class="space-y-2">
            <UiLabel for="edit-postalCode">Code postal</UiLabel>
            <UiInput id="edit-postalCode" v-model="postalCode" :disabled="isSubmitting" />
          </div>
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