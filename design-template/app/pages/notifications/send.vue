<script setup lang="ts">
import type {
  I18nContentDto,
  FirebaseTopic,
  SendNotificationRequest,
  SendMultipleNotificationsRequest,
  SendTopicNotificationRequest,
} from '~~/shared/types/notification'
import { ArrowLeft, Send, Users, Radio, Loader2, Globe, CheckCircle2 } from 'lucide-vue-next'

useHead({ title: 'Envoyer une notification - Modèle d’administration' })

const toast = useToast()
const {
  sendNotification,
  sendMultipleNotifications,
  sendTopicNotification,
  getEstimatedTopicUsers,
} = useNotifications()

const {
  users,
  isLoading: usersLoading,
  fetchUsers,
} = useUsers()

const targetType = ref<'users' | 'topic'>('users')
const selectedUserIds = ref<number[]>([])
const selectedTopic = ref<FirebaseTopic>('all_users')
const isSending = ref(false)
const activeLang = ref<'fr' | 'en' | 'nl'>('fr')

const form = ref({
  fr: { title: '', body: '' },
  en: { title: '', body: '' },
  nl: { title: '', body: '' },
})

const languages = [
  { code: 'fr' as const, name: 'FR', flag: '\u{1F1EB}\u{1F1F7}' },
  { code: 'en' as const, name: 'EN', flag: '\u{1F1EC}\u{1F1E7}' },
  { code: 'nl' as const, name: 'NL', flag: '\u{1F1F3}\u{1F1F1}' },
]

const isLangComplete = (code: 'fr' | 'en' | 'nl') =>
  !!form.value[code].title.trim() && !!form.value[code].body.trim()

const topicOptions: { value: FirebaseTopic; label: string }[] = [
  { value: 'all_users', label: 'Tous les utilisateurs' },
  { value: 'clinicians', label: 'Sage-femmes' },
  { value: 'patients', label: 'Patientes' },
]

const availableUsers = computed(() => {
  if (!users.value || !Array.isArray(users.value)) return []
  return users.value.map((user) => ({
    value: user.id,
    label: `${user.firstName} ${user.lastName}`,
    email: user.email,
    role: user.role?.name || user.role?.code || 'user',
    preferredLanguages: user.preferredLanguages || ['fr'],
  }))
})

const previewTitle = computed(() => form.value[activeLang.value]?.title || '')
const previewBody = computed(() => form.value[activeLang.value]?.body || '')

const canSend = computed(() => {
  const hasContent = !!form.value.fr.title.trim() && !!form.value.fr.body.trim()
    && !!form.value.en.title.trim() && !!form.value.en.body.trim()
  if (targetType.value === 'users') return hasContent && selectedUserIds.value.length > 0
  return hasContent
})

const buildI18nContent = (field: 'title' | 'body'): I18nContentDto => ({
  fr: form.value.fr[field],
  en: form.value.en[field],
  nl: form.value.nl[field],
})

const handleSend = async () => {
  if (!canSend.value) {
    if (targetType.value === 'users' && selectedUserIds.value.length === 0) {
      toast.handleApiError({ success: false, error: 'Veuillez selectionner au moins un utilisateur' }, 'Erreur')
      return
    }
    toast.handleApiError({ success: false, error: 'Le titre et le message en francais et anglais sont obligatoires' }, 'Erreur')
    return
  }

  isSending.value = true
  try {
    let success = false
    const title = buildI18nContent('title')
    const body = buildI18nContent('body')

    if (targetType.value === 'topic') {
      success = await sendTopicNotification({ topic: selectedTopic.value, title, body })
      if (success) toast.handleApiSuccess(`Notification envoyee au topic (~${getEstimatedTopicUsers(selectedTopic.value)} utilisateurs)`)
    } else if (selectedUserIds.value.length === 1) {
      success = await sendNotification({ userId: selectedUserIds.value[0]!, title, body })
      if (success) toast.handleApiSuccess('Notification envoyee avec succes')
    } else {
      success = await sendMultipleNotifications({ userIds: selectedUserIds.value, title, body })
      if (success) toast.handleApiSuccess(`Notification envoyee a ${selectedUserIds.value.length} utilisateurs`)
    }

    if (success) await navigateTo('/notifications')
    else toast.handleApiError({ success: false, error: 'Impossible d\'envoyer la notification' }, 'Erreur')
  } catch (err: any) {
    toast.handleApiError({ success: false, error: err.message || 'Erreur inattendue' }, 'Erreur')
  } finally {
    isSending.value = false
  }
}

onMounted(async () => {
  try {
    await fetchUsers({ limit: 20, sortBy: 'firstName', sortOrder: 'ASC' })
  } catch (err: any) {
    toast.handleApiError({ success: false, error: err.message || 'Erreur lors du chargement des utilisateurs' }, 'Erreur')
  }
})
</script>

