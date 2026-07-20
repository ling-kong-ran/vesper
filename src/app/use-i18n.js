import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, translateText } from './i18n.js'

export { DEFAULT_LANGUAGE, LANGUAGE_OPTIONS, SUPPORTED_LANGUAGES, translateText } from './i18n.js'

export function useI18n() {
  const { i18n: instance } = useTranslation()
  const language = SUPPORTED_LANGUAGES.includes(instance.resolvedLanguage) ? instance.resolvedLanguage : DEFAULT_LANGUAGE
  const setLanguage = useCallback((nextLanguage) => {
    if (!SUPPORTED_LANGUAGES.includes(nextLanguage)) return
    void instance.changeLanguage(nextLanguage)
  }, [instance])
  const t = useCallback((message, values) => translateText(message, language, values), [language])
  return { language, locale: language, setLanguage, t }
}
