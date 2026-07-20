import { useEffect } from 'react'
import { I18nextProvider, useTranslation } from 'react-i18next'
import { STORAGE_KEYS } from './storage.js'
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, i18n } from './i18n.js'

function LanguagePreferenceBridge({ children }) {
  const { i18n: instance } = useTranslation()
  const language = SUPPORTED_LANGUAGES.includes(instance.resolvedLanguage) ? instance.resolvedLanguage : DEFAULT_LANGUAGE

  useEffect(() => {
    document.documentElement.lang = language
    try { localStorage.setItem(STORAGE_KEYS.language, language) } catch {}
  }, [language])

  return children
}

export function LanguageProvider({ children }) {
  return <I18nextProvider i18n={i18n}><LanguagePreferenceBridge>{children}</LanguagePreferenceBridge></I18nextProvider>
}
