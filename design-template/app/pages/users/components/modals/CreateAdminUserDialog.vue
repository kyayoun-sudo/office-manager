<script setup lang="ts">
import type { AdminCreateUserPayload } from '~~~/shared/types/user'
import { Eye, EyeOff, Loader2, CheckCircle2, XCircle } from 'lucide-vue-next'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'success': []
}>()

const { createUser, checkEmailAvailability } = useUsers()
const toast = useToast()

const form = ref<AdminCreateUserPayload>({
  email: '',
  password: '',
  firstName: '',
  lastName: '',
  phone: '',
  postalCode: '',
  address: '',
  preferredLanguages: ['fr'],
})

const showPassword = ref(false)
const isSubmitting = ref(false)
const emailStatus = ref<'idle' | 'checking' | 'available' | 'taken'>('idle')
const errors = ref<Record<string, string>>({})

let emailCheckTimeout: ReturnType<typeof setTimeout> | null = null

const validateForm = (): boolean => {
  const newErrors: Record<string, string> = {}

  if (!form.value.email) newErrors.email = 'Email requis'
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.value.email)) newErrors.email = 'Format email invalide'
  else if (emailStatus.value === 'taken') newErrors.email = 'Email déjà utilisé'

  if (!form.value.password) newErrors.password = 'Mot de passe requis'
  else if (form.value.password.length < 6) newErrors.password = 'Minimum 6 caractères'

  if (!form.value.firstName) newErrors.firstName = 'Prénom requis'
  if (!form.value.lastName) newErrors.lastName = 'Nom requis'

  if (!form.value.phone) newErrors.phone = 'Téléphone requis'
  else if (!/^\+\d{8,15}$/.test(form.value.phone)) newErrors.phone = 'Format international requis (ex: +32470123456)'

  if (!form.value.postalCode) newErrors.postalCode = 'Code postal requis'

  errors.value = newErrors
  return Object.keys(newErrors).length === 0
}

const onEmailInput = (value: string) => {
  form.value.email = value
  errors.value.email = ''
  emailStatus.value = 'idle'

  if (emailCheckTimeout) clearTimeout(emailCheckTimeout)
  if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return

  emailCheckTimeout = setTimeout(async () => {
    emailStatus.value = 'checking'
    const available = await checkEmailAvailability(value)
    emailStatus.value = available ? 'available' : 'taken'
    if (!available) errors.value.email = 'Email déjà utilisé'
  }, 500)
}

const handleSubmit = async () => {
  if (!validateForm()) return

  isSubmitting.value = true
  const payload: AdminCreateUserPayload = {
    email: form.value.email,
    password: form.value.password,
    firstName: form.value.firstName,
    lastName: form.value.lastName,
    phone: form.value.phone,
    postalCode: form.value.postalCode,
    ...(form.value.address && { address: form.value.address }),
    preferredLanguages: form.value.preferredLanguages,
  }

  const result = await createUser(payload)
  isSubmitting.value = false

  if (result.success) {
    toast.handleApiSuccess('Administrateur créé avec succès')
    emit('success')
    handleClose()
  } else {
    toast.handleApiError({ success: false, message: result.error || 'Erreur lors de la création' })
  }
}

const handleClose = () => {
  if (isSubmitting.value) return
  emit('update:open', false)
  resetForm()
}

const resetForm = () => {
  form.value = {
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    phone: '',
    postalCode: '',
    address: '',
    preferredLanguages: ['fr'],
  }
  errors.value = {}
  emailStatus.value = 'idle'
  showPassword.value = false
}

watch(() => props.open, (newOpen) => {
  if (!newOpen) resetForm()
})
</script>

