<script setup lang="ts">
import { MoonStarIcon, SunIcon, MonitorIcon } from 'lucide-vue-next'

const colorMode = useColorMode()

const setMode = (mode: 'light' | 'dark' | 'system') => {
  colorMode.preference = mode
}

const currentIcon = computed(() => {
  if (colorMode.preference === 'dark') return MoonStarIcon
  if (colorMode.preference === 'light') return SunIcon
  return MonitorIcon
})
</script>

<template>
  <UiDropdownMenu>
    <UiDropdownMenuTrigger as-child>
      <UiButton variant="ghost" size="icon">
        <component :is="currentIcon" class="h-5 w-5" />
        <span class="sr-only">Changer le theme</span>
      </UiButton>
    </UiDropdownMenuTrigger>
    <UiDropdownMenuContent align="end" class="w-40">
      <UiDropdownMenuItem
        :class="{ 'bg-accent': colorMode.preference === 'light' }"
        @click="setMode('light')"
      >
        <SunIcon class="mr-2 h-4 w-4" />
        Clair
      </UiDropdownMenuItem>
      <UiDropdownMenuItem
        :class="{ 'bg-accent': colorMode.preference === 'dark' }"
        @click="setMode('dark')"
      >
        <MoonStarIcon class="mr-2 h-4 w-4" />
        Sombre
      </UiDropdownMenuItem>
      <UiDropdownMenuSeparator />
      <UiDropdownMenuItem
        :class="{ 'bg-accent': colorMode.preference === 'system' }"
        @click="setMode('system')"
      >
        <MonitorIcon class="mr-2 h-4 w-4" />
        Systeme
      </UiDropdownMenuItem>
    </UiDropdownMenuContent>
  </UiDropdownMenu>
</template>
