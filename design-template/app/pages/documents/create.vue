<script setup lang="ts">
import type { CreateDocumentData } from '~~/shared/types/document'

definePageMeta({
  title: 'Nouveau document',
  layout: 'default',
})
useHead({ title: 'Nouveau document - Modèle d’administration' })

const { toast } = useToast()
const { createDocument, loading, documents, fetchDocuments } = useDocuments()

const usedDocumentTypes = computed(() =>
  documents.value
    .filter((d) => d.isActive)
    .map((d) => d.documentType),
)

onMounted(() => fetchDocuments({ limit: 100 }))

const handleSubmit = async (data: Record<string, any>) => {
  const response = await createDocument(data as CreateDocumentData)
  if (response?.success) {
    toast({ title: 'Succes', description: 'Document cree avec succes' })
    navigateTo('/documents')
  } else {
    toast({ title: 'Erreur', description: 'Erreur lors de la creation du document', variant: 'destructive' })
  }
}

const handleCancel = () => {
  navigateTo('/documents')
}
</script>

<template>
  <DocumentEditorLayout
    :is-loading="loading"
    :used-document-types="usedDocumentTypes"
    @submit="handleSubmit"
    @cancel="handleCancel"
  />
</template>
