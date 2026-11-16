<script setup lang="ts">
import type { LegalContent } from '~~/shared/types/legal-content'
import { Calendar, FileText, Tag, CheckCircle, XCircle, Eye, EyeOff } from 'lucide-vue-next'

interface Props {
  open: boolean
  content: LegalContent | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { getTypeLabel, getStatusLabel, formatVersion } = useLegalContent()

// Computed properties for better data display
const formattedCreatedAt = computed(() => {
  if (!props.content?.createdAt) return ''
  return new Date(props.content.createdAt).toLocaleDateString('fr-FR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
})

const formattedUpdatedAt = computed(() => {
  if (!props.content?.updatedAt) return ''
  return new Date(props.content.updatedAt).toLocaleDateString('fr-FR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
})

const statusIcon = computed(() => {
  if (!props.content) return XCircle
  return props.content.isActive ? CheckCircle : XCircle
})

const statusColor = computed(() => {
  if (!props.content) return 'text-gray-500'
  return props.content.isActive ? 'text-green-600' : 'text-orange-600'
})

// Removed publishIcon and publishColor computeds since canBePublished no longer exists

// Content preview with markdown support
const contentPreview = computed(() => {
  if (!props.content?.content) return ''
  // Simple markdown to HTML conversion for basic formatting
  return props.content.content
    .replace(/^# (.*$)/gm, '<h1 class="text-2xl font-bold mb-4">$1</h1>')
    .replace(/^## (.*$)/gm, '<h2 class="text-xl font-semibold mb-3">$1</h2>')
    .replace(/^### (.*$)/gm, '<h3 class="text-lg font-medium mb-2">$1</h3>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n\n/g, '</p><p class="mb-3">')
    .replace(/\n/g, '<br>')
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
          <span>Détails du contenu légal</span>
        </UiDialogTitle>
      </UiDialogHeader>

      <div v-if="content" class="space-y-6 overflow-y-auto flex-1 min-h-0 pb-4">
        <!-- Header Information -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <!-- Basic Info -->
          <div class="space-y-4">
            <div>
              <label class="text-sm font-medium text-muted-foreground">Titre</label>
              <p class="text-lg font-medium">{{ content.title }}</p>
            </div>

            <div>
              <label class="text-sm font-medium text-muted-foreground">Type de contenu</label>
              <div class="flex items-center space-x-2 mt-1">
                <UiBadge variant="outline">{{ getTypeLabel(content.contentType) }}</UiBadge>
                <UiBadge variant="secondary">{{ formatVersion(content.version) }}</UiBadge>
              </div>
            </div>

            <div>
              <label class="text-sm font-medium text-muted-foreground">ID</label>
              <p class="font-mono text-sm">#{{ content.id }}</p>
            </div>
          </div>

          <!-- Status Info -->
          <div class="space-y-4">
            <div>
              <label class="text-sm font-medium text-muted-foreground">Statut de publication</label>
              <div class="flex items-center space-x-2 mt-1">
                <component :is="statusIcon" :class="['h-4 w-4', statusColor]" />
                <span :class="statusColor" class="font-medium">
                  {{ content.isActive ? 'Publié' : 'Non publié' }}
                </span>
              </div>
            </div>


            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="text-sm font-medium text-muted-foreground flex items-center space-x-1">
                  <Calendar class="h-3 w-3" />
                  <span>Créé le</span>
                </label>
                <p class="text-sm">{{ formattedCreatedAt }}</p>
              </div>

              <div>
                <label class="text-sm font-medium text-muted-foreground flex items-center space-x-1">
                  <Calendar class="h-3 w-3" />
                  <span>Modifié le</span>
                </label>
                <p class="text-sm">{{ formattedUpdatedAt }}</p>
              </div>
            </div>
          </div>
        </div>

        <UiSeparator />

        <!-- Content Section -->
        <div>
          <div class="flex items-center justify-between mb-4">
            <label class="text-lg font-medium">Contenu</label>
            <UiBadge variant="outline" class="text-xs">
              {{ content.content.length }} caractères
            </UiBadge>
          </div>

          <!-- Content Display -->
          <div class="border rounded-lg p-6 bg-muted/30 max-h-96 overflow-y-auto">
            <div 
              class="prose prose-sm max-w-none
                     prose-headings:text-foreground 
                     prose-p:text-foreground prose-p:mb-3
                     prose-strong:text-foreground 
                     prose-em:text-foreground" 
              v-html="contentPreview"
            />
          </div>
        </div>

        <!-- Technical Details -->
        <div>
          <label class="text-lg font-medium mb-3 block">Informations techniques</label>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div class="border rounded-md p-3 bg-muted/20">
              <div class="flex items-center space-x-2">
                <Tag class="h-3 w-3 text-muted-foreground" />
                <div>
                  <p class="text-xs font-medium">Type</p>
                  <p class="text-xs text-muted-foreground">{{ content.contentType }}</p>
                </div>
              </div>
            </div>

            <div class="border rounded-md p-3 bg-muted/20">
              <div class="flex items-center space-x-2">
                <FileText class="h-3 w-3 text-muted-foreground" />
                <div>
                  <p class="text-xs font-medium">Version</p>
                  <p class="text-xs text-muted-foreground">{{ content.version }}</p>
                </div>
              </div>
            </div>

            <div class="border rounded-md p-3 bg-muted/20">
              <div class="flex items-center space-x-2">
                <component :is="statusIcon" :class="['h-3 w-3', statusColor]" />
                <div>
                  <p class="text-xs font-medium">Publication</p>
                  <p class="text-xs text-muted-foreground">
                    {{ content.isActive ? 'Publié' : 'Non publié' }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <UiDialogFooter class="pt-4 flex-shrink-0 border-t mt-0">
        <UiButton variant="outline" @click="closeDialog">
          Fermer
        </UiButton>
      </UiDialogFooter>
    </UiDialogContent>
  </UiDialog>
</template>

<style scoped>
/* Custom scrollbar for content area */
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