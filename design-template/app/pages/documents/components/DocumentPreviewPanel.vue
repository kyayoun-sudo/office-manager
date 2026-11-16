<script setup lang="ts">
import { Eye, FileText } from 'lucide-vue-next'

interface Props {
  translationsData: Record<string, Record<string, string>>
  activeLanguage?: string
  languages?: Array<{ code: string; name: string; flag: string }>
}

const props = withDefaults(defineProps<Props>(), {
  activeLanguage: 'fr',
  languages: () => [
    { code: 'fr', name: 'Francais', flag: '\u{1F1EB}\u{1F1F7}' },
    { code: 'en', name: 'English', flag: '\u{1F1EC}\u{1F1E7}' },
    { code: 'nl', name: 'Nederlands', flag: '\u{1F1F3}\u{1F1F1}' },
  ],
})

const previewLang = ref(props.activeLanguage)
const { parseMarkdown } = useMarkdown()

const currentTitle = computed(() => {
  return props.translationsData[previewLang.value]?.title || ''
})

const currentContent = computed(() => {
  const raw = props.translationsData[previewLang.value]?.content || ''
  return raw ? parseMarkdown(raw) : ''
})

const isEmpty = computed(() => !currentTitle.value && !props.translationsData[previewLang.value]?.content)
</script>

<template>
  <div class="flex flex-col h-full bg-muted/20">
    <div class="flex items-center justify-between border-b px-4 py-2.5 bg-background">
      <div class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Eye class="h-4 w-4" />
        <span>Apercu</span>
      </div>
      <div class="flex gap-1">
        <button
          v-for="lang in languages"
          :key="lang.code"
          type="button"
          class="px-2.5 py-1 text-xs font-medium rounded-md transition-colors"
          :class="previewLang === lang.code
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'"
          @click="previewLang = lang.code"
        >
          {{ lang.flag }} {{ lang.code.toUpperCase() }}
        </button>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto p-6">
      <template v-if="!isEmpty">
        <h1
          v-if="currentTitle"
          class="text-xl font-bold mb-4 pb-3 border-b"
        >
          {{ currentTitle }}
        </h1>
        <div
          v-if="currentContent"
          class="prose prose-sm max-w-none prose-headings:font-semibold prose-h1:text-lg prose-h2:text-base prose-h3:text-sm prose-p:text-sm prose-li:text-sm prose-blockquote:text-sm"
          v-html="currentContent"
        />
      </template>

      <div v-else class="flex flex-col items-center justify-center h-full text-muted-foreground py-16">
        <FileText class="h-12 w-12 mb-3 opacity-30" />
        <p class="text-sm">Commencez a ecrire pour voir l'apercu</p>
        <p class="text-xs mt-1 opacity-60">
          Le contenu markdown sera rendu ici en temps reel
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
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
  @apply text-sm mb-3 leading-relaxed;
}
.prose :deep(ul),
.prose :deep(ol) {
  @apply text-sm mb-3 pl-4;
}
.prose :deep(li) {
  @apply mb-1;
}
.prose :deep(blockquote) {
  @apply text-sm border-l-2 border-muted-foreground/30 pl-3 italic text-muted-foreground;
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
