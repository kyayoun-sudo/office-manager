<script setup lang="ts">
import type { LegalContent, LegalContentStats, LegalContentFilters } from '~~/shared/types/legal-content'
import { FileText, CheckCircle, XCircle, Plus, RotateCcw, Eye, Edit, Trash2, Upload } from 'lucide-vue-next'

definePageMeta({
  middleware: 'auth'
})

const { 
  getLegalContents, 
  calculateStats, 
  toggleActiveStatus, 
  deleteLegalContent,
  getTypeLabel 
} = useLegalContent()
const toast = useToast()

// State
const loading = ref(false)
const stats = ref<LegalContentStats | null>(null)
const allLegalContents = ref<LegalContent[]>([])
const legalContents = ref<LegalContent[]>([])
const totalItems = ref(0)
const currentPage = ref(1)
const itemsPerPage = ref(10)

// Dialog states
const showCreateDialog = ref(false)
const showEditDialog = ref(false)
const showViewDialog = ref(false)
const showDeleteDialog = ref(false)
const showPublishDialog = ref(false)
const selectedContent = ref<LegalContent | null>(null)

// Filters
const filters = ref<LegalContentFilters>({
  contentType: 'all',
  isActive: 'all',
  search: ''
})

// Load all data once
const loadData = async () => {
  try {
    loading.value = true
    
    // Load all data without filters
    const response = await getLegalContents({}, 1, 1000) // Large limit to get all
    
    allLegalContents.value = response.data
    
    // Apply filters on the client side
    applyFilters()
    
    // Calculate stats from all data
    stats.value = calculateStats(allLegalContents.value)
  } catch (error: any) {
    console.error('Erreur lors du chargement:', error)
    allLegalContents.value = []
    legalContents.value = []
    totalItems.value = 0
    stats.value = {
      total: 0,
      active: 0,
      inactive: 0,
      byType: { terms: 0, privacy: 0, about: 0 }
    }
    toast.handleApiError({ success: false, error: 'Impossible de charger les données' }, 'Erreur')
  } finally {
    loading.value = false
  }
}

const refreshData = () => {
  loadData()
}

// Dialog handlers
const openCreateDialog = () => {
  selectedContent.value = null
  showCreateDialog.value = true
}

const handleContentCreated = (content: LegalContent) => {
  loadData() // Reload the list to show the new content
}

const handleContentUpdated = (content: LegalContent) => {
  loadData() // Reload the list to show the updated content
}

const openEditDialog = (content: LegalContent) => {
  selectedContent.value = content
  showEditDialog.value = true
}

const openViewDialog = (content: LegalContent) => {
  selectedContent.value = content
  showViewDialog.value = true
}

const openDeleteDialog = (content: LegalContent) => {
  selectedContent.value = content
  showDeleteDialog.value = true
}

const openPublishDialog = (content: LegalContent) => {
  selectedContent.value = content
  showPublishDialog.value = true
}

// Toggle active status (publication/dépublication)
const handleToggleStatus = async (content: LegalContent) => {
  try {
    await toggleActiveStatus(content.id)
    toast.handleApiSuccess(`Contenu ${content.isActive ? 'dépublié' : 'publié'} avec succès`)
    await loadData()
  } catch (error: any) {
    toast.handleApiError({ success: false, error: error.message || 'Impossible de changer le statut de publication' }, 'Erreur')
  }
}

// Delete content
const handleDelete = async () => {
  if (!selectedContent.value) return
  
  try {
    await deleteLegalContent(selectedContent.value.id)
    toast.handleApiSuccess('Contenu supprimé avec succès')
    showDeleteDialog.value = false
    selectedContent.value = null
    await loadData()
  } catch (error: any) {
    toast.handleApiError({ success: false, error: error.message || 'Impossible de supprimer le contenu' }, 'Erreur')
  }
}

// Publish content (just toggle active status)
const handlePublish = async () => {
  if (!selectedContent.value) return
  
  try {
    await toggleActiveStatus(selectedContent.value.id)
    toast.handleApiSuccess('Contenu publié avec succès')
    showPublishDialog.value = false
    selectedContent.value = null
    await loadData()
  } catch (error: any) {
    toast.handleApiError({ success: false, error: error.message || 'Impossible de publier le contenu' }, 'Erreur')
  }
}

// Client-side filtering function
const applyFilters = () => {
  let filtered = [...allLegalContents.value]
  
  // Filter by content type
  if (filters.value.contentType && filters.value.contentType !== 'all') {
    filtered = filtered.filter(content => content.contentType === filters.value.contentType)
  }
  
  // Filter by publication status
  if (filters.value.isActive !== undefined && filters.value.isActive !== 'all') {
    filtered = filtered.filter(content => content.isActive === filters.value.isActive)
  }
  
  // Filter by search term
  if (filters.value.search) {
    const searchTerm = filters.value.search.toLowerCase()
    filtered = filtered.filter(content => 
    content.title.toLowerCase().includes(searchTerm) ||
    content.content.toLowerCase().includes(searchTerm)
    )
  }
  
  legalContents.value = filtered
  totalItems.value = filtered.length
}

