export interface AppLanguage {
  code: string
  name: string
  flag: string
}

export const SUPPORTED_LANGUAGES: AppLanguage[] = [
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'nl', name: 'Nederlands', flag: '🇳🇱' },
]

export const LANGUAGE_CODES = SUPPORTED_LANGUAGES.map(l => l.code)
