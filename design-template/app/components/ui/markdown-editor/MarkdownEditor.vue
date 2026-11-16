<template>
  <div class="markdown-editor border rounded-lg">
    <!-- Toolbar -->
    <div v-if="showToolbar" class="border-b p-2 flex items-center gap-1 bg-muted/30 flex-wrap">
      <!-- Format de texte -->
      <div class="flex items-center gap-1">
        <UiButton
          type="button"
          variant="ghost"
          size="sm"
          class="h-7 w-7 p-0"
          title="Gras (Ctrl+B)"
          @click="markdownActions.bold(getTextareaElement())"
        >
          <Bold class="h-3 w-3" />
        </UiButton>
        <UiButton
          type="button"
          variant="ghost"
          size="sm"
          class="h-7 w-7 p-0"
          title="Italique (Ctrl+I)"
          @click="markdownActions.italic(getTextareaElement())"
        >
          <Italic class="h-3 w-3" />
        </UiButton>
      </div>

      <div class="h-4 w-px bg-border mx-1" />

      <!-- Titres -->
      <div class="flex items-center gap-1">
        <UiButton
          type="button"
          variant="ghost"
          size="sm"
          class="h-7 w-7 p-0"
          title="Titre 1"
          @click="markdownActions.heading(getTextareaElement(), 1)"
        >
          <Heading1 class="h-3 w-3" />
        </UiButton>
        <UiButton
          type="button"
          variant="ghost"
          size="sm"
          class="h-7 w-7 p-0"
          title="Titre 2"
          @click="markdownActions.heading(getTextareaElement(), 2)"
        >
          <Heading2 class="h-3 w-3" />
        </UiButton>
        <UiButton
          type="button"
          variant="ghost"
          size="sm"
          class="h-7 w-7 p-0"
          title="Titre 3"
          @click="markdownActions.heading(getTextareaElement(), 3)"
        >
          <Heading3 class="h-3 w-3" />
        </UiButton>
      </div>

      <div class="h-4 w-px bg-border mx-1" />

      <!-- Liens et médias -->
      <div class="flex items-center gap-1">
        <UiButton
          type="button"
          variant="ghost"
          size="sm"
          class="h-7 w-7 p-0"
          title="Lien (Ctrl+K)"
          @click="markdownActions.link(getTextareaElement())"
        >
          <Link class="h-3 w-3" />
        </UiButton>
        <UiButton
          type="button"
          variant="ghost"
          size="sm"
          class="h-7 w-7 p-0"
          title="Image"
          @click="markdownActions.image(getTextareaElement())"
        >
          <Image class="h-3 w-3" />
        </UiButton>
      </div>

      <div class="h-4 w-px bg-border mx-1" />

      <!-- Listes -->
      <div class="flex items-center gap-1">
        <UiButton
          type="button"
          variant="ghost"
          size="sm"
          class="h-7 w-7 p-0"
          title="Liste à puces"
          @click="markdownActions.list(getTextareaElement())"
        >
          <List class="h-3 w-3" />
        </UiButton>
        <UiButton
          type="button"
          variant="ghost"
          size="sm"
          class="h-7 w-7 p-0"
          title="Liste numérotée"
          @click="markdownActions.orderedList(getTextareaElement())"
        >
          <ListOrdered class="h-3 w-3" />
        </UiButton>
      </div>

      <div class="h-4 w-px bg-border mx-1" />

      <!-- Code et citation -->
      <div class="flex items-center gap-1">
        <UiButton
          type="button"
          variant="ghost"
          size="sm"
          class="h-7 w-7 p-0"
          title="Code inline"
          @click="markdownActions.code(getTextareaElement())"
        >
          <Code class="h-3 w-3" />
        </UiButton>
        <UiButton
          type="button"
          variant="ghost"
          size="sm"
          class="h-7 w-7 p-0"
          title="Bloc de code"
          @click="markdownActions.codeBlock(getTextareaElement())"
        >
          <CodeSquare class="h-3 w-3" />
        </UiButton>
        <UiButton
          type="button"
          variant="ghost"
          size="sm"
          class="h-7 w-7 p-0"
          title="Citation"
          @click="markdownActions.quote(getTextareaElement())"
        >
          <Quote class="h-3 w-3" />
        </UiButton>
      </div>

      <div class="h-4 w-px bg-border mx-1" />

      <!-- Éléments structurels -->
      <div class="flex items-center gap-1">
        <UiButton
          type="button"
          variant="ghost"
          size="sm"
          class="h-7 w-7 p-0"
          title="Tableau"
          @click="markdownActions.table(getTextareaElement())"
        >
          <Table class="h-3 w-3" />
        </UiButton>
        <UiButton
          type="button"
          variant="ghost"
          size="sm"
          class="h-7 w-7 p-0"
          title="Ligne horizontale"
          @click="markdownActions.hr(getTextareaElement())"
        >
          <Minus class="h-3 w-3" />
        </UiButton>
      </div>
      
      <div class="h-4 w-px bg-border mx-1" />
      
      <!-- Prévisualisation -->
      <UiButton
        type="button"
        variant="ghost"
        size="sm"
        class="h-7 px-2 text-xs"
        :class="{ 'bg-muted': showPreview }"
        @click="showPreview = !showPreview"
      >
        <Eye v-if="!showPreview" class="h-3 w-3 mr-1" />
        <EyeOff v-else class="h-3 w-3 mr-1" />
        {{ showPreview ? 'Éditer' : 'Préview' }}
      </UiButton>
    </div>

    <!-- Editor & Preview -->
    <div class="grid" :class="previewLayout">
      <!-- Editor -->
      <div v-show="!showPreview || (showPreview && previewMode === 'side')" class="relative">
        <UiTextarea
          ref="textareaRef"
          :model-value="modelValue"
          :placeholder="placeholder"
          :disabled="disabled"
          :class="`font-mono text-xs resize-none border-0 rounded-none focus-visible:ring-0 focus-visible:ring-offset-0 ${textareaClass}`"
          :style="{ minHeight: minHeight + 'px' }"
          @input="handleInput"
          @keydown="handleKeydown"
        />
        
        <!-- Word count -->
        <div v-if="showWordCount" class="absolute bottom-2 right-2 text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded">
          {{ wordCount }} mots
        </div>
      </div>

      <!-- Preview -->
      <div 
        v-show="showPreview" 
        class="border-l bg-background overflow-y-auto"
        :style="{ minHeight: minHeight + 'px' }"
      >
        <div class="p-4">
          <div 
            v-if="modelValue.trim()"
            class="prose prose-sm max-w-none prose-headings:font-semibold prose-h1:text-lg prose-h2:text-base prose-h3:text-sm prose-p:text-xs prose-li:text-xs prose-blockquote:text-xs"
            v-html="htmlContent"
          />
          <div v-else class="text-muted-foreground text-xs italic">
            Prévisualisation du markdown...
          </div>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div v-if="showFooter" class="border-t p-2 text-xs text-muted-foreground bg-muted/30">
      <div class="flex items-center justify-between">
        <span>Markdown supporté</span>
        <span v-if="maxLength">{{ modelValue.length }} / {{ maxLength }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { 
  Bold, 
  Italic, 
  Heading1, 
  Heading2, 
  Heading3,
  Link, 
  List, 
  ListOrdered,
  Quote, 
  Code, 
  CodeSquare,
  Image,
  Table,
  Minus,
  Eye, 
  EyeOff 
} from 'lucide-vue-next'
import { ref, computed, nextTick } from 'vue'

interface Props {
  modelValue: string
  placeholder?: string
  disabled?: boolean
  showToolbar?: boolean
  showWordCount?: boolean
  showFooter?: boolean
  minHeight?: number
  maxLength?: number
  previewMode?: 'side' | 'tab'
  textareaClass?: string
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: 'Tapez votre markdown ici...',
  disabled: false,
  showToolbar: true,
  showWordCount: true,
  showFooter: true,
  minHeight: 600,
  previewMode: 'side',
  textareaClass: ''
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

// Refs
const textareaRef = ref<HTMLTextAreaElement>()
const showPreview = ref(false)

// Composable markdown
const { parseMarkdown, markdownActions } = useMarkdown()

// Computed
const htmlContent = computed(() => parseMarkdown(props.modelValue))

const wordCount = computed(() => {
  return props.modelValue.split(/\s+/).filter(word => word.length > 0).length
})

const previewLayout = computed(() => {
  if (props.previewMode === 'tab') {
    return 'grid-cols-1'
  }
  return showPreview.value ? 'grid-cols-2' : 'grid-cols-1'
})

// Helper function to get the actual textarea element
const getTextareaElement = () => {
  const component = textareaRef.value
  if (!component) return null
  
  // If it's a Vue component, try to access the $el property
  if (component.$el) {
    return component.$el.querySelector('textarea') || component.$el
  }
  
  // If it's already a DOM element
  return component
}

// Actions toolbar
const toolbarActions = computed(() => [
  {
    key: 'bold',
    icon: Bold,
    title: 'Gras (Ctrl+B)',
    handler: () => markdownActions.bold(getTextareaElement())
  },
  {
    key: 'italic', 
    icon: Italic,
    title: 'Italique (Ctrl+I)',
    handler: () => markdownActions.italic(getTextareaElement())
  },
  {
    key: 'heading1',
    icon: Heading1,
    title: 'Titre 1',
    handler: () => markdownActions.heading(getTextareaElement(), 1)
  },
  {
    key: 'heading2',
    icon: Heading2,
    title: 'Titre 2', 
    handler: () => markdownActions.heading(getTextareaElement(), 2)
  },
  {
    key: 'heading3',
    icon: Heading3,
    title: 'Titre 3', 
    handler: () => markdownActions.heading(getTextareaElement(), 3)
  },
  {
    key: 'link',
    icon: Link,
    title: 'Lien (Ctrl+K)',
    handler: () => markdownActions.link(getTextareaElement())
  },
  {
    key: 'image',
    icon: Image,
    title: 'Image',
    handler: () => markdownActions.image(getTextareaElement())
  },
  {
    key: 'list',
    icon: List,
    title: 'Liste à puces',
    handler: () => markdownActions.list(getTextareaElement())
  },
  {
    key: 'orderedList',
    icon: ListOrdered,
    title: 'Liste numérotée',
    handler: () => markdownActions.orderedList(getTextareaElement())
  },
  {
    key: 'quote',
    icon: Quote,
    title: 'Citation',
    handler: () => markdownActions.quote(getTextareaElement())
  },
  {
    key: 'code',
    icon: Code,
    title: 'Code inline',
    handler: () => markdownActions.code(getTextareaElement())
  },
  {
    key: 'codeBlock',
    icon: CodeSquare,
    title: 'Bloc de code',
    handler: () => markdownActions.codeBlock(getTextareaElement())
  },
  {
    key: 'table',
    icon: Table,
    title: 'Tableau',
    handler: () => markdownActions.table(getTextareaElement())
  },
  {
    key: 'hr',
    icon: Minus,
    title: 'Ligne horizontale',
    handler: () => markdownActions.hr(getTextareaElement())
  }
])

// Methods
const handleInput = (event: Event) => {
  const target = event.target as HTMLTextAreaElement
  let value = target.value
  
  // Limiter la longueur si nécessaire
  if (props.maxLength && value.length > props.maxLength) {
    value = value.substring(0, props.maxLength)
    target.value = value
  }
  
  emit('update:modelValue', value)
}

const handleKeydown = (event: KeyboardEvent) => {
  // Raccourcis clavier
  if (event.ctrlKey || event.metaKey) {
    switch (event.key) {
      case 'b':
        event.preventDefault()
        markdownActions.bold(getTextareaElement())
        break
      case 'i':
        event.preventDefault()
        markdownActions.italic(getTextareaElement())
        break
      case 'k':
        event.preventDefault()
        markdownActions.link(getTextareaElement())
        break
    }
  }
  
  // Auto-indentation pour les listes
  if (event.key === 'Enter') {
    const textarea = getTextareaElement()
    if (!textarea || textarea.value === undefined || textarea.value === null) return
    
    const start = textarea.selectionStart || 0
    const value = textarea.value
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const currentLine = value.substring(lineStart, start)
    
    // Détecter si on est dans une liste
    const listMatch = currentLine.match(/^(\s*[-*+]\s+)/)
    if (listMatch) {
      event.preventDefault()
      const indent = listMatch[1]
      const newValue = value.substring(0, start) + '\n' + indent + value.substring(start)
      textarea.value = newValue
      textarea.setSelectionRange(start + 1 + indent.length, start + 1 + indent.length)
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    }
  }
}

// Focus method for external access
const focus = () => {
  nextTick(() => {
    textareaRef.value?.focus()
  })
}

defineExpose({
  focus,
  textareaRef
})
</script>

<style scoped>
/* Styles pour le markdown preview */
.prose :deep(h1) {
  @apply text-lg font-semibold mt-4 mb-2 first:mt-0;
}

.prose :deep(h2) {
  @apply text-base font-semibold mt-3 mb-2;
}

.prose :deep(h3) {
  @apply text-sm font-medium mt-2 mb-1;
}

.prose :deep(p) {
  @apply text-xs mb-3 leading-relaxed;
}

.prose :deep(ul),
.prose :deep(ol) {
  @apply text-xs mb-3 pl-4;
}

.prose :deep(li) {
  @apply mb-1;
}

.prose :deep(blockquote) {
  @apply text-xs border-l-2 border-muted-foreground/30 pl-3 italic text-muted-foreground;
}

.prose :deep(code) {
  @apply text-xs bg-muted px-1 py-0.5 rounded font-mono;
}

.prose :deep(pre) {
  @apply text-xs bg-muted p-3 rounded-md overflow-x-auto;
}

.prose :deep(strong) {
  @apply font-semibold;
}

.prose :deep(em) {
  @apply italic;
}

.prose :deep(a) {
  @apply text-primary underline;
}
</style>