<script setup lang="ts">
import { z } from 'zod'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm, useField } from 'vee-validate'
import type { Language, CreateLanguageDto, UpdateLanguageDto } from '~~/shared/types/language'

interface Props {
  language?: Language | null
  isOpen: boolean
  isLoading?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'submit': [data: CreateLanguageDto | (UpdateLanguageDto & { id: number })]
  'cancel': []
}>()

const isEditing = computed(() => !!props.language)

// Validation schema
const validationSchema = toTypedSchema(z.object({
  code: z.string()
    .min(2, 'Le code doit contenir au moins 2 caractères')
    .max(5, 'Le code ne peut pas dépasser 5 caractères')
    .regex(/^[a-z]{2,5}$/, 'Le code doit être en minuscules (ex: fr, en, nl)'),
  flag: z.string()
    .max(10, 'Le drapeau ne peut pas dépasser 10 caractères')
    .optional()
    .or(z.literal('')),
  enabled: z.boolean().default(true)
}))

const { handleSubmit, resetForm, errors, setValues } = useForm({
  validationSchema,
  initialValues: {
    code: '',
    flag: '',
    enabled: true
  }
})

const { value: code } = useField<string>('code')
const { value: flag } = useField<string>('flag')
const { value: enabled } = useField<boolean>('enabled')

// Drapeaux courants pour suggestions
const commonFlags = [
  { code: 'fr', flag: '🇫🇷', name: 'Français' },
  { code: 'en', flag: '🇬🇧', name: 'Anglais' },
  { code: 'nl', flag: '🇳🇱', name: 'Néerlandais' },
  { code: 'de', flag: '🇩🇪', name: 'Allemand' },
  { code: 'es', flag: '🇪🇸', name: 'Espagnol' },
  { code: 'it', flag: '🇮🇹', name: 'Italien' },
  { code: 'pt', flag: '🇵🇹', name: 'Portugais' },
  { code: 'ar', flag: '🇸🇦', name: 'Arabe' },
  { code: 'zh', flag: '🇨🇳', name: 'Chinois' },
  { code: 'ja', flag: '🇯🇵', name: 'Japonais' },
  { code: 'ko', flag: '🇰🇷', name: 'Coréen' },
  { code: 'ru', flag: '🇷🇺', name: 'Russe' },
  { code: 'tr', flag: '🇹🇷', name: 'Turc' },
  { code: 'pl', flag: '🇵🇱', name: 'Polonais' },
  { code: 'ro', flag: '🇷🇴', name: 'Roumain' }
]

// Auto-remplir le drapeau basé sur le code
const autoFillFlag = () => {
  const match = commonFlags.find(f => f.code === code.value?.toLowerCase())
  if (match && !flag.value) {
    flag.value = match.flag
  }
}

// Watch code changes pour auto-fill
watch(code, (newCode) => {
  if (newCode && !isEditing.value) {
    autoFillFlag()
  }
})

// Sélectionner un drapeau depuis les suggestions
const selectFlag = (selectedFlag: string) => {
  flag.value = selectedFlag
}

const onSubmit = handleSubmit((values) => {
  const data = isEditing.value
    ? {
        id: props.language!.id,
        code: values.code,
        flag: values.flag || undefined,
        enabled: values.enabled
      } as UpdateLanguageDto & { id: number }
    : {
        code: values.code,
        flag: values.flag || undefined,
        enabled: values.enabled
      } as CreateLanguageDto

  emit('submit', data)
})

const updateFieldValues = () => {
  if (props.language) {
    setValues({
      code: props.language.code || '',
      flag: props.language.flag || '',
      enabled: props.language.enabled ?? true
    })
  } else {
    setValues({
      code: '',
      flag: '',
      enabled: true
    })
  }
}

const onCancel = () => {
  resetForm()
  emit('cancel')
}

// Mettre à jour les valeurs quand le dialog s'ouvre
watch(() => props.isOpen, (isOpen) => {
  if (isOpen) {
    nextTick(() => {
      updateFieldValues()
    })
  }
}, { immediate: false })

