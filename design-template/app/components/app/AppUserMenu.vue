<script setup lang="ts">
const { user, logout } = useAuth()

const handleLogout = async () => {
  await logout()
}
</script>

<template>
  <UiDropdownMenu>
    <UiDropdownMenuTrigger as-child>
      <UiButton variant="ghost" class="relative h-8 w-8 rounded-full">
        <UiAvatar class="h-8 w-8">
          <UiAvatarImage 
            :src="`https://api.dicebear.com/7.x/initials/svg?seed=${user?.firstName} ${user?.lastName}`" 
            :alt="user?.firstName" 
          />
          <UiAvatarFallback>
            {{ user?.firstName?.charAt(0) }}{{ user?.lastName?.charAt(0) }}
          </UiAvatarFallback>
        </UiAvatar>
      </UiButton>
    </UiDropdownMenuTrigger>
    
    <UiDropdownMenuContent class="w-56" align="end" :side-offset="4">
      <UiDropdownMenuLabel class="font-normal">
        <div class="flex flex-col space-y-1">
          <p class="text-sm font-medium leading-none">
            {{ user?.firstName }} {{ user?.lastName }}
          </p>
          <p class="text-xs leading-none text-muted-foreground">
            {{ user?.email }}
          </p>
        </div>
      </UiDropdownMenuLabel>
      
      <UiDropdownMenuSeparator />
      
      <UiDropdownMenuGroup>
        <UiDropdownMenuItem>
          <NuxtLink to="/profile" class="flex items-center w-full">
            <Icon name="lucide:user" class="mr-2 h-4 w-4" />
            <span>Profil</span>
          </NuxtLink>
        </UiDropdownMenuItem>
      </UiDropdownMenuGroup>
      
      <UiDropdownMenuSeparator />
      
      <UiDropdownMenuItem class="text-destructive focus:text-destructive" @click="handleLogout">
        <Icon name="lucide:log-out" class="mr-2 h-4 w-4" />
        <span>Déconnexion</span>
      </UiDropdownMenuItem>
    </UiDropdownMenuContent>
  </UiDropdownMenu>
</template>