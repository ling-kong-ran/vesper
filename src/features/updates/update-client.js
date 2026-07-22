export { RELEASES_URL } from '../../../shared/app-update.mjs'

export async function checkWebUpdates({ refresh = false, fetcher = fetch } = {}) {
  const response = await fetcher(`/api/app-update${refresh ? '?refresh=1' : ''}`, {
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`更新检查失败：HTTP ${response.status}`)
  return response.json()
}
