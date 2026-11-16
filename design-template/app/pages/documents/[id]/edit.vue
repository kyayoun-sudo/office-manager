<script setup lang="ts">
import { AlertCircle } from 'lucide-vue-next'
import type { Document, UpdateDocumentData } from '~~/shared/types/document'

definePageMeta({
  title: 'Modifier le document',
  layout: 'default',
})
useHead({ title: 'Modifier le document - Modèle d’administration' })

const route = useRoute()
const { toast } = useToast()
const { getDocumentById, updateDocument, loading } = useDocuments()

const document = ref<Document | null>(null)
const fetchError = ref(false)
const initialLoading = ref(true)

onMounted(async () => {
  const id = Number(route.params.id)
  if (!id || isNaN(id)) {
    fetchError.value = true
    initialLoading.value = false
    return
  }

  const result = await getDocumentById(id, true)
  if (result) {
    document.value = result as Document
  } else {
    fetchError.value = true
  }
  initialLoading.value = false
})

const handleSubmit = async (data: Record<string, any>) => {
  const response = await updateDocument(data as UpdateDocumentData)
  if (response?.success) {
    toast({ title: 'Succes', description: 'Document modifie avec succes' })
    navigateTo('/documents')
  } else {
    toast({ title: 'Erreur', description: 'Erreur lors de la modification du document', variant: 'destructive' })
  }
}

const handleCancel = () => {
  navigateTo('/documents')
}
</script>

<template>
  <div v-if="initialLoading" class="flex items-center justify-center h-[60vh]">
    <div class="flex flex-col items-center gap-3">
      <AppSpinner class="h-8 w-8" />
      <p class="text-sm text-muted-foreground">Chargement du document...</p>
    </div>
  </div>

  <div v-else-if="fetchError" class="flex items-center justify-center h-[60vh]">
    <div class="flex flex-col items-center gap-4 text-center">
      <div class="rounded-full bg-destructive/10 p-3">
        <AlertCircle class="h-8 w-8 text-destructive" />
      </div>
      <div>
        <h2 class="text-lg font-semibold">Document introuvable</h2>
        <p class="text-sm text-muted-foreground mt-1">
          Le document demande n'existe pas ou une erreur est survenue.
        </p>
      </div>
      <UiButton variant="outline" @click="navigateTo('/documents')">
        Retour a la liste
      </UiButton>
    </div>
  </div>

  <DocumentEditorLayout
    v-else
    :document="document"
    :is-loading="loading"
    @submit="handleSubmit"
    @cancel="handleCancel"
  />
</template>
