/**
 * Formats a date string safely with error handling
 * @param dateString - The date string to format
 * @param options - Intl.DateTimeFormat options
 * @returns Formatted date string or fallback message
 */
export const formatDateSafe = (
  dateString: string | null | undefined,
  options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }
): string => {
  if (!dateString) {
    return 'Non défini'
  }
  
  try {
    const date = new Date(dateString)
    if (isNaN(date.getTime())) {
      return 'Date invalide'
    }
    
    return new Intl.DateTimeFormat('fr-FR', options).format(date)
  } catch (error) {
    console.warn('Erreur de formatage de date:', dateString, error)
    return 'Date invalide'
  }
}

/**
 * Formats a date string safely with short format
 */
export const formatDateShort = (dateString: string | null | undefined): string => {
  return formatDateSafe(dateString, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * Formats a date string safely with long format
 */
export const formatDateLong = (dateString: string | null | undefined): string => {
  return formatDateSafe(dateString, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}