// Filter handlers
const handleFilterChange = () => {
  currentPage.value = 1
  applyFilters()
}

// Watch filters for automatic filtering
watch(filters, () => {
  applyFilters()
}, { deep: true })

// Initialize
onMounted(() => {
  loadData()
})
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold text-foreground">Contenus Légaux</h1>
        <p class="text-muted-foreground mt-2">
          Gestion des conditions d'utilisation, politique de confidentialité et contenus légaux
        </p>
      </div>
      <UiButton @click="openCreateDialog">
        <Plus class="h-4 w-4 mr-2" />
        Nouveau contenu
      </UiButton>
    </div>
    
    <!-- Statistics Cards -->
    <div v-if="stats && !loading" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <UiCard class="p-3 h-32">
        <UiCardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <UiCardTitle class="text-sm font-medium">Total</UiCardTitle>
          <FileText class="h-4 w-4 text-primary" />
        </UiCardHeader>
        <UiCardContent>
          <div class="text-2xl font-bold">{{ stats.total }}</div>
        </UiCardContent>
      </UiCard>
      
      <UiCard class="p-3 h-32">
        <UiCardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <UiCardTitle class="text-sm font-medium">Publiés</UiCardTitle>
          <CheckCircle class="h-4 w-4 text-green-600" />
        </UiCardHeader>
        <UiCardContent>
          <div class="text-2xl font-bold">{{ stats.active }}</div>
        </UiCardContent>
      </UiCard>
      
      <UiCard class="p-3 h-32">
        <UiCardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <UiCardTitle class="text-sm font-medium">Non publiés</UiCardTitle>
          <XCircle class="h-4 w-4 text-orange-600" />
        </UiCardHeader>
        <UiCardContent>
          <div class="text-2xl font-bold">{{ stats.inactive }}</div>
        </UiCardContent>
      </UiCard>
      
      <UiCard class="p-3 h-32 overflow-y-auto">
        <UiCardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <UiCardTitle class="text-sm font-medium">Types</UiCardTitle>
          <FileText class="h-4 w-4 text-muted-foreground" />
        </UiCardHeader>
        <UiCardContent>
          <div class="text-sm space-y-1">
            <div class="flex justify-between">
              <span>CGU:</span>
              <span class="font-medium">{{ stats.byType.terms }}</span>
            </div>
            <div class="flex justify-between">
              <span>Confidentialité:</span>
              <span class="font-medium">{{ stats.byType.privacy }}</span>
            </div>
            <div class="flex justify-between">
              <span>À propos:</span>
              <span class="font-medium">{{ stats.byType.about }}</span>
            </div>
          </div>
        </UiCardContent>
      </UiCard>
    </div>
    
    <!-- Filters -->
    <UiCard>
      <UiCardHeader>
        <UiCardTitle class="text-lg">Filtres</UiCardTitle>
      </UiCardHeader>
      <UiCardContent>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="space-y-2">
            <label class="text-sm font-medium">Type de contenu</label>
            <UiSelect v-model="filters.contentType" @update:model-value="handleFilterChange">
              <UiSelectTrigger>
                <UiSelectValue placeholder="Tous les types" />
              </UiSelectTrigger>
              <UiSelectContent>
                <UiSelectItem value="all">Tous les types</UiSelectItem>
                <UiSelectItem value="terms">Conditions générales</UiSelectItem>
                <UiSelectItem value="privacy">Politique de confidentialité</UiSelectItem>
                <UiSelectItem value="about">À propos</UiSelectItem>
              </UiSelectContent>
            </UiSelect>
          </div>
          
          <div class="space-y-2">
            <label class="text-sm font-medium">Statut de publication</label>
            <UiSelect v-model="filters.isActive" @update:model-value="handleFilterChange">
              <UiSelectTrigger>
                <UiSelectValue placeholder="Tous les statuts" />
              </UiSelectTrigger>
              <UiSelectContent>
                <UiSelectItem value="all">Tous les statuts</UiSelectItem>
                <UiSelectItem :value="true">Publiés</UiSelectItem>
                <UiSelectItem :value="false">Non publiés</UiSelectItem>
              </UiSelectContent>
            </UiSelect>
          </div>
          
          <div class="space-y-2">
            <label class="text-sm font-medium">Recherche</label>
            <UiInput 
            v-model="filters.search" 
            placeholder="Rechercher dans le titre ou le contenu..."
            />
          </div>
        </div>
      </UiCardContent>
    </UiCard>
    
    <!-- Data Table -->
    <UiCard>
      <UiCardHeader>
        <div class="flex items-center justify-between">
          <UiCardTitle class="text-lg">Liste des contenus ({{ totalItems }})</UiCardTitle>
          <UiButton 
          variant="outline" 
          size="sm"
          :disabled="loading"
          @click="refreshData"
          >
          <RotateCcw class="h-4 w-4 mr-2" :class="{ 'animate-spin': loading }" />
          Actualiser
        </UiButton>
      </div>
    </UiCardHeader>
    <UiCardContent>
      <div v-if="loading" class="text-center py-8">
        <AppSpinner class="h-8 w-8 mx-auto" />
        <p class="text-muted-foreground mt-2">Chargement des contenus...</p>
      </div>
      
      <div v-else-if="legalContents.length === 0" class="text-center py-8">
        <FileText class="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <p class="text-muted-foreground">Aucun contenu légal trouvé</p>
      </div>
      
      <div v-else class="space-y-4">
        <div 
        v-for="content in legalContents" 
        :key="content.id"
        class="border rounded-lg p-4 hover:bg-muted/50 transition-colors"
        >
        <div class="flex items-start justify-between">
          <div class="flex-1">
            <div class="flex items-center space-x-2 mb-2">
              <h3 class="font-medium">{{ content.title }}</h3>
              <UiBadge :variant="content.isActive ? 'default' : 'destructive'">
                {{ content.isActive ? 'Publié' : 'Non publié' }}
              </UiBadge>
              <UiBadge variant="outline">{{ getTypeLabel(content.contentType) }}</UiBadge>
              <UiBadge variant="outline">v{{ content.version }}</UiBadge>
            </div>
            <p class="text-sm text-muted-foreground mb-2">
              {{ content.content.substring(0, 150) }}{{ content.content.length > 150 ? '...' : '' }}
            </p>
            <div class="flex items-center space-x-4 text-xs text-muted-foreground">
              <span>Créé le {{ new Date(content.createdAt).toLocaleDateString('fr-FR') }}</span>
              <span>Modifié le {{ new Date(content.updatedAt).toLocaleDateString('fr-FR') }}</span>
            </div>
          </div>
          <div class="flex items-center space-x-2 ml-4">
            <UiButton variant="outline" size="sm" @click="openViewDialog(content)">
              <Eye class="h-4 w-4" />
            </UiButton>
            <!--
              <UiButton variant="outline" size="sm" @click="openEditDialog(content)">
              <Edit class="h-4 w-4" />
            </UiButton>
             -->
            <UiButton 
            v-if="!content.isActive"
            variant="default" 
            size="sm"
            @click="openPublishDialog(content)"
            >
            <Upload class="h-4 w-4 mr-1" />
            Publier
          </UiButton>
          <UiButton 
          v-if="content.isActive"
          variant="destructive" 
          size="sm"
          @click="handleToggleStatus(content)"
          >
          Dépublier
        </UiButton>
        <UiButton variant="destructive" size="sm" @click="openDeleteDialog(content)">
          <Trash2 class="h-4 w-4" />
        </UiButton>
      </div>
    </div>
  </div>
