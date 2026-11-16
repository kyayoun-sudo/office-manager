<script setup lang="ts">
import type { Document } from '~~/shared/types/document'
import { Calendar, FileText, Tag, CheckCircle, XCircle, Eye, EyeOff, Globe } from 'lucide-vue-next'

interface Props {
  open: boolean
  document: Document | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

// Computed properties for better data display
const formattedCreatedAt = computed(() => {
  if (!props.document?.createdAt) return ''
  return new Date(props.document.createdAt).toLocaleDateString('fr-FR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
})

const formattedUpdatedAt = computed(() => {
  if (!props.document?.updatedAt) return ''
  return new Date(props.document.updatedAt).toLocaleDateString('fr-FR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
})

const documentTypeLabel = computed(() => {
  if (!props.document?.documentType) return ''
  const typeMap: Record<string, string> = {
    'terms': 'Conditions Générales d\'Utilisation',
    'privacy': 'Politique de Confidentialité',
    'about': 'À propos',
    'sales_conditions': 'Conditions de Vente',
    'faq': 'FAQ',
    'help': 'Aide',
    'guide': 'Guide',
    'policy': 'Politique'
  }
  return typeMap[props.document.documentType] || props.document.documentType
})

// Composable markdown
const { parseMarkdown } = useMarkdown()

// Content preview with markdown support
const contentPreview = computed(() => {
  if (!props.document?.translations) return {}
  
  const preview: Record<string, string> = {}
  
  props.document.translations.forEach(translation => {
    if (translation.content) {
      preview[translation.language.code] = parseMarkdown(translation.content)
    }
  })
  
  return preview
})

const closeDialog = () => {
  emit('update:open', false)
}
</script>

<template>
  <UiDialog :open="open" @update:open="closeDialog">
    <UiDialogContent :prevent-outside-click="true" class="max-w-4xl max-h-[90vh] flex flex-col">
      <UiDialogHeader class="pb-4 flex-shrink-0">
        <UiDialogTitle class="flex items-center space-x-2">
          <FileText class="h-5 w-5" />
          <span>Détails du document</span>
        </UiDialogTitle>
      </UiDialogHeader>

      <div v-if="document" class="space-y-6 overflow-y-auto flex-1 min-h-0 pb-4">
        <!-- Header Information -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <!-- Basic Info -->
          <div class="space-y-4">
            <div>
              <label class="text-sm font-medium text-muted-foreground">Titre</label>
              <p class="text-lg font-medium">{{ document.translations?.[0]?.title || document.documentType }}</p>
            </div>

            <div>
              <label class="text-sm font-medium text-muted-foreground">Type de document</label>
              <div class="flex items-center space-x-2 mt-1">
                <UiBadge variant="outline">{{ documentTypeLabel }}</UiBadge>
                <UiBadge variant="secondary">{{ document.version }}</UiBadge>
              </div>
            </div>

            <div>
              <label class="text-sm font-medium text-muted-foreground">Statut</label>
              <div class="flex items-center space-x-2 mt-1">
                <component 
                  :is="document.isActive ? CheckCircle : XCircle" 
                  :class="document.isActive ? 'text-green-500' : 'text-red-500'"
                  class="h-4 w-4"
                />
                <span :class="document.isActive ? 'text-green-600' : 'text-red-600'">
                  {{ document.isActive ? 'Actif' : 'Inactif' }}
                </span>
              </div>
            </div>
          </div>

          <!-- Metadata -->
          <div class="space-y-4">
            <div>
              <label class="text-sm font-medium text-muted-foreground">Langues</label>
              <div class="flex flex-wrap gap-2 mt-1">
                <UiBadge 
                  v-for="translation in document.translations" 
                  :key="translation.id"
                  variant="secondary"
                  class="flex items-center space-x-1"
                >
                  <span>{{ translation.language.flag }}</span>
                  <span>{{ translation.language.name }}</span>
                </UiBadge>
              </div>
            </div>

            <div>
              <label class="text-sm font-medium text-muted-foreground">Date de création</label>
              <p class="text-sm mt-1">{{ formattedCreatedAt }}</p>
            </div>

            <div>
              <label class="text-sm font-medium text-muted-foreground">Dernière mise à jour</label>
              <p class="text-sm mt-1">{{ formattedUpdatedAt }}</p>
            </div>
          </div>
        </div>

        <!-- Content Tabs -->
        <div v-if="document.translations && document.translations.length > 0" class="space-y-4">
          <h3 class="text-lg font-medium">Contenu des traductions</h3>
          
          <!-- Language Tabs -->
          <div class="flex space-x-1 border-b">
            <button
              v-for="translation in document.translations"
              :key="translation.id"
              class="px-3 py-2 text-xs font-medium transition-all duration-200 relative rounded-t-lg text-muted-foreground hover:text-foreground hover:bg-muted/50"
              :class="{
                'border-b-2 border-primary text-primary bg-primary/5': true
              }"
            >
              <div class="flex items-center space-x-2">
                <span>{{ translation.language.flag }}</span>
                <span>{{ translation.language.name }}</span>
              </div>
            </button>
          </div>

          <!-- Content for each language -->
          <div 
            v-for="translation in document.translations" 
            :key="translation.id" 
            class="space-y-4 p-4 border rounded-lg bg-card"
          >
            <div class="flex items-center justify-between">
              <h4 class="text-sm font-medium flex items-center space-x-2">
                <Globe class="h-3 w-3 text-primary" />
                <span>{{ translation.language.name }} ({{ translation.language.code }})</span>
              </h4>
            </div>

            <div>
              <label class="text-sm font-medium text-muted-foreground">Titre</label>
              <p class="text-base font-medium mt-1">{{ translation.title }}</p>
            </div>

            <div>
              <label class="text-sm font-medium text-muted-foreground">Contenu</label>
              <div 
                class="mt-1 p-4 border rounded-md bg-muted min-h-[200px] text-sm prose prose-sm max-w-none prose-headings:font-semibold prose-h1:text-lg prose-h2:text-base prose-h3:text-sm prose-p:text-xs prose-li:text-xs prose-blockquote:text-xs prose-code:text-xs prose-pre:text-xs"
                v-html="contentPreview[translation.language.code] || translation.content"
              />
            </div>
          </div>
        </div>

        <!-- No translations message -->
        <div v-else class="text-center py-8 text-muted-foreground">
          <FileText class="h-12 w-12 mx-auto text-muted" />
          <p class="mt-2">Aucune traduction disponible pour ce document</p>
        </div>
      </div>

      <!-- Skeleton loader when document is null -->
      <div v-else class="space-y-6 animate-pulse">
        <div class="h-6 bg-muted rounded w-1/3"/>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="space-y-4">
            <div class="h-4 bg-muted rounded w-full"/>
            <div class="h-4 bg-muted rounded w-3/4"/>
            <div class="h-4 bg-muted rounded w-1/2"/>
          </div>
          <div class="space-y-4">
            <div class="h-4 bg-muted rounded w-3/4"/>
            <div class="h-4 bg-muted rounded w-1/2"/>
            <div class="h-4 bg-muted rounded w-2/3"/>
          </div>
        </div>
        <div class="h-48 bg-muted rounded"/>
      </div>

      <!-- Footer with close button -->
      <UiDialogFooter class="pt-4 flex-shrink-0 border-t mt-0 bg-background">
        <UiButton
          variant="outline"
          @click="closeDialog"
        >
          <XCircle class="h-4 w-4 mr-2" />
          Fermer
        </UiButton>
      </UiDialogFooter>
    </UiDialogContent>
  </UiDialog>
</template>