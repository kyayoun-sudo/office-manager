<template>
  <div
    role="alert"
    :class="cn(alertVariants({ variant }), className)"
  >
    <slot />
  </div>
</template>

<script setup lang="ts">
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const alertVariants = cva(
  'relative w-full rounded-lg border p-4 [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground',
  {
    variants: {
      variant: {
        default: 'bg-background text-foreground',
        destructive:
          'border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive',
        warning: 'border-orange-500/50 text-orange-600 dark:border-orange-500 [&>svg]:text-orange-600',
        success: 'border-green-500/50 text-green-600 dark:border-green-500 [&>svg]:text-green-600',
        info: 'border-blue-500/50 text-blue-600 dark:border-blue-500 [&>svg]:text-blue-600',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

interface Props {
  class?: string
  variant?: 'default' | 'destructive' | 'warning' | 'success' | 'info'
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default'
})

const className = computed(() => props.class)
</script>