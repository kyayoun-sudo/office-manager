<script setup lang="ts">
import { z } from 'zod'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm, useField } from 'vee-validate'
import type { Insurance } from '~~/shared/types/insurance'

interface Props {
  insurance?: Insurance | null
  isOpen: boolean
  isLoading?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  submit: [data: { id?: number; libelle: string; type: string }]
  cancel: []
}>()

const isEditing = computed(() => !!props.insurance)

const validationSchema = toTypedSchema(z.object({
  libelle: z.string().min(1, 'Le libelle est requis'),
  type: z.string().min(1, 'Le type est requis'),
}))

const { handleSubmit, resetForm, errors } = useForm({
  validationSchema,
  initialValues: { libelle: '', type: 'mutual' },
})

const { value: libelle } = useField<string>('libelle')
const { value: type } = useField<string>('type')

const onSubmit = handleSubmit(() => {
  const data = isEditing.value
    ? { id: props.insurance!.id, libelle: libelle.value, type: type.value }
    : { libelle: libelle.value, type: type.value }
  emit('submit', data)
})

const updateFieldValues = () => {
  if (props.insurance) {
    libelle.value = props.insurance.libelle || ''
    type.value = props.insurance.type || 'mutual'
  } else {
    libelle.value = ''
    type.value = 'mutual'
  }
}

const onCancel = () => {
  resetForm()
  emit('cancel')
}

watch(() => props.isOpen, (isOpen) => {
  if (isOpen) nextTick(updateFieldValues)
}, { immediate: false })

watch(() => props.insurance, () => {
  if (props.isOpen) nextTick(updateFieldValues)
}, { immediate: false })
</script>

<template>
  <UiDialog :open="isOpen" @update:open="$event || onCancel()">
    <UiDialogContent class="max-w-md">
      <UiDialogHeader>
        <UiDialogTitle>
          {{ isEditing ? 'Modifier l\'assurance' : 'Nouvelle assurance' }}
        </UiDialogTitle>
        <UiDialogDescription>
          {{ isEditing ? 'Modifiez les informations de l\'assurance.' : 'Creez une nouvelle assurance.' }}
        </UiDialogDescription>
      </UiDialogHeader>

      <form v-if="isOpen" class="space-y-4" @submit="onSubmit">
        <div class="space-y-2">
          <label class="text-sm font-medium">Libelle *</label>
          <UiInput v-model="libelle" placeholder="Ex: Assurance Maladie Generale" />
          <p v-if="errors.libelle" class="text-sm text-destructive">{{ errors.libelle }}</p>
        </div>

        <div class="space-y-2">
          <label class="text-sm font-medium">Type *</label>
          <UiSelect v-model="type">
            <UiSelectTrigger class="w-full">
              <UiSelectValue />
            </UiSelectTrigger>
            <UiSelectContent>
              <UiSelectItem value="mutual">Mutuelle</UiSelectItem>
              <UiSelectItem value="hospital">Hospitalisation</UiSelectItem>
            </UiSelectContent>
          </UiSelect>
          <p v-if="errors.type" class="text-sm text-destructive">{{ errors.type }}</p>
        </div>

        <UiDialogFooter class="pt-4 border-t">
          <UiButton
type="button"
variant="outline"
:disabled="isLoading"
@click="onCancel">
            Annuler
          </UiButton>
          <UiButton type="submit" :disabled="isLoading">
            <AppSpinner v-if="isLoading" class="mr-2 h-4 w-4" />
            {{ isEditing ? 'Modifier' : 'Creer' }}
          </UiButton>
        </UiDialogFooter>
      </form>
    </UiDialogContent>
  </UiDialog>
</template>
