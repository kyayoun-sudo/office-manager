<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, X, Search, ChevronsUpDown } from 'lucide-vue-next'
import { cn } from '@/lib/utils'

interface UserOption {
  value: number
  label: string
  email: string
  role: string
  preferredLanguages: string[]
}

interface Props {
  modelValue: number[]
  users: UserOption[]
  multiple?: boolean
  label?: string
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  emptyMessage?: string
  isLoading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  multiple: true,
  label: 'Utilisateurs',
  placeholder: 'Selectionner des utilisateurs...',
  searchPlaceholder: 'Rechercher par nom, email ou role...',
  emptyText: 'Aucun utilisateur trouve.',
  emptyMessage: 'Aucun utilisateur selectionne',
  isLoading: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: number[]]
}>()

const searchQuery = ref('')
const open = ref(false)

const selectedIds = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const selectedUsers = computed(() =>
  selectedIds.value
    .map((id) => props.users.find((user) => user.value === id))
    .filter(Boolean) as UserOption[],
)

const selectedValue = computed({
  get: () =>
    props.multiple ? null : props.users.find((u) => u.value === selectedIds.value[0]) || null,
  set: (user: UserOption | null) => {
    if (!props.multiple) selectedIds.value = user ? [user.value] : []
  },
})

const filteredUsers = computed(() => {
  if (!searchQuery.value.trim()) return props.users.slice(0, 20)
  const query = searchQuery.value.toLowerCase().trim()
  return props.users
    .filter(
      (user) =>
        user.label.toLowerCase().includes(query) ||
        user.email.toLowerCase().includes(query) ||
        user.role.toLowerCase().includes(query),
    )
    .slice(0, 50)
})

const getSingleDisplayValue = (user: UserOption | null) => (user ? user.label : '')

const handleSingleSelect = (user: UserOption, close: () => void) => {
  selectedValue.value = user
  close()
}

const isSelected = (userId: number) => selectedIds.value.includes(userId)

const toggleUser = (user: UserOption) => {
  if (isSelected(user.value)) {
    selectedIds.value = selectedIds.value.filter((id) => id !== user.value)
  } else {
    selectedIds.value = [...selectedIds.value, user.value]
  }
}

const removeUser = (userId: number) => {
  selectedIds.value = selectedIds.value.filter((id) => id !== userId)
}

const clearAll = () => {
  selectedIds.value = []
}
</script>

<template>
  <div class="space-y-2">
    <UiLabel v-if="label" class="text-xs font-medium">{{ label }}</UiLabel>

    <!-- Mode Single -->
    <UiCombobox
      v-if="!multiple"
      v-model="selectedValue"
      :placeholder="placeholder"
      :search-placeholder="searchPlaceholder"
      :empty-text="emptyText"
      :get-display-value="getSingleDisplayValue"
      class="w-full"
      @update:search="searchQuery = $event"
    >
      <template #options="{ close }">
        <UiCommandItem
          v-for="user in filteredUsers"
          :key="user.value"
          :value="user"
          class="cursor-pointer"
          @select="handleSingleSelect(user, close)"
        >
          <Check
            :class="cn('mr-2 h-3.5 w-3.5', selectedValue?.value === user.value ? 'opacity-100' : 'opacity-0')"
          />
          <div class="flex-1">
            <span class="text-sm">{{ user.label }}</span>
            <span class="ml-2 text-xs text-muted-foreground">{{ user.email }}</span>
          </div>
        </UiCommandItem>
      </template>
    </UiCombobox>

    <!-- Mode Multiple -->
    <template v-else>
      <UiPopover v-model:open="open">
        <UiPopoverTrigger as-child>
          <button
            type="button"
            role="combobox"
            :aria-expanded="open"
            class="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 text-sm shadow-sm transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <span v-if="selectedUsers.length === 0" class="text-muted-foreground">{{ placeholder }}</span>
            <span v-else class="text-sm">
              {{ selectedUsers.length }} utilisateur{{ selectedUsers.length > 1 ? 's' : '' }}
            </span>
            <ChevronsUpDown class="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
          </button>
        </UiPopoverTrigger>
        <UiPopoverContent class="w-[--radix-popover-trigger-width] p-0" align="start">
          <UiCommand>
            <UiCommandInput
              :placeholder="searchPlaceholder"
              :model-value="searchQuery"
              @update:model-value="searchQuery = $event"
            />
            <UiCommandEmpty>{{ emptyText }}</UiCommandEmpty>
            <UiCommandList>
              <UiCommandGroup>
                <div v-if="isLoading" class="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                  <div class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  Chargement...
                </div>
                <template v-else>
                  <UiCommandItem
                    v-for="user in filteredUsers"
                    :key="user.value"
                    :value="user.value"
                    class="cursor-pointer"
                    @select="toggleUser(user)"
                  >
                    <div class="flex w-full items-center gap-2">
                      <div
                        class="flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors"
                        :class="isSelected(user.value) ? 'border-primary bg-primary text-primary-foreground' : 'border-border'"
                      >
                        <Check v-if="isSelected(user.value)" class="h-3 w-3" />
                      </div>
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5">
                          <span class="truncate text-sm">{{ user.label }}</span>
                          <span class="shrink-0 text-[10px] text-muted-foreground">{{ user.role }}</span>
                        </div>
                        <p class="truncate text-xs text-muted-foreground">{{ user.email }}</p>
                      </div>
                    </div>
                  </UiCommandItem>
                </template>
              </UiCommandGroup>
            </UiCommandList>
          </UiCommand>
        </UiPopoverContent>
      </UiPopover>

      <!-- Selection chips -->
      <div v-if="selectedUsers.length > 0" class="flex flex-wrap items-center gap-1.5">
        <div
          v-for="user in selectedUsers"
          :key="user.value"
          class="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-xs"
        >
          <span class="max-w-[140px] truncate">{{ user.label }}</span>
          <button
            type="button"
            class="ml-0.5 rounded-sm text-muted-foreground transition-colors hover:text-destructive"
            :title="`Retirer ${user.label}`"
            @click="removeUser(user.value)"
          >
            <X class="h-3 w-3" />
          </button>
        </div>
        <button
          v-if="selectedUsers.length > 1"
          type="button"
          class="text-[10px] text-muted-foreground transition-colors hover:text-destructive"
          @click="clearAll"
        >
          Tout effacer
        </button>
      </div>

      <p v-else class="text-[11px] text-muted-foreground">{{ emptyMessage }}</p>
    </template>
  </div>
</template>
