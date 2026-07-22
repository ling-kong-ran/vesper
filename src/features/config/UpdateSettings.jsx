import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Download, ExternalLink, Laptop, PackageCheck, RefreshCw, Rocket, TriangleAlert } from 'lucide-react'
import MarkdownMessage from '../../components/MarkdownMessage.jsx'
import { Badge, Panel, SectionTitle } from '../../components/ui.jsx'
import { useI18n } from '../../app/use-i18n.js'

const BUILD_VERSION = import.meta.env.VITE_APP_VERSION || '0.0.0'

function platformLabel(info, t) {
  if (!info.desktop) return t('浏览器模式')
  const platform = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[info.platform] || info.platform
  return `${platform} · ${info.arch}`
}

function formatBytes(value, language) {
  const bytes = Number(value) || 0
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const level = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / (1024 ** level)).toLocaleString(language, { maximumFractionDigits: 1 })} ${units[level]}`
}

export function UpdateSettings({ notify, update }) {
  const { t, language } = useI18n()
  const info = update?.info || { desktop: false, packaged: false, version: BUILD_VERSION, platform: 'browser', arch: '' }
  const status = update?.status || { state: 'idle' }
  const desktop = Boolean(info.desktop)
  const [bundled, setBundled] = useState({ version: BUILD_VERSION, date: '', notes: '' })

  useEffect(() => {
    let active = true
    fetch('/release-notes.json', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((value) => { if (active && value) setBundled(value) })
      .catch(() => {})
    return () => { active = false }
  }, [])

  const check = async () => {
    await update?.check()
  }

  const openReleases = () => update?.openReleases()
  const openUpdateLog = () => update?.openUpdateLog?.()

  const download = async () => {
    try { await update?.download() } catch (error) { notify(error.message, 'error') }
  }

  const install = () => update?.install()

  const notes = status.notes || (desktop
    ? bundled.notes || t('该版本暂未提供更新日志。')
    : status.state === 'current'
      ? t('当前 Web 源码已同步 {branch}。', { branch: status.branch || 'main' })
      : t('检查后将在这里显示尚未同步的提交。'))
  const available = status.state === 'available'
  const resumable = status.state === 'error' && status.canResume && status.canDownload
  const downloaded = status.state === 'downloaded'
  const checking = status.state === 'checking'
  const downloading = status.state === 'downloading'
  const currentIdentifier = desktop
    ? `v${info.version}`
    : `v${info.version}${status.currentCommit ? ` · ${status.currentCommit.slice(0, 7)}` : ''}`
  const latestIdentifier = desktop
    ? `v${status.availableVersion || bundled.version || info.version}`
    : status.availableCommit?.slice(0, 7) || status.currentCommit?.slice(0, 7) || bundled.version || info.version
  const statusMeta = useMemo(() => ({
    idle: [t('尚未检查'), 'gray'], checking: [t('正在检查'), 'blue'], current: [t('已是最新'), 'green'], available: [t(desktop ? '发现新版本' : '发现代码更新'), 'blue'],
    downloading: [t('正在下载'), 'blue'], downloaded: [t('等待重启安装'), 'green'], error: [t(resumable ? '下载已暂停' : '检查失败'), 'red'],
  }[status.state] || [t('尚未检查'), 'gray']), [desktop, resumable, status.state, t])

  return <div className="mx-auto flex w-full max-w-[880px] flex-col gap-3">
    <Panel className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="language-settings-icon"><PackageCheck size={19} /></span>
          <span className="min-w-0"><strong className="block text-[16px]">{t('Vesper 应用更新')}</strong><small className="mt-1 block text-[13px] leading-5 text-[var(--muted)]">{t(desktop ? '自动检查 GitHub Releases，并在应用内展示版本和更新日志。' : '自动比较当前 Web 源码与 GitHub main 分支，并展示尚未同步的提交。')}</small></span>
        </div>
        <Badge tone={statusMeta[1]}>{statusMeta[0]}</Badge>
      </div>
      <div className="mt-5 grid gap-2 sm:grid-cols-3">
        <div className="rounded-[var(--r-sm)] bg-[var(--surface-muted)] p-3"><small className="text-[12px] text-[var(--muted)]">{t(desktop ? '当前版本' : '当前源码')}</small><strong className="mt-1 block font-mono text-[14px]">{currentIdentifier}</strong></div>
        <div className="rounded-[var(--r-sm)] bg-[var(--surface-muted)] p-3"><small className="text-[12px] text-[var(--muted)]">{t('运行平台')}</small><strong className="mt-1 block text-[14px]">{platformLabel(info, t)}</strong></div>
        <div className="rounded-[var(--r-sm)] bg-[var(--surface-muted)] p-3"><small className="text-[12px] text-[var(--muted)]">{t('更新通道')}</small><strong className="mt-1 block text-[14px]">{desktop ? 'Stable' : status.branch || 'main'}</strong></div>
      </div>
      {status.message && <div className={`mt-4 flex items-start gap-2 rounded-[var(--r-sm)] p-3 text-[13px] ${status.state === 'error' ? 'bg-[var(--danger-soft)] text-[var(--danger)]' : 'bg-[var(--accent-soft)] text-[var(--text)]'}`}>{status.state === 'error' ? <TriangleAlert className="mt-0.5 shrink-0" size={15} /> : <Laptop className="mt-0.5 shrink-0" size={15} />}<span>{t(status.message)}</span></div>}
      {resumable && <small className="mt-2 block text-[12px] text-[var(--muted)]">{t('下载进度已保留，可从断点继续。')}</small>}
      {downloading && <div className="mt-4"><div className="flex justify-between text-[12px] text-[var(--muted)]"><span>{t('下载进度')}</span><span>{Math.round(status.percent || 0)}% · {formatBytes(status.transferred, language)} / {formatBytes(status.total, language)}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--progress-track)]"><i className="block h-full bg-[var(--star)] transition-[width]" style={{ width: `${status.percent || 0}%` }} /></div></div>}
      <div className="mt-5 flex flex-wrap gap-2">
        <button className="button primary" disabled={checking || downloading} onClick={downloaded ? install : available || resumable ? download : check}>{checking || downloading ? <RefreshCw className="spin" size={14} /> : downloaded ? <Rocket size={14} /> : available || resumable ? status.canDownload ? <Download size={14} /> : <ExternalLink size={14} /> : <RefreshCw size={14} />}{t(downloaded ? '重启并安装' : resumable ? '继续下载' : available ? status.canDownload ? '下载更新' : desktop ? '查看新版本' : '查看代码更新' : checking ? '正在检查…' : '检查更新')}</button>
        <button className="button secondary" onClick={openReleases}><ExternalLink size={14} />{desktop ? 'GitHub Releases' : 'GitHub Compare'}</button>
        {desktop && <button className="button secondary" onClick={openUpdateLog}><ExternalLink size={14} />{t('查看更新诊断日志')}</button>}
      </div>
    </Panel>

    <Panel className="p-5">
      <div className="flex items-center justify-between gap-3"><SectionTitle title={t(desktop ? available || resumable || downloaded || downloading ? '新版本更新日志' : '当前版本更新日志' : available ? '待同步提交' : '当前源码状态')} /><span className="flex items-center gap-1.5 text-[12px] text-[var(--muted)]"><CheckCircle2 size={13} />{available || resumable || downloaded || downloading ? latestIdentifier : desktop ? `v${bundled.version || info.version}` : status.currentCommit?.slice(0, 7) || t('尚未检查')}</span></div>
      {(status.releaseDate || desktop && bundled.date) && <small className="mt-2 block text-[12px] text-[var(--muted)]">{new Intl.DateTimeFormat(language, { dateStyle: 'long' }).format(new Date(status.releaseDate || bundled.date))}</small>}
      <div className="mt-4 rounded-[var(--r-sm)] border border-[var(--stroke-soft)] bg-[var(--surface-subtle)] p-4"><MarkdownMessage>{notes}</MarkdownMessage></div>
    </Panel>
  </div>
}
