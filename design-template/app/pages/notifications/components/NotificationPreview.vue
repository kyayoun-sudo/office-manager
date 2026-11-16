<script setup lang="ts">
import { Bell, Wifi, Battery, Signal } from 'lucide-vue-next'

interface Props {
  title: string
  body: string
  appName?: string
}

withDefaults(defineProps<Props>(), {
  appName: 'Exemple',
})

const now = new Date()
const timeString = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
</script>

<template>
  <div class="mx-auto w-full max-w-[20rem]">
    <div class="relative overflow-hidden rounded-[1.5rem] border-2 border-foreground/10 bg-gradient-to-b from-zinc-900 to-zinc-950 shadow-xl">
      <div class="absolute inset-x-0 top-0 z-10 flex items-center justify-center pt-1.5">
        <div class="h-3.5 w-16 rounded-full bg-black" />
      </div>

      <div class="flex items-center justify-between px-4 pt-6 pb-0.5 text-white/80">
        <span class="text-[10px] font-semibold tabular-nums">{{ timeString }}</span>
        <div class="flex items-center gap-0.5">
          <Signal class="h-2.5 w-2.5" />
          <Wifi class="h-2.5 w-2.5" />
          <Battery class="h-3 w-3" />
        </div>
      </div>

      <div class="px-2 pb-4 pt-3">
        <div
          class="rounded-xl border border-white/10 bg-white/[0.08] p-2.5 backdrop-blur-xl transition-all duration-300"
          :class="(title || body) ? 'shadow-lg shadow-white/5' : 'opacity-50'"
        >
          <div class="flex items-start gap-2">
            <div class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-emerald-500/90">
              <Bell class="h-3 w-3 text-white" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between">
                <p class="text-[8px] font-semibold uppercase tracking-wider text-white/50">
                  {{ appName }}
                </p>
                <span class="text-[7px] text-white/30">now</span>
              </div>
              <p class="mt-0.5 text-[11px] font-semibold leading-tight text-white/90 line-clamp-1">
                {{ title || 'Titre de la notification' }}
              </p>
              <p class="mt-0.5 text-[9px] leading-snug text-white/50 line-clamp-2">
                {{ body || 'Le contenu du message apparaitra ici...' }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div class="flex justify-center pb-2">
        <div class="h-0.5 w-20 rounded-full bg-white/20" />
      </div>
    </div>
  </div>
</template>
