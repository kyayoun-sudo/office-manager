<script setup lang="ts">
import {
  ChartAreaIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  LogOutIcon,
  UserRoundCheckIcon,
  Stethoscope,
  CreditCard,
  Receipt,
  Banknote,
  Bell,
  HelpCircle,
  FileText,
  Calendar,
  Shield,
  Globe,
  Baby,
  Slash,
  FolderTree,
  MapPin,
} from 'lucide-vue-next'
import type { NavGroup } from '#shared/types/nav'

const route = useRoute()
const { user: authUser, logout } = useAuth()

const handleLogout = async () => {
  await logout()
}

// Check if route is active
const isActiveRoute = (url: string) => {
  if (import.meta.client && route) {
    if (url === '/' && route.path === '/') return true
    if (url !== '/' && route.path.startsWith(url)) return true
  }
  return false
}

// User data from authentication
const user = computed(() => {
  const userData = authUser.value?.data || authUser.value
  const firstName = userData?.firstName
  const lastName = userData?.lastName
  const email = userData?.email

  return {
    name: firstName && lastName ? `${firstName} ${lastName}` : 'Utilisateur',
    email: email || '',
    avatar: firstName && lastName ? `https://api.dicebear.com/7.x/initials/svg?seed=${firstName} ${lastName}` : '/avatars/01.png',
  }
})

const currentPageTitle = computed(() => {
  const allItems = navMain.flatMap(g =>
    g.navItems.flatMap(item => {
      const items: { title: string; url: string }[] = []
      if (item.url && typeof item.url === 'string') items.push({ title: item.title, url: item.url })
      if (item.items) item.items.forEach(sub => {
        if (sub.url && typeof sub.url === 'string') items.push({ title: sub.title, url: sub.url })
      })
      return items
    })
  )
  const match = allItems.find(item => {
    if (item.url === '/' && route.path === '/') return true
    return item.url !== '/' && route.path.startsWith(item.url)
  })
  return match?.title || ''
})

const navMain: NavGroup[] = [
  {
    group: 'Tableau de bord',
    navItems: [
      {
        title: 'Dashboard',
        url: '/',
        icon: ChartAreaIcon,
      },
    ],
  },
  {
    group: 'Gestion',
    navItems: [
      {
        title: 'Utilisateurs',
        url: '/users',
        icon: UserRoundCheckIcon,
      },
      {
        title: 'Rendez-vous',
        url: '/appointments',
        icon: Calendar,
      },
    ],
  },
  {
    group: 'Facturation',
    navItems: [
      {
        title: 'Plans d\'abonnement',
        url: '/plans',
        icon: CreditCard,
      },
      {
        title: 'Abonnements',
        url: '/subscriptions',
        icon: Receipt,
      },
      {
        title: 'Paiements',
        url: '/payments',
        icon: Banknote,
      },
    ],
  },
  {
    group: 'Communication',
    navItems: [
      {
        title: 'Notifications',
        url: '/notifications',
        icon: Bell,
      },
      {
        title: 'Support Tickets',
        url: '/support-tickets',
        icon: HelpCircle,
      },
      {
        title: 'Documents',
        url: '/documents',
        icon: FileText,
      },
    ],
  },
  {
    group: 'Configuration',
    navItems: [
      {
        title: 'Categories',
        url: '/categories',
        icon: FolderTree,
      },
      {
        title: 'Specialites',
        url: '/specialties',
        icon: Stethoscope,
      },
      {
        title: 'Assurances',
        url: '/insurances',
        icon: Shield,
      },
      {
        title: 'Villes',
        url: '/cities',
        icon: MapPin,
      },
      {
        title: 'Langues',
        url: '/languages',
        icon: Globe,
      },
      {
        title: 'Motifs de rejet',
        url: '/rejection-reasons',
        icon: Slash,
      },
      {
        title: 'Types d\'accouchement',
        url: '/delivery-types',
        icon: Baby,
      },
      {
        title: 'Types d\'allaitement',
        url: '/breastfeeding-types',
        icon: Baby,
      },
      {
        title: 'Quantiemes d\'accouchement',
        url: '/delivery-parities',
        icon: Baby,
      },
    ],
  },
]

</script>

