<script setup lang="ts">
import { z } from 'zod'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm, useField } from 'vee-validate'
import { EyeIcon, EyeOffIcon, ArrowLeftIcon, MailIcon } from 'lucide-vue-next'
import type { LoginCredentials, AdminOtpResponse } from '~~/shared/types/auth'

const { login, verifyOtp, isLoading } = useAuth()
const toast = useToast()
const showPassword = ref(false)

const otpStep = ref(false)
const otpToken = ref('')
const otpCode = ref<string[]>([])
const otpError = ref('')
const loginEmail = ref('')

const schema = toTypedSchema(z.object({
  email: z.string({ required_error: 'Email requis.' }).email('Email invalide'),
  password: z.string({ required_error: 'Mot de passe requis.' }).min(1, 'Mot de passe requis'),
}))

const { handleSubmit, errors } = useForm({
  validationSchema: schema,
  initialValues: { email: '', password: '' },
})

const { value: email } = useField<string>('email')
const { value: password } = useField<string>('password')

const onSubmit = handleSubmit(async (values: LoginCredentials) => {
  try {
    const response = await login(values)

    if (!response.success) {
      toast.handleApiError(response, 'Erreur de connexion')
      return
    }

    if ('requiresOtp' in response && response.requiresOtp) {
      const otpResponse = response as AdminOtpResponse
      otpToken.value = otpResponse.otpToken
      loginEmail.value = values.email
      otpCode.value = []
      otpError.value = ''
      otpStep.value = true
      return
    }

    const firstName = 'data' in response ? response.data?.profile?.firstName : 'Utilisateur'
    toast.handleApiSuccess('Connexion reussie', `Bienvenue ${firstName} !`)
    await nextTick()
    await navigateTo('/')
  } catch {
    toast.handleApiError(
      { success: false, error: 'Erreur de connexion au serveur' },
      'Erreur de connexion',
    )
  }
})

const onOtpComplete = async (code: string[]) => {
  const codeStr = code.join('')
  if (codeStr.length !== 6) return

  otpError.value = ''

  try {
    const response = await verifyOtp({
      otpToken: otpToken.value,
      code: codeStr,
    })

    if (response.success) {
      const firstName = response.data?.profile?.firstName || 'Utilisateur'
      toast.handleApiSuccess('Connexion reussie', `Bienvenue ${firstName} !`)
      await nextTick()
      await navigateTo('/')
    } else {
      otpError.value = response.message || 'Code OTP invalide'
      otpCode.value = []
    }
  } catch {
    otpError.value = 'Erreur de connexion au serveur'
    otpCode.value = []
  }
}

const backToLogin = () => {
  otpStep.value = false
  otpToken.value = ''
  otpCode.value = []
  otpError.value = ''
}
</script>

<template>
  <div class="grid gap-6">
    <template v-if="!otpStep">
      <div class="grid gap-2 text-center">
        <h1 class="text-2xl font-bold">Connectez-vous a votre compte</h1>
        <p class="text-sm text-balance text-muted-foreground">
          Entrez vos identifiants pour acceder au tableau de bord
        </p>
      </div>

      <form class="grid gap-4" @submit="onSubmit">
        <div class="grid gap-2">
          <UiLabel for="email">Email</UiLabel>
          <UiInput
            id="email"
            v-model="email"
            type="email"
            placeholder="admin@example.com"
            :disabled="isLoading"
          />
          <p v-if="errors.email" class="text-sm text-destructive">
            {{ errors.email }}
          </p>
        </div>

        <div class="grid gap-2">
          <div class="flex items-center">
            <UiLabel for="password">Mot de passe</UiLabel>
            <NuxtLink
              to="/reset-password"
              class="ml-auto inline-block text-sm underline-offset-4 hover:underline text-primary"
            >
              Mot de passe oublie ?
            </NuxtLink>
          </div>
          <div class="relative">
            <UiInput
              id="password"
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              placeholder="••••••••"
              :disabled="isLoading"
              class="pr-10"
            />
            <UiButton
              type="button"
              variant="ghost"
              size="sm"
              class="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
              @click="showPassword = !showPassword"
            >
              <EyeIcon v-if="!showPassword" class="size-4 text-muted-foreground" />
              <EyeOffIcon v-else class="size-4 text-muted-foreground" />
            </UiButton>
          </div>
          <p v-if="errors.password" class="text-sm text-destructive">
            {{ errors.password }}
          </p>
        </div>

        <UiButton type="submit" class="w-full" :disabled="isLoading">
          <template v-if="isLoading">
            <AppSpinner class="mr-2 size-4" />
            Connexion en cours...
          </template>
          <template v-else>
            Se connecter
          </template>
        </UiButton>
      </form>
    </template>

    <template v-else>
      <div class="grid gap-2 text-center">
        <h1 class="text-2xl font-bold">Verification OTP</h1>
        <p class="text-sm text-balance text-muted-foreground">
          Un code de verification a 6 chiffres a ete envoye a votre adresse email
        </p>
        <div class="flex items-center justify-center gap-1.5 text-sm text-muted-foreground mt-1">
          <MailIcon class="size-4" />
          <span class="font-medium text-foreground">{{ loginEmail }}</span>
        </div>
      </div>

      <div class="grid gap-4">
        <div class="flex justify-center">
          <UiPinInput
            v-model="otpCode"
            type="number"
            placeholder="○"
            :disabled="isLoading"
            @complete="onOtpComplete"
          >
            <UiPinInputGroup>
              <UiPinInputSlot
                v-for="(_, index) in 3" :key="index"
                :index="index"
                class="size-12 text-lg"
              />
            </UiPinInputGroup>
            <UiPinInputSeparator />
            <UiPinInputGroup>
              <UiPinInputSlot
                v-for="(_, index) in 3" :key="index + 3"
                :index="index + 3"
                class="size-12 text-lg"
              />
            </UiPinInputGroup>
          </UiPinInput>
        </div>

        <p v-if="otpError" class="text-sm text-destructive text-center">
          {{ otpError }}
        </p>

        <div v-if="isLoading" class="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <AppSpinner class="size-4" />
          Verification en cours...
        </div>

        <p class="text-sm text-muted-foreground text-center">
          Le code expire dans 5 minutes
        </p>

        <UiButton
          variant="ghost"
          class="w-full"
          :disabled="isLoading"
          @click="backToLogin"
        >
          <ArrowLeftIcon class="mr-2 size-4" />
          Retour a la connexion
        </UiButton>
      </div>
    </template>
  </div>
</template>