<script setup lang="ts">
import type { UpdateLegalContentRequest, LegalContentType, LegalContent } from '~~/shared/types/legal-content'
import { FileText, Save, X } from 'lucide-vue-next'
import { z } from 'zod'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'

interface Props {
  open: boolean
  content: LegalContent | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'updated': [content: LegalContent]
}>()

const { updateLegalContent } = useLegalContent()
const toast = useToast()

// Content types with labels
const CONTENT_TYPES: { value: LegalContentType; label: string }[] = [
  { value: 'terms', label: 'Conditions générales d\'utilisation' },
  { value: 'privacy', label: 'Politique de confidentialité' },
  { value: 'about', label: 'À propos de l\'application' }
]

// Form validation schema
const editContentSchema = toTypedSchema(z.object({
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
const { handleSubmit, resetForm, values, errors, setValues } = useForm({
  validationSchema: editContentSchema,
  initialValues: {
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

// Watch for content changes to populate form
watch(() => props.content, (newContent) => {
  if (newContent && props.open) {
    setValues({
      title: newContent.title,
      content: newContent.content,
      version: newContent.version
    })
    publishImmediately.value = false
  }
}, { immediate: true })

// Close dialog
const closeDialog = () => {
  emit('update:open', false)
  resetForm()
  publishImmediately.value = false
}

// Submit form
const onSubmit = handleSubmit(async (formValues) => {
  if (!props.content) return
  
  try {
    loading.value = true

    const payload: UpdateLegalContentRequest = {
      title: formValues.title,
      content: formValues.content,
      version: formValues.version
    }

    // Add publish flag if checked
    if (publishImmediately.value) {
      ;(payload as any).publishImmediately = true
    }

    const updatedContent = await updateLegalContent(props.content.id, payload)
    
    toast.handleApiSuccess(`Contenu modifié avec succès${publishImmediately.value ? ' et publié' : ''}`)

    emit('updated', updatedContent)
    closeDialog()
  } catch (error: any) {
    toast.handleApiError({ success: false, error: error.message || 'Impossible de modifier le contenu' }, 'Erreur lors de la modification')
  } finally {
    loading.value = false
  }
})

// Generate new version number
const generateNewVersion = () => {
  const currentVersion = values.version || props.content?.version || '1.0'
  const [major, minor] = currentVersion.split('.').map(Number)
  const newVersion = `${major}.${minor + 1}`
  setValues({ ...values, version: newVersion })
}
</script>

<template>
  <UiDialog :open="open" @update:open="closeDialog">
    <UiDialogContent :prevent-outside-click="true" class="max-w-4xl h-[90vh] flex flex-col">
      <UiDialogHeader class="pb-4 flex-shrink-0">
        <UiDialogTitle class="flex items-center space-x-2">
          <FileText class="h-5 w-5" />
          <span>Modifier le contenu légal</span>
        </UiDialogTitle>
      </UiDialogHeader>

      <form class="flex flex-col flex-1 min-h-0" @submit="onSubmit">
        <div class="flex-1 min-h-0 overflow-hidden">
          <!-- Form Content -->
          <div class="space-y-4 overflow-y-auto h-full px-1 pb-6">
            <!-- Content Type (Read-only) -->
            <div class="space-y-2">
              <label class="text-sm font-medium">Type de contenu</label>
              <div class="p-2 bg-muted rounded-md">
                <span class="text-sm">{{ content?.contentTypeLabel }}</span>
              </div>
              <p class="text-xs text-muted-foreground">Le type de contenu ne peut pas être modifié</p>
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
              <div class="flex items-center justify-between">
                <label class="text-sm font-medium flex items-center space-x-1">
                  <span>Version</span>
                  <span class="text-red-500">*</span>
                </label>
                <UiButton 
                  type="button" 
                  variant="outline" 
                  size="sm"
                  @click="generateNewVersion"
                >
                  Incrémenter
                </UiButton>
              </div>
              <UiInput 
                v-model="values.version"
                placeholder="1.0"
                :class="errors.version ? 'border-red-500' : ''"
              />
              <div class="flex justify-between text-xs text-muted-foreground">
                <span v-if="errors.version" class="text-red-500">{{ errors.version }}</span>
                <span v-else>Format requis: X.Y (ex: 1.0, 2.1)</span>
                <span v-if="content" class="text-muted-foreground">Version actuelle: {{ content.version }}</span>
              </div>
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
                id="publish-immediately-edit"
                v-model:checked="publishImmediately"
              />
              <label 
                for="publish-immediately-edit" 
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
            {{ loading ? 'Modification...' : 'Sauvegarder' }}
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