</div>
</UiCardContent>
</UiCard>

<!-- View Dialog -->
<ViewLegalContentDialog 
v-model:open="showViewDialog"
:content="selectedContent"
/>

<!-- Create Dialog -->
<CreateLegalContentDialog 
v-model:open="showCreateDialog"
@created="handleContentCreated"
/>

<!-- Edit Dialog -->
<EditLegalContentDialog 
v-model:open="showEditDialog"
:content="selectedContent"
@updated="handleContentUpdated"
/>

<!-- Publish Confirmation Dialog -->
<UiDialog v-model:open="showPublishDialog">
  <UiDialogContent>
    <UiDialogHeader>
      <UiDialogTitle class="flex items-center space-x-2">
        <Upload class="h-5 w-5" />
        <span>Confirmer la publication</span>
      </UiDialogTitle>
      <UiDialogDescription>
        Êtes-vous sûr de vouloir publier le contenu "{{ selectedContent?.title }}" ?
        <br>
        Une fois publié, le contenu sera visible par les utilisateurs de l'application.
      </UiDialogDescription>
    </UiDialogHeader>
    <UiDialogFooter>
      <UiButton variant="outline" @click="showPublishDialog = false">
        Annuler
      </UiButton>
      <UiButton variant="default" @click="handlePublish">
        <Upload class="h-4 w-4 mr-2" />
        Publier
      </UiButton>
    </UiDialogFooter>
  </UiDialogContent>
</UiDialog>

<!-- Delete Confirmation Dialog -->
<UiDialog v-model:open="showDeleteDialog">
  <UiDialogContent>
    <UiDialogHeader>
      <UiDialogTitle>Confirmer la suppression</UiDialogTitle>
      <UiDialogDescription>
        Êtes-vous sûr de vouloir supprimer le contenu "{{ selectedContent?.title }}" ?
        Cette action est irréversible.
      </UiDialogDescription>
    </UiDialogHeader>
    <UiDialogFooter>
      <UiButton variant="outline" @click="showDeleteDialog = false">
        Annuler
      </UiButton>
      <UiButton variant="destructive" @click="handleDelete">
        Supprimer
      </UiButton>
    </UiDialogFooter>
  </UiDialogContent>
</UiDialog>
</div>
</template>