<template>
  <UiSidebarProvider>
    <UiSidebar collapsible="icon">
      <UiSidebarHeader>
        <UiSidebarMenu>
          <UiSidebarMenuItem>
            <UiSidebarMenuButton size="lg" class="pointer-events-none">
              <div class="flex aspect-square size-8 items-center justify-center rounded-lg">
                <img 
                  src="/placeholder.svg" 
                  alt="Exemple" 
                  class="size-8 object-contain"
                >
              </div>
              <div class="grid flex-1 text-left text-sm leading-tight">
                <span class="truncate font-semibold text-primary">
                  Exemple
                </span>
                <span class="truncate text-xs">Manager</span>
              </div>
            </UiSidebarMenuButton>
          </UiSidebarMenuItem>
        </UiSidebarMenu>
      </UiSidebarHeader>

      <UiSidebarContent>
        <UiSidebarGroup v-for="navGroup in navMain" :key="navGroup.group">
          <UiSidebarGroupLabel>{{ navGroup.group }}</UiSidebarGroupLabel>
          <UiSidebarGroupContent>
            <UiSidebarMenu>
              <template v-for="navItem in navGroup.navItems" :key="navItem.title">
                <!-- Item with sub-items (collapsible) -->
                <UiCollapsible
                  v-if="navItem.items"
                  as-child
                  :default-open="navItem.isActive"
                  class="group/collapsible"
                >
                  <UiSidebarMenuItem>
                    <UiCollapsibleTrigger as-child>
                      <UiSidebarMenuButton :tooltip="navItem.title">
                        <component :is="navItem.icon" />
                        <span>{{ navItem.title }}</span>
                        <ChevronRightIcon
                          class="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90"
                        />
                      </UiSidebarMenuButton>
                    </UiCollapsibleTrigger>
                    <UiCollapsibleContent>
                      <UiSidebarMenuSub>
                        <UiSidebarMenuSubItem
                          v-for="subItem in navItem.items"
                          :key="subItem.title"
                        >
                          <UiSidebarMenuSubButton
                            as-child
                            :is-active="isActiveRoute(subItem.url)"
                          >
                            <NuxtLink :to="subItem.url">
                              <span>{{ subItem.title }}</span>
                            </NuxtLink>
                          </UiSidebarMenuSubButton>
                        </UiSidebarMenuSubItem>
                      </UiSidebarMenuSub>
                    </UiCollapsibleContent>
                  </UiSidebarMenuItem>
                </UiCollapsible>

                <!-- Simple item (no sub-items) -->
                <UiSidebarMenuItem v-else>
                  <UiSidebarMenuButton
                    as-child
                    :is-active="isActiveRoute(navItem.url)"
                    :tooltip="navItem.title"
                  >
                    <NuxtLink :to="navItem.url">
                      <component :is="navItem.icon" />
                      <span>{{ navItem.title }}</span>
                    </NuxtLink>
                  </UiSidebarMenuButton>
                </UiSidebarMenuItem>
              </template>
            </UiSidebarMenu>
          </UiSidebarGroupContent>
        </UiSidebarGroup>
      </UiSidebarContent>

      <UiSidebarFooter>
        <UiSidebarMenu>
          <UiSidebarMenuItem>
            <UiDropdownMenu>
              <UiDropdownMenuTrigger as-child>
                <UiSidebarMenuButton
                  size="lg"
                  class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <UiAvatar class="h-8 w-8 rounded-lg">
                    <UiAvatarImage :src="user.avatar" :alt="user.name" />
                    <UiAvatarFallback class="rounded-lg">
                      {{ (authUser?.data?.firstName || authUser?.firstName || '')?.charAt(0) }}{{ (authUser?.data?.lastName || authUser?.lastName || '')?.charAt(0) }}
                    </UiAvatarFallback>
                  </UiAvatar>
                  <div class="grid flex-1 text-left text-sm leading-tight">
                    <span class="truncate font-semibold">{{ user.name }}</span>
                    <span class="truncate text-xs">{{ user.email }}</span>
                  </div>
                  <ChevronsUpDownIcon class="ml-auto size-4" />
                </UiSidebarMenuButton>
              </UiDropdownMenuTrigger>
              <UiDropdownMenuContent
                class="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                side="bottom"
                align="end"
                :side-offset="4"
              >
                <UiDropdownMenuLabel class="p-0 font-normal">
                  <div
                    class="flex items-center gap-2 px-1 py-1.5 text-left text-sm"
                  >
                    <UiAvatar class="h-8 w-8 rounded-lg">
                      <UiAvatarImage :src="user.avatar" :alt="user.name" />
                      <UiAvatarFallback class="rounded-lg">
                        {{ (authUser?.data?.firstName || authUser?.firstName || '')?.charAt(0) }}{{ (authUser?.data?.lastName || authUser?.lastName || '')?.charAt(0) }}
                      </UiAvatarFallback>
                    </UiAvatar>
                    <div class="grid flex-1 text-left text-sm leading-tight">
                      <span class="truncate font-semibold">{{
                        user.name
                      }}</span>
                      <span class="truncate text-xs">{{ user.email }}</span>
                    </div>
                  </div>
                </UiDropdownMenuLabel>
                <UiDropdownMenuSeparator />
                <UiDropdownMenuItem class="text-destructive focus:text-destructive" @click="handleLogout">
                  <LogOutIcon />
                  Déconnexion
                </UiDropdownMenuItem>
              </UiDropdownMenuContent>
            </UiDropdownMenu>
          </UiSidebarMenuItem>
        </UiSidebarMenu>
      </UiSidebarFooter>
      <UiSidebarRail />
    </UiSidebar>

    <UiSidebarInset>
      <header
        class="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12"
      >
        <div class="flex w-full items-center gap-2 px-4">
          <UiSidebarTrigger class="-ml-1" />
          <UiSeparator orientation="vertical" class="mr-2 h-4" />

          <UiBreadcrumb>
            <UiBreadcrumbList>
              <UiBreadcrumbItem>
                <UiBreadcrumbLink as-child>
                  <NuxtLink to="/">Exemple</NuxtLink>
                </UiBreadcrumbLink>
              </UiBreadcrumbItem>
              <UiBreadcrumbSeparator>
                <Slash class="h-4 w-4" />
              </UiBreadcrumbSeparator>
              <UiBreadcrumbItem>
                <UiBreadcrumbPage>{{ currentPageTitle || 'Dashboard' }}</UiBreadcrumbPage>
              </UiBreadcrumbItem>
            </UiBreadcrumbList>
          </UiBreadcrumb>

          <div class="ml-auto flex items-center gap-2">
            <GlobalSearch :nav-groups="navMain" />
            <AppColorMode />
          </div>
        </div>
      </header>
      <div class="min-h-[calc(100vh-64px)] p-4 pt-0">
        <slot />
      </div>
    </UiSidebarInset>
  </UiSidebarProvider>
</template>
