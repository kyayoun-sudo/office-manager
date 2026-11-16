<script setup lang="ts">
import { Search, FileText, ArrowRight } from 'lucide-vue-next'
import type { NavGroup } from '#shared/types/nav'

const props = defineProps<{
  navGroups: NavGroup[]
}>()

const router = useRouter()
const route = useRoute()
const open = ref(false)

const isMac = computed(() => {
  if (import.meta.server) return false
  return navigator.userAgent.includes('Mac')
})

const flatItems = computed(() =>
  props.navGroups.flatMap(g =>
    g.navItems.flatMap(item => {
      const items: { title: string; url: string; icon: any; group: string }[] = []
      if (item.url && typeof item.url === 'string') {
        items.push({ title: item.title, url: item.url, icon: item.icon, group: g.group })
      }
      if (item.items) {
        item.items.forEach(sub => {
          if (sub.url && typeof sub.url === 'string') {
            items.push({ title: sub.title, url: sub.url, icon: sub.icon || item.icon, group: g.group })
          }
        })
      }
      return items
    })
  )
)

const currentPageTitle = computed(() => {
  const match = flatItems.value.find(item => {
    if (item.url === '/' && route.path === '/') return true
    return item.url !== '/' && route.path.startsWith(item.url)
  })
  return match?.title || ''
})

const handleSelect = (url: string) => {
  open.value = false
  router.push(url)
}

onMounted(() => {
  const onKeydown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      open.value = !open.value
    }
  }
  window.addEventListener('keydown', onKeydown)
  onUnmounted(() => window.removeEventListener('keydown', onKeydown))
})
</script>

<template>
  <button
    class="inline-flex h-9 w-full max-w-sm items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground/70 shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    @click="open = true"
  >
    <Search class="h-4 w-4 shrink-0" />
    <span class="flex-1 text-left">Rechercher...</span>
    <kbd class="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:flex">
      {{ isMac ? '⌘' : 'Ctrl+' }}K
    </kbd>
  </button>

  <UiCommandDialog :open="open" @update:open="open = $event">
    <UiCommandInput placeholder="Rechercher une page..." />
    <UiCommandList class="max-h-[360px]">
      <UiCommandEmpty>
        <div class="flex flex-col items-center gap-2 py-4 text-muted-foreground">
          <Search class="h-10 w-10 opacity-20" />
          <p>Aucun resultat trouve.</p>
        </div>
      </UiCommandEmpty>

      <template v-for="group in navGroups" :key="group.group">
        <UiCommandGroup :heading="group.group">
          <template v-for="item in group.navItems" :key="item.title">
            <UiCommandItem
              v-if="item.url && typeof item.url === 'string'"
              :value="item.title"
              class="gap-3"
              @select="handleSelect(item.url as string)"
            >
              <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                <component :is="item.icon" v-if="item.icon" class="h-4 w-4 text-muted-foreground" />
                <FileText v-else class="h-4 w-4 text-muted-foreground" />
              </div>
              <div class="flex flex-1 items-center justify-between">
                <span>{{ item.title }}</span>
                <ArrowRight class="h-3.5 w-3.5 text-muted-foreground/50" />
              </div>
            </UiCommandItem>

            <template v-if="item.items">
              <UiCommandItem
                v-for="sub in item.items"
                :key="sub.title"
                :value="`${item.title} ${sub.title}`"
                class="gap-3"
                @select="handleSelect(sub.url as string)"
              >
                <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                  <component :is="sub.icon || item.icon" v-if="sub.icon || item.icon" class="h-4 w-4 text-muted-foreground" />
                  <FileText v-else class="h-4 w-4 text-muted-foreground" />
                </div>
                <div class="flex flex-1 items-center justify-between">
                  <span>{{ sub.title }}</span>
                  <ArrowRight class="h-3.5 w-3.5 text-muted-foreground/50" />
                </div>
              </UiCommandItem>
            </template>
          </template>
        </UiCommandGroup>
      </template>
    </UiCommandList>

    <div class="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
      <div class="flex items-center gap-3">
        <span class="flex items-center gap-1">
          <kbd class="rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">↑↓</kbd>
          naviguer
        </span>
        <span class="flex items-center gap-1">
          <kbd class="rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">↵</kbd>
          ouvrir
        </span>
        <span class="flex items-center gap-1">
          <kbd class="rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">esc</kbd>
          fermer
        </span>
      </div>
    </div>
  </UiCommandDialog>
</template>
