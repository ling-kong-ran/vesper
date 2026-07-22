import { LATEST_RELEASE_API, newerVersion, normalizedVersion, RELEASES_URL } from '../../shared/app-update.mjs'
import { releaseNotesMarkdown } from '../../shared/release-notes.mjs'

const DEFAULT_CACHE_MS = 15 * 60_000

export class UpdateCheckService {
  constructor({ currentVersion, fetcher = fetch, now = () => Date.now(), cacheMs = DEFAULT_CACHE_MS } = {}) {
    this.currentVersion = normalizedVersion(currentVersion)
    this.fetcher = fetcher
    this.now = now
    this.cacheMs = cacheMs
    this.cached = null
    this.pending = null
  }

  async check({ refresh = false } = {}) {
    if (!refresh && this.cached && this.now() - this.cached.cachedAt < this.cacheMs) return this.cached.value
    if (this.pending) return this.pending
    this.pending = this.fetchLatest().finally(() => { this.pending = null })
    return this.pending
  }

  async fetchLatest() {
    const response = await this.fetcher(LATEST_RELEASE_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `Vesper/${this.currentVersion || 'web'}`,
      },
    })
    if (!response.ok) throw new Error(`GitHub Release 请求失败：HTTP ${response.status}`)
    const release = await response.json()
    const version = normalizedVersion(release.tag_name)
    const available = newerVersion(version, this.currentVersion)
    const value = {
      state: available ? 'available' : 'current',
      currentVersion: this.currentVersion,
      availableVersion: version,
      releaseDate: release.published_at || release.created_at || null,
      notes: releaseNotesMarkdown(release.body),
      releaseUrl: release.html_url || RELEASES_URL,
      canDownload: false,
      checkedAt: new Date(this.now()).toISOString(),
      message: available ? '浏览器模式检测到新版本，请前往 GitHub Releases 查看更新。' : '当前已是最新版本。',
    }
    this.cached = { cachedAt: this.now(), value }
    return value
  }
}
