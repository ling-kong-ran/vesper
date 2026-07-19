import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { STORAGE_KEYS } from './storage.js'
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, storedLanguage, translateText } from './i18n.js'

export { DEFAULT_LANGUAGE, LANGUAGE_OPTIONS, SUPPORTED_LANGUAGES, translateText } from './i18n.js'

const LanguageContext = createContext({
  language: DEFAULT_LANGUAGE,
  locale: DEFAULT_LANGUAGE,
  setLanguage: () => {},
  t: (message, values) => translateText(message, DEFAULT_LANGUAGE, values),
})

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(storedLanguage)

  const setLanguage = useCallback((nextLanguage) => {
    if (!SUPPORTED_LANGUAGES.includes(nextLanguage)) return
    document.documentElement.lang = nextLanguage
    try { localStorage.setItem(STORAGE_KEYS.language, nextLanguage) } catch {}
    setLanguageState(nextLanguage)
  }, [])

  useEffect(() => {
    document.documentElement.lang = language
    try { localStorage.setItem(STORAGE_KEYS.language, language) } catch {}
  }, [language])

  const t = useCallback((message, values) => translateText(message, language, values), [language])
  const value = useMemo(() => ({ language, locale: language, setLanguage, t }), [language, setLanguage, t])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useI18n() {
  return useContext(LanguageContext)
}