<template>
  <div class="flex h-[calc(100vh-5rem)] flex-col">
    <div class="flex items-center gap-3 pb-4">
      <NuxtLink
        to="/notifications"
        class="flex h-7 w-7 items-center justify-center rounded-lg border border-border/60 bg-card text-muted-foreground transition-all hover:border-border hover:text-foreground hover:shadow-sm"
      >
        <ArrowLeft class="h-3.5 w-3.5" />
      </NuxtLink>
      <h1 class="text-lg font-semibold tracking-tight text-foreground">
        Nouvelle notification
      </h1>
    </div>

    <div class="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-7">
      <div class="flex min-h-0 flex-col gap-3 lg:col-span-5">
        <div class="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border/60 bg-card">
          <div class="flex items-center justify-between border-b border-border/40 px-4 py-2.5">
            <div class="flex items-center gap-3">
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all duration-150"
                :class="targetType === 'users'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
                @click="targetType = 'users'"
              >
                <Users class="h-3 w-3" />
                Utilisateur(s)
              </button>
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all duration-150"
                :class="targetType === 'topic'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
                @click="targetType = 'topic'"
              >
                <Radio class="h-3 w-3" />
                Topic
              </button>
            </div>
            <span
              v-if="targetType === 'users' && selectedUserIds.length > 0"
              class="text-[11px] font-medium text-primary"
            >
              {{ selectedUserIds.length }} selectionne{{ selectedUserIds.length > 1 ? 's' : '' }}
            </span>
            <span
              v-else-if="targetType === 'topic'"
              class="text-[11px] text-muted-foreground"
            >
              ~{{ getEstimatedTopicUsers(selectedTopic) }} utilisateurs
            </span>
          </div>

          <div class="p-4">
            <div v-if="targetType === 'users'">
              <UiUserCombobox
                v-model="selectedUserIds"
                :users="availableUsers"
                :multiple="true"
                label=""
                placeholder="Rechercher et selectionner des utilisateurs..."
                search-placeholder="Nom, email ou role..."
                empty-message="Aucun utilisateur selectionne"
                :is-loading="usersLoading"
              />
            </div>

            <div v-else class="flex gap-2">
              <button
                v-for="topic in topicOptions"
                :key="topic.value"
                type="button"
                class="flex-1 rounded-lg border px-3 py-2 text-center text-xs font-medium transition-all duration-150"
                :class="selectedTopic === topic.value
                  ? 'border-primary/40 bg-primary/5 text-foreground shadow-sm'
                  : 'border-border/60 text-muted-foreground hover:border-border hover:bg-accent/30 hover:text-foreground'"
                @click="selectedTopic = topic.value"
              >
                {{ topic.label }}
              </button>
            </div>
          </div>

          <div class="border-t border-border/40 px-4 py-2">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1.5">
                <Globe class="h-3 w-3 text-muted-foreground" />
                <span class="text-[11px] font-medium text-muted-foreground">Contenu</span>
              </div>
              <div class="inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5">
                <button
                  v-for="lang in languages"
                  :key="lang.code"
                  type="button"
                  class="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium transition-all duration-150"
                  :class="activeLang === lang.code
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'"
                  @click="activeLang = lang.code"
                >
                  <span>{{ lang.flag }}</span>
                  <span>{{ lang.name }}</span>
                  <CheckCircle2
                    v-if="isLangComplete(lang.code)"
                    class="h-2.5 w-2.5 text-green-500"
                  />
                </button>
              </div>
            </div>
          </div>

          <div class="space-y-3 px-4 pb-4">
            <div class="space-y-1">
              <label class="text-[11px] font-medium">
                Titre <span class="text-destructive">*</span>
              </label>
              <UiInput
                v-model="form[activeLang].title"
                :placeholder="activeLang === 'fr' ? 'Titre en francais...'
                  : activeLang === 'en' ? 'Title in English...'
                    : 'Titel in het Nederlands...'"
                maxlength="100"
                class="h-8 text-sm"
              />
            </div>

            <div class="space-y-1">
              <label class="text-[11px] font-medium">
                Message <span class="text-destructive">*</span>
              </label>
              <UiTextarea
                v-model="form[activeLang].body"
                :placeholder="activeLang === 'fr' ? 'Contenu du message en francais...'
                  : activeLang === 'en' ? 'Message content in English...'
                    : 'Berichtinhoud in het Nederlands...'"
                maxlength="500"
                class="min-h-[80px] resize-none text-sm"
              />
              <p class="text-right text-[10px] text-muted-foreground/60 tabular-nums">
                {{ form[activeLang].body.length }}/500
              </p>
            </div>
          </div>
        </div>

        <div class="flex shrink-0 items-center justify-end gap-2">
          <UiButton variant="outline" as-child>
            <NuxtLink to="/notifications">Annuler</NuxtLink>
          </UiButton>
          <UiButton
            :disabled="!canSend || isSending"
            @click="handleSend"
          >
            <Loader2 v-if="isSending" class="mr-2 h-4 w-4 animate-spin" />
            <Send v-else class="mr-2 h-4 w-4" />
            {{ isSending ? 'Envoi...' : 'Envoyer' }}
          </UiButton>
        </div>
      </div>

      <div class="lg:col-span-2 flex flex-col items-center gap-2">
        <span class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Apercu — {{ languages.find(l => l.code === activeLang)?.flag }} {{ activeLang.toUpperCase() }}
        </span>

        <NotificationPreview
          :title="previewTitle"
          :body="previewBody"
        />
      </div>
    </div>
  </div>
</template>