<template>
  <UiDialog :open="open" @update:open="handleClose">
    <UiDialogContent class="sm:max-w-lg">
      <UiDialogHeader>
        <UiDialogTitle>Créer un administrateur</UiDialogTitle>
        <UiDialogDescription>
          Le compte sera automatiquement confirmé et actif.
        </UiDialogDescription>
      </UiDialogHeader>

      <form class="space-y-4" @submit.prevent="handleSubmit">
        <div class="grid grid-cols-2 gap-4">
          <div class="space-y-2">
            <UiLabel for="firstName">Prénom *</UiLabel>
            <UiInput
              id="firstName"
              v-model="form.firstName"
              placeholder="Jean"
              :class="{ 'border-destructive': errors.firstName }"
            />
            <p v-if="errors.firstName" class="text-xs text-destructive">{{ errors.firstName }}</p>
          </div>
          <div class="space-y-2">
            <UiLabel for="lastName">Nom *</UiLabel>
            <UiInput
              id="lastName"
              v-model="form.lastName"
              placeholder="Dupont"
              :class="{ 'border-destructive': errors.lastName }"
            />
            <p v-if="errors.lastName" class="text-xs text-destructive">{{ errors.lastName }}</p>
          </div>
        </div>

        <div class="space-y-2">
          <UiLabel for="email">Email *</UiLabel>
          <div class="relative">
            <UiInput
              id="email"
              :model-value="form.email"
              placeholder="admin@example.com"
              type="email"
              :class="{ 'border-destructive': errors.email, 'pr-10': emailStatus !== 'idle' }"
              @update:model-value="onEmailInput"
            />
            <div class="absolute inset-y-0 right-0 flex items-center pr-3">
              <Loader2 v-if="emailStatus === 'checking'" class="h-4 w-4 animate-spin text-muted-foreground" />
              <CheckCircle2 v-else-if="emailStatus === 'available'" class="h-4 w-4 text-green-500" />
              <XCircle v-else-if="emailStatus === 'taken'" class="h-4 w-4 text-destructive" />
            </div>
          </div>
          <p v-if="errors.email" class="text-xs text-destructive">{{ errors.email }}</p>
        </div>

        <div class="space-y-2">
          <UiLabel for="password">Mot de passe *</UiLabel>
          <div class="relative">
            <UiInput
              id="password"
              v-model="form.password"
              :type="showPassword ? 'text' : 'password'"
              placeholder="Minimum 6 caractères"
              class="pr-10"
              :class="{ 'border-destructive': errors.password }"
            />
            <button
              type="button"
              class="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
              @click="showPassword = !showPassword"
            >
              <Eye v-if="!showPassword" class="h-4 w-4" />
              <EyeOff v-else class="h-4 w-4" />
            </button>
          </div>
          <p v-if="errors.password" class="text-xs text-destructive">{{ errors.password }}</p>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div class="space-y-2">
            <UiLabel for="phone">Téléphone *</UiLabel>
            <UiInput
              id="phone"
              v-model="form.phone"
              placeholder="+32470123456"
              :class="{ 'border-destructive': errors.phone }"
            />
            <p v-if="errors.phone" class="text-xs text-destructive">{{ errors.phone }}</p>
          </div>
          <div class="space-y-2">
            <UiLabel for="postalCode">Code postal *</UiLabel>
            <UiInput
              id="postalCode"
              v-model="form.postalCode"
              placeholder="1000"
              :class="{ 'border-destructive': errors.postalCode }"
            />
            <p v-if="errors.postalCode" class="text-xs text-destructive">{{ errors.postalCode }}</p>
          </div>
        </div>

        <div class="space-y-2">
          <UiLabel for="address">Adresse</UiLabel>
          <UiInput
            id="address"
            v-model="form.address"
            placeholder="123 Rue de la Loi (optionnel)"
          />
        </div>

        <UiDialogFooter>
          <UiButton
type="button"
variant="outline"
:disabled="isSubmitting"
@click="handleClose">
            Annuler
          </UiButton>
          <UiButton type="submit" :disabled="isSubmitting || emailStatus === 'taken'">
            <Loader2 v-if="isSubmitting" class="mr-2 h-4 w-4 animate-spin" />
            Créer l'administrateur
          </UiButton>
        </UiDialogFooter>
      </form>
    </UiDialogContent>
  </UiDialog>
</template>
