export const PAGE_PATHS = Object.freeze({
  chat: '/chat',
  chatHistory: '/chat/history',
  assets: '/assets',
  channels: '/channels',
  schedules: '/schedules',
  plugins: '/plugins',
  memory: '/memory',
  mcp: '/mcp',
  skills: '/skills',
  workflows: '/workflows',
  workflowCreate: '/workflows/new',
  config: '/config',
})

export const PAGE_IDS = new Set(Object.keys(PAGE_PATHS))

const PATH_PAGES = new Map(Object.entries(PAGE_PATHS).map(([page, path]) => [path, page]))

export function pagePath(page) {
  return PAGE_PATHS[page] || PAGE_PATHS.chat
}

export function pageFromPath(pathname) {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return PATH_PAGES.get(normalized) || null
}

export function legacyHashPath(hash) {
  const legacyPage = String(hash || '').replace(/^#/, '')
  return PAGE_IDS.has(legacyPage) ? pagePath(legacyPage) : null
}
