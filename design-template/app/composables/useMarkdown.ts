import { marked } from 'marked'
import { ref, computed } from 'vue'

export interface MarkdownOptions {
  breaks: boolean
  gfm: boolean
  sanitize: boolean
}

const defaultOptions: MarkdownOptions = {
  breaks: true, // Convertit les retours à la ligne en <br>
  gfm: true, // GitHub Flavored Markdown
  sanitize: true // Sécurité
}

export function useMarkdown(options: Partial<MarkdownOptions> = {}) {
  const mergedOptions = { ...defaultOptions, ...options }
  
  // Configuration de marked
  marked.setOptions({
    breaks: mergedOptions.breaks,
    gfm: mergedOptions.gfm,
  })

  /**
   * Convertit le markdown en HTML
   */
  const parseMarkdown = (markdown: string): string => {
    if (!markdown || typeof markdown !== 'string') {
      return ''
    }

    try {
      let html = marked(markdown) as string
      
      // Nettoyage basique pour la sécurité si demandé
      if (mergedOptions.sanitize) {
        html = sanitizeHtml(html)
      }

      return html
    } catch (error) {
      console.error('Erreur lors du parsing markdown:', error)
      return markdown // Retourne le markdown brut en cas d'erreur
    }
  }

  /**
   * Nettoyage HTML basique pour éviter les scripts malveillants
   */
  const sanitizeHtml = (html: string): string => {
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '')
  }

  /**
   * Composable réactif pour le markdown
   */
  const createReactiveMarkdown = (initialValue: string = '') => {
    const source = ref(initialValue)
    
    const html = computed(() => parseMarkdown(source.value))
    
    const preview = computed(() => ({
      source: source.value,
      html: html.value,
      isEmpty: !source.value.trim(),
      wordCount: source.value.split(/\s+/).filter(word => word.length > 0).length
    }))

    return {
      source,
      html,
      preview,
      parseMarkdown
    }
  }

  /**
   * Utilitaires pour l'édition markdown
   */
  const insertMarkdown = (
    textarea: HTMLTextAreaElement | null,
    before: string,
    after: string = '',
    placeholder: string = 'texte'
  ) => {
    if (!textarea || textarea.value === undefined || textarea.value === null) return
    
    const start = textarea.selectionStart || 0
    const end = textarea.selectionEnd || 0
    const selectedText = textarea.value.substring(start, end)
    const textToInsert = selectedText || placeholder
    
    const newValue = 
      textarea.value.substring(0, start) +
      before + textToInsert + after +
      textarea.value.substring(end)
    
    // Mettre à jour la valeur
    textarea.value = newValue
    
    // Émettre l'événement input pour Vue AVANT de modifier la sélection
    const inputEvent = new Event('input', { bubbles: true })
    textarea.dispatchEvent(inputEvent)
    
    // Ensuite focus et sélection
    textarea.focus()
    
    // Sélectionner le texte inséré
    const newStart = start + before.length
    const newEnd = newStart + textToInsert.length
    textarea.setSelectionRange(newStart, newEnd)
  }

  /**
   * Actions d'édition courantes
   */
  const markdownActions = {
    bold: (textarea: HTMLTextAreaElement | null) => 
      insertMarkdown(textarea, '**', '**', 'texte en gras'),
    
    italic: (textarea: HTMLTextAreaElement | null) => 
      insertMarkdown(textarea, '*', '*', 'texte en italique'),
    
    heading: (textarea: HTMLTextAreaElement | null, level: number = 1) => 
      insertMarkdown(textarea, '#'.repeat(level) + ' ', '', 'Titre'),
    
    link: (textarea: HTMLTextAreaElement | null) => 
      insertMarkdown(textarea, '[', '](url)', 'texte du lien'),
    
    image: (textarea: HTMLTextAreaElement | null) => 
      insertMarkdown(textarea, '![', '](url)', 'description image'),
    
    list: (textarea: HTMLTextAreaElement | null) => 
      insertMarkdown(textarea, '- ', '', 'élément de liste'),
    
    orderedList: (textarea: HTMLTextAreaElement | null) => 
      insertMarkdown(textarea, '1. ', '', 'élément de liste numérotée'),
    
    quote: (textarea: HTMLTextAreaElement | null) => 
      insertMarkdown(textarea, '> ', '', 'citation'),
    
    code: (textarea: HTMLTextAreaElement | null) => 
      insertMarkdown(textarea, '`', '`', 'code'),
    
    codeBlock: (textarea: HTMLTextAreaElement | null) => 
      insertMarkdown(textarea, '```\n', '\n```', 'code'),
    
    table: (textarea: HTMLTextAreaElement | null) => {
      const tableMarkdown = `| Colonne 1 | Colonne 2 | Colonne 3 |\n|-----------|-----------|-----------|\n| Cellule 1 | Cellule 2 | Cellule 3 |\n| Cellule 4 | Cellule 5 | Cellule 6 |`
      insertMarkdown(textarea, tableMarkdown, '', '')
    },
    
    hr: (textarea: HTMLTextAreaElement | null) => 
      insertMarkdown(textarea, '\n---\n', '', ''),
    
    strikethrough: (textarea: HTMLTextAreaElement | null) => 
      insertMarkdown(textarea, '~~', '~~', 'texte barré')
  }

  return {
    parseMarkdown,
    createReactiveMarkdown,
    insertMarkdown,
    markdownActions
  }
}