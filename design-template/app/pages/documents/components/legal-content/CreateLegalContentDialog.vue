<script setup lang="ts">
import type { CreateLegalContentRequest, LegalContentType } from '~~/shared/types/legal-content'
import { FileText, Save, X } from 'lucide-vue-next'
import { z } from 'zod'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'

interface Props {
  open: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'created': [content: any]
}>()

const { createLegalContent } = useLegalContent()
const toast = useToast()

// Content types with labels
const CONTENT_TYPES: { value: LegalContentType; label: string }[] = [
  { value: 'terms', label: 'Conditions générales d\'utilisation' },
  { value: 'privacy', label: 'Politique de confidentialité' },
  { value: 'about', label: 'À propos de l\'application' }
]

// Form validation schema
const createContentSchema = toTypedSchema(z.object({
  contentType: z.enum(['terms', 'privacy', 'about'], {
    required_error: 'Le type de contenu est requis'
  }),
  title: z.string()
    .min(1, 'Le titre est requis')
    .min(10, 'Le titre doit contenir au moins 10 caractères')
    .max(200, 'Le titre ne peut pas dépasser 200 caractères'),
  content: z.string()
    .min(1, 'Le contenu est requis')
    .min(50, 'Le contenu doit contenir au moins 50 caractères'),
  version: z.string()
    .min(1, 'La version est requise')
    .regex(/^\d+\.\d+$/, 'La version doit être au format X.Y (ex: 1.0, 2.1)')
}))

// Form setup
const { handleSubmit, resetForm, values, errors } = useForm({
  validationSchema: createContentSchema,
  initialValues: {
    contentType: 'terms' as LegalContentType,
    title: '',
    content: '',
    version: '1.0'
  }
})

// State
const loading = ref(false)
const publishImmediately = ref(false)


// Character count
const characterCount = computed(() => values.content?.length || 0)

// Close dialog
const closeDialog = () => {
  emit('update:open', false)
  resetForm()
  publishImmediately.value = false
}

// Submit form
const onSubmit = handleSubmit(async (formValues) => {
  try {
    loading.value = true

    const payload: CreateLegalContentRequest = {
      contentType: formValues.contentType,
      title: formValues.title,
      content: formValues.content,
      version: formValues.version
    }

    // Add publish flag if checked
    if (publishImmediately.value) {
      // This would be handled by the API - for now we just include it in the request
      ;(payload as any).publishImmediately = true
    }

    const createdContent = await createLegalContent(payload)
    
    toast.handleApiSuccess(`Contenu créé avec succès${publishImmediately.value ? ' et publié' : ''}`)

    emit('created', createdContent)
    closeDialog()
  } catch (error: any) {
    toast.handleApiError({ success: false, error: error.message || 'Impossible de créer le contenu' }, 'Erreur lors de la création')
  } finally {
    loading.value = false
  }
})

</script>