// Watch pour les changements de langue quand le dialog est ouvert
watch(() => props.language, () => {
  if (props.isOpen) {
    nextTick(() => {
      updateFieldValues()
    })
  }
}, { immediate: false })
</script>

<template>
  <UiDialog :open="isOpen" @update:open="$event || onCancel()">
    <UiDialogContent class="max-w-lg">
      <UiDialogHeader>
        <UiDialogTitle>
          {{ isEditing ? 'Modifier la langue' : 'Nouvelle langue' }}
        </UiDialogTitle>
        <UiDialogDescription>
          {{ isEditing ? 'Modifiez les informations de la langue.' : 'Ajoutez une nouvelle langue à l\'application.' }}
        </UiDialogDescription>
      </UiDialogHeader>

      <form
        v-if="isOpen"
        :key="`form-${props.language?.id || 'new'}-${isOpen}`"
        class="space-y-6"
        @submit="onSubmit"
      >
        <!-- Code ISO -->
        <div class="space-y-2">
          <UiLabel for="code">
            Code ISO 639-1 <span class="text-destructive">*</span>
          </UiLabel>
          <UiInput
            id="code"
            v-model="code"
            placeholder="ex: fr, en, nl"
            :disabled="isLoading"
            class="font-mono uppercase"
            maxlength="5"
          />
          <p v-if="errors.code" class="text-sm text-destructive">
            {{ errors.code }}
          </p>
          <p class="text-xs text-muted-foreground">
            Code de langue ISO 639-1 (2 à 5 caractères en minuscules)
          </p>
        </div>

        <!-- Drapeau -->
        <div class="space-y-2">
          <UiLabel for="flag">Drapeau (emoji)</UiLabel>
          <div class="flex gap-2">
            <UiInput
              id="flag"
              v-model="flag"
              placeholder="🇫🇷"
              :disabled="isLoading"
              class="text-2xl w-24 text-center"
              maxlength="10"
            />
            <div class="flex-1 text-sm text-muted-foreground flex items-center">
              Aperçu: <span class="text-3xl ml-2">{{ flag || '🏳️' }}</span>
            </div>
          </div>
          <p v-if="errors.flag" class="text-sm text-destructive">
            {{ errors.flag }}
          </p>

          <!-- Drapeaux suggérés -->
          <div class="mt-3">
            <p class="text-xs text-muted-foreground mb-2">Drapeaux courants :</p>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="item in commonFlags"
                :key="item.code"
                type="button"
                class="text-2xl p-1 rounded hover:bg-accent transition-colors"
                :title="`${item.name} (${item.code})`"
                @click="selectFlag(item.flag)"
              >
                {{ item.flag }}
              </button>
            </div>
          </div>
        </div>

        <!-- Statut -->
        <div class="flex items-center space-x-3 p-4 border rounded-lg bg-muted/30">
          <UiSwitch
            id="enabled"
            :checked="enabled"
            :disabled="isLoading"
            @update:checked="enabled = $event"
          />
          <div class="space-y-0.5">
            <UiLabel for="enabled" class="cursor-pointer">
              Langue activée
            </UiLabel>
            <p class="text-xs text-muted-foreground">
              {{ enabled ? 'La langue est disponible dans l\'application' : 'La langue est masquée' }}
            </p>
          </div>
        </div>

        <UiDialogFooter class="pt-6 border-t">
          <UiButton
            type="button"
            variant="outline"
            :disabled="isLoading"
            @click="onCancel"
          >
            Annuler
          </UiButton>
          <UiButton
            type="submit"
            :disabled="isLoading"
          >
            <AppSpinner v-if="isLoading" class="mr-2 h-4 w-4" />
            {{ isEditing ? 'Modifier' : 'Enregistrer' }}
          </UiButton>
        </UiDialogFooter>
      </form>
    </UiDialogContent>
  </UiDialog>
</template>