<template>
  <UiDialog :open="open" @update:open="closeDialog">
    <UiDialogContent :prevent-outside-click="true" class="max-w-4xl h-[90vh] flex flex-col">
      <UiDialogHeader class="pb-4 flex-shrink-0">
        <UiDialogTitle class="flex items-center space-x-2">
          <FileText class="h-5 w-5" />
          <span>Créer un nouveau contenu légal</span>
        </UiDialogTitle>
      </UiDialogHeader>

      <form class="flex flex-col flex-1 min-h-0" @submit="onSubmit">
        <div class="flex-1 min-h-0 overflow-hidden">
          <!-- Form Content -->
          <div class="space-y-4 overflow-y-auto h-full px-1 pb-6">
            <!-- Content Type -->
            <div class="space-y-2">
              <label class="text-sm font-medium flex items-center space-x-1">
                <span>Type de contenu</span>
                <span class="text-red-500">*</span>
              </label>
              <UiSelect v-model="values.contentType">
                <UiSelectTrigger :class="errors.contentType ? 'border-red-500' : ''">
                  <UiSelectValue placeholder="Sélectionnez un type" />
                </UiSelectTrigger>
                <UiSelectContent>
                  <UiSelectItem 
                    v-for="type in CONTENT_TYPES" 
                    :key="type.value" 
                    :value="type.value"
                  >
                    {{ type.label }}
                  </UiSelectItem>
                </UiSelectContent>
              </UiSelect>
              <p v-if="errors.contentType" class="text-sm text-red-500">{{ errors.contentType }}</p>
            </div>

            <!-- Title -->
            <div class="space-y-2">
              <label class="text-sm font-medium flex items-center space-x-1">
                <span>Titre</span>
                <span class="text-red-500">*</span>
              </label>
              <UiInput 
                v-model="values.title"
                placeholder="Titre du contenu légal"
                :class="errors.title ? 'border-red-500' : ''"
              />
              <div class="flex justify-between text-xs text-muted-foreground">
                <span v-if="errors.title" class="text-red-500">{{ errors.title }}</span>
                <span class="ml-auto">{{ values.title?.length || 0 }}/200</span>
              </div>
            </div>

            <!-- Version -->
            <div class="space-y-2">
              <label class="text-sm font-medium flex items-center space-x-1">
                <span>Version</span>
                <span class="text-red-500">*</span>
              </label>
              <UiInput 
                v-model="values.version"
                placeholder="1.0"
                :class="errors.version ? 'border-red-500' : ''"
              />
              <p v-if="errors.version" class="text-sm text-red-500">{{ errors.version }}</p>
              <p class="text-xs text-muted-foreground">Format requis: X.Y (ex: 1.0, 2.1)</p>
            </div>

            <!-- Content -->
            <div class="space-y-2">
              <label class="text-sm font-medium flex items-center space-x-1">
                <span>Contenu</span>
                <span class="text-red-500">*</span>
              </label>
              
              <UiTextarea 
                v-model="values.content"
                placeholder="Saisissez le contenu en markdown..."
                :class="errors.content ? 'border-red-500' : ''"
                class="h-[200px] font-mono text-sm resize-none"
                rows="10"
              />
              
              <div class="flex justify-between text-xs text-muted-foreground">
                <span v-if="errors.content" class="text-red-500">{{ errors.content }}</span>
                <span class="ml-auto">{{ characterCount }} caractères</span>
              </div>
            </div>

            <!-- Publish Option -->
            <div class="flex items-center space-x-2 pt-4 mt-4 border-t">
              <UiCheckbox 
                id="publish-immediately"
                v-model:checked="publishImmediately"
              />
              <label 
                for="publish-immediately" 
                class="text-sm font-medium cursor-pointer"
              >
                Publier immédiatement après sauvegarde
              </label>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <UiDialogFooter class="pt-4 flex-shrink-0 border-t mt-0 bg-background">
          <UiButton 
            type="button" 
            variant="outline" 
            :disabled="loading"
            @click="closeDialog"
          >
            <X class="h-4 w-4 mr-2" />
            Annuler
          </UiButton>
          <UiButton 
            type="submit" 
            :disabled="loading"
          >
            <Save class="h-4 w-4 mr-2" />
            {{ loading ? 'Création...' : 'Créer le contenu' }}
          </UiButton>
        </UiDialogFooter>
      </form>
    </UiDialogContent>
  </UiDialog>
</template>

<style scoped>
/* Custom scrollbar */
.overflow-y-auto::-webkit-scrollbar {
  width: 6px;
}

.overflow-y-auto::-webkit-scrollbar-track {
  background: transparent;
}

.overflow-y-auto::-webkit-scrollbar-thumb {
  background: hsl(var(--border));
  border-radius: 3px;
}

.overflow-y-auto::-webkit-scrollbar-thumb:hover {
  background: hsl(var(--muted-foreground));
}
</style>