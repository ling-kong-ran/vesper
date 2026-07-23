import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  DEFAULT_WINDOWS_PROXY_PORT_RANGE,
  SandboxManager,
  VENDORED_SRT_WIN_EXE,
  WindowsSandboxError,
  checkWindowsSandboxStatusAsync,
  installWindowsSandboxAsync,
  resolveSrtWin,
} from '@anthropic-ai/sandbox-runtime'

export const SANDBOX_BACKEND = 'anthropic-srt'

export const DEFAULT_SANDBOX_DOMAINS = Object.freeze([
  'github.com',
  '*.github.com',
  'api.github.com',
  'raw.githubusercontent.com',
  'objects.githubusercontent.com',
  'codeload.github.com',
  'npmjs.org',
  '*.npmjs.org',
  'registry.npmjs.org',
  'yarnpkg.com',
  '*.yarnpkg.com',
  'pypi.org',
  '*.pypi.org',
  'pythonhosted.org',
  '*.pythonhosted.org',
  'crates.io',
  '*.crates.io',
  'static.crates.io',
  'golang.org',
  '*.golang.org',
  'proxy.golang.org',
  'sum.golang.org',
  'nodejs.org',
  '*.nodejs.org',
])

const DENIED_ENV_VARS = Object.freeze([
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'XAI_API_KEY',
  'OPENROUTER_API_KEY',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'GITLAB_TOKEN',
  'BITBUCKET_TOKEN',
  'NPM_TOKEN',
  'NODE_AUTH_TOKEN',
  'HF_TOKEN',
  'HUGGING_FACE_HUB_TOKEN',
  'DOCKER_AUTH_CONFIG',
  'DATABASE_URL',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AZURE_CLIENT_SECRET',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'BASH_ENV',
  'ENV',
])

const UNSAFE_SHELL_ENV_VARS = Object.freeze([
  'BASH_ENV',
  'ENV',
  'PROMPT_COMMAND',
  'SHELLOPTS',
  'BASHOPTS',
  'CDPATH',
  'GLOBIGNORE',
])

function packagedExecutablePath(filePath) {
  const value = String(filePath || '')
  return value.includes('app.asar') ? value.replace('app.asar', 'app.asar.unpacked') : value
}

function sandboxSensitivePaths(dataDir, home = homedir()) {
  return [
    join(home, '.ssh'),
    join(home, '.aws'),
    join(home, '.gnupg'),
    join(home, '.kube'),
    join(home, '.docker'),
    join(home, '.azure'),
    join(home, '.config', 'gcloud'),
    join(home, '.config', 'gh'),
    join(home, '.npmrc'),
    join(home, '.git-credentials'),
    join(home, '.netrc'),
    join(home, '.pypirc'),
    resolve(dataDir),
  ]
}

function nonEmptyFile(path) {
  try { return statSync(path).isFile() && statSync(path).size > 0 } catch { return false }
}

function npmConfigContainsCredential(path) {
  if (!nonEmptyFile(path)) return false
  try {
    return /(?:^|\r?\n)\s*(?:[^\r\n=]*:_authToken|_auth|password|token)\s*=\s*\S+/i.test(readFileSync(path, 'utf8'))
  } catch {
    return true
  }
}

const MAX_WINDOWS_CREDENTIAL_FILES = 512

function windowsCredentialDirectories(home) {
  return [
    join(home, '.ssh'),
    join(home, '.aws'),
    join(home, '.gnupg'),
    join(home, '.kube'),
    join(home, '.docker'),
    join(home, '.azure'),
    join(home, '.config', 'gcloud'),
    join(home, '.config', 'gh'),
  ]
}

function ignoredCredentialFile(base, path) {
  if (base.toLowerCase().endsWith(`${sep}.gnupg`)) {
    const name = relative(base, path).replaceAll('\\', '/').toLowerCase()
    return name.startsWith('public-keys.d/') || name.endsWith('.lock') || name.split('/').some((part) => part.startsWith('.#lk'))
  }
  return false
}

function collectCredentialFiles(root, files, base = root) {
  let entries = []
  try { entries = readdirSync(root, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) collectCredentialFiles(path, files, base)
    else if (entry.isFile() && !ignoredCredentialFile(base, path)) {
      const info = statSync(path)
      if (info.nlink > 1) throw new Error(`Windows 凭据文件使用了硬链接，无法安全建立本地沙箱：${path}`)
      files.push(canonicalPath(path))
    }
    if (files.length > MAX_WINDOWS_CREDENTIAL_FILES) {
      throw new Error(`Windows 凭据目录文件过多，无法安全建立本地沙箱：${base}`)
    }
  }
}

export function windowsDenyReadPaths(dataDir, home = homedir()) {
  const paths = []
  if (existsSync(dataDir)) paths.push(canonicalPath(dataDir))
  for (const directory of windowsCredentialDirectories(home)) collectCredentialFiles(directory, paths)
  return [...new Set(paths)]
}

export function windowsSensitiveGuardPaths(dataDir, home = homedir()) {
  const paths = windowsDenyReadPaths(dataDir, home)
  const directFiles = [
    join(home, '.git-credentials'),
    join(home, '.netrc'),
    join(home, '.pypirc'),
  ].filter(nonEmptyFile)
  const npmConfig = join(home, '.npmrc')
  if (npmConfigContainsCredential(npmConfig)) directFiles.push(npmConfig)
  return [...new Set([...paths, ...directFiles.map(canonicalPath)])]
}

function workspaceDenyWritePaths(workspace) {
  return [
    join(workspace, '.env'),
    join(workspace, '.env.local'),
    join(workspace, '.env.development'),
    join(workspace, '.env.production'),
    join(workspace, '.env.test'),
  ]
}

function canonicalPath(value) {
  const target = resolve(value)
  try { return realpathSync.native(target) } catch { return target }
}

function pathContains(parent, child) {
  const result = relative(parent, child)
  return result === '' || (result !== '..' && !result.startsWith(`..${sep}`) && !isAbsolute(result))
}

export function validateWindowsSandboxRoots(roots, dataDir, homeDir = homedir()) {
  const sensitive = sandboxSensitivePaths(dataDir, homeDir).map(canonicalPath)
  for (const root of roots.map(canonicalPath)) {
    const overlap = sensitive.find((path) => pathContains(root, path) || pathContains(path, root))
    if (overlap) {
      throw new Error(`Windows 工作区沙箱不能授权包含敏感目录的路径：${root}。请选择更具体的项目目录。`)
    }
  }
}

export function buildSandboxConfig({ workspaces, dataDir, platform = process.platform, srtWinPath = VENDORED_SRT_WIN_EXE, homeDir = homedir() }) {
  const roots = [...new Set([...(workspaces || [])].map(canonicalPath))]
  if (platform === 'win32') {
    if (roots.length !== 1) throw new Error('Windows 工作区沙箱必须且只能授权一个工作区。')
    validateWindowsSandboxRoots(roots, dataDir, homeDir)
  }
  return {
    network: {
      allowedDomains: [...DEFAULT_SANDBOX_DOMAINS],
      deniedDomains: [],
      strictAllowlist: true,
      allowLocalBinding: true,
    },
    filesystem: {
      // Windows runs commands as a separate low-privilege user that can only
      // reach explicitly granted workspace roots. Keep deny stamping away from
      // the large home/workspace parents that caused the fixed 60s ACL timeout;
      // deny only the existing app-owned Vesper tree and concrete files inside
      // known credential directories. Their parents stay within small private
      // trees, while direct home-level credential files use the runtime guard.
      denyRead: platform === 'win32'
        ? windowsDenyReadPaths(dataDir, homeDir)
        : sandboxSensitivePaths(dataDir, homeDir),
      allowRead: [],
      allowWrite: roots,
      denyWrite: platform === 'win32' ? [] : roots.flatMap(workspaceDenyWritePaths),
      allowGitConfig: false,
    },
    credentials: {
      envVars: DENIED_ENV_VARS.map((name) => ({ name, mode: 'deny' })),
    },
    git: { safeDirectories: roots },
    ...(platform === 'win32' ? {
      windows: {
        proxyPortRange: DEFAULT_WINDOWS_PROXY_PORT_RANGE,
        srtWin: { path: packagedExecutablePath(srtWinPath) },
      },
    } : {}),
  }
}

export function buildCommandSandboxOverrides(workspaces, cwd, platform = process.platform) {
  // Windows keeps exactly one granted workspace active at a time. Per-command
  // deny stamps would repeat the same expensive parent-ACL propagation that
  // session initialization avoids.
  if (platform === 'win32') return undefined
  const current = resolve(cwd)
  return {
    filesystem: {
      denyWrite: [...(workspaces || [])]
        .map((value) => resolve(value))
        .filter((value) => value !== current),
    },
  }
}

function sandboxErrorState(error) {
  const code = error instanceof WindowsSandboxError ? error.code : ''
  if (code === 'not_provisioned') return 'not-installed'
  if (code === 'srt_win_not_found') return 'unsupported'
  return 'error'
}

function publicSandboxError(error) {
  return {
    state: sandboxErrorState(error),
    code: error instanceof WindowsSandboxError ? error.code : 'sandbox-initialization-failed',
    message: error instanceof Error ? error.message : String(error),
  }
}

function resolveWindowsShell() {
  const configured = String(process.env.VESPER_SANDBOX_SHELL || '').trim()
  if (configured && existsSync(configured)) return configured
  try {
    const matches = execFileSync('where.exe', ['bash'], { encoding: 'utf8', windowsHide: true })
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)
    const gitBash = matches.find((value) => /\\Git\\(?:usr\\bin|bin)\\bash\.exe$/i.test(value))
    if (gitBash) return gitBash
  } catch {}
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  const candidates = [
    join(programFiles, 'Git', 'usr', 'bin', 'bash.exe'),
    join(programFiles, 'Git', 'bin', 'bash.exe'),
  ]
  return candidates.find(existsSync) || 'powershell'
}

function bashQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function windowsCommand(command, shellPath, sensitivePaths = []) {
  if (!/bash\.exe$/i.test(shellPath)) {
    throw new Error('Windows 工作区沙箱需要受信任的 Git Bash，当前设备未找到 bash.exe。')
  }
  const guard = sensitivePaths
    .map((path) => {
      const shellPath = path.replaceAll('\\', '/')
      const probe = `if [ -d ${bashQuote(shellPath)} ]; then /usr/bin/ls -A ${bashQuote(shellPath)} >/dev/null 2>&1; else /usr/bin/dd if=${bashQuote(shellPath)} of=/dev/null bs=1 count=1 >/dev/null 2>&1; fi`
      return `if { ${probe}; }; then printf '%s\\n' ${bashQuote(`VESPER_SANDBOX_SENSITIVE_PATH_READABLE:${shellPath}`)} >&2; exit 126; fi`
    })
    .join('; ')
  return `export PYTHONIOENCODING=utf-8 PYTHONUTF8=1 LANG=C.UTF-8 LC_ALL=C.UTF-8; ${guard ? `${guard}; ` : ''}${command}`
}

export function sandboxChildEnvironment(environment = {}) {
  const result = { ...environment }
  for (const name of UNSAFE_SHELL_ENV_VARS) delete result[name]
  return result
}

function abortedError() {
  return new Error('aborted')
}

function unrefDelay(milliseconds) {
  return new Promise((resolveDelay) => {
    const handle = setTimeout(resolveDelay, milliseconds)
    handle.unref?.()
  })
}

function terminateProcessTree(child, platform = process.platform) {
  if (!child?.pid || child.exitCode != null || child.signalCode != null) return
  if (platform === 'win32') {
    try {
      spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }).unref()
    } catch {
      child.kill('SIGKILL')
    }
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
}

export class LocalSandboxService {
  constructor({ dataDir, homeDir = homedir(), platform = process.platform, manager = SandboxManager, windowsExecutable = VENDORED_SRT_WIN_EXE, disposeGraceMs = 5_000 } = {}) {
    this.homeDir = resolve(homeDir)
    this.dataDir = resolve(dataDir || join(this.homeDir, '.vesper', 'agent'))
    this.platform = platform
    this.manager = manager
    this.windowsExecutable = packagedExecutablePath(windowsExecutable)
    this.disposeGraceMs = disposeGraceMs
    this.workspaces = new Set()
    this.initializedSignature = ''
    this.lock = Promise.resolve()
    this.activeCommands = 0
    this.pendingCommands = 0
    this.activeChildren = new Set()
    this.idleWaiters = []
    this.switchingWorkspace = false
    this.lastSwitchDurationMs = null
    this.disposing = false
    this.disposed = false
    this.lastError = null
  }

  isSupported() {
    return ['win32', 'darwin', 'linux'].includes(this.platform) && this.manager.isSupportedPlatform()
  }

  windowsSpawn() {
    return resolveSrtWin({ path: this.windowsExecutable })
  }

  registerWorkspace(cwd) {
    if (!cwd) return
    const workspace = canonicalPath(cwd)
    if (this.platform === 'win32') {
      // The Windows backend grants ACLs to one shared sandbox account. Keeping
      // multiple roots granted concurrently would let one session modify
      // another session's workspace, while denying the other roots per command
      // reintroduces the expensive ACL stamp path. Serialize workspace switches
      // instead and initialize SRT with one root at a time.
      this.workspaces = new Set([workspace])
      return
    }
    this.workspaces.add(workspace)
  }

  config() {
    return buildSandboxConfig({
      workspaces: this.workspaces,
      dataDir: this.dataDir,
      platform: this.platform,
      srtWinPath: this.windowsExecutable,
      homeDir: this.homeDir,
    })
  }

  signature() {
    return JSON.stringify({
      workspaces: [...this.workspaces].sort(),
      windowsDenyRead: this.platform === 'win32' ? windowsDenyReadPaths(this.dataDir, this.homeDir).sort() : [],
    })
  }

  async withLock(run) {
    const previous = this.lock
    let release
    this.lock = new Promise((resolveLock) => { release = resolveLock })
    await previous
    try {
      return await run()
    } finally {
      release()
    }
  }

  waitForIdle(signal) {
    if (this.activeCommands === 0) return Promise.resolve()
    if (signal?.aborted) return Promise.reject(abortedError())
    return new Promise((resolveIdle, rejectIdle) => {
      const waiter = {
        resolve: () => {
          signal?.removeEventListener('abort', waiter.abort)
          resolveIdle()
        },
        abort: () => {
          const index = this.idleWaiters.indexOf(waiter)
          if (index >= 0) this.idleWaiters.splice(index, 1)
          rejectIdle(abortedError())
        },
      }
      signal?.addEventListener('abort', waiter.abort, { once: true })
      this.idleWaiters.push(waiter)
    })
  }

  releaseCommand() {
    this.activeCommands = Math.max(0, this.activeCommands - 1)
    if (this.activeCommands !== 0) return
    for (const waiter of this.idleWaiters.splice(0)) waiter.resolve()
  }

  schedulerStatus() {
    return {
      activeCommands: this.activeCommands,
      pendingCommands: this.pendingCommands,
      switchingWorkspace: this.switchingWorkspace,
      lastSwitchDurationMs: this.lastSwitchDurationMs,
    }
  }

  async acquire(cwd, signal) {
    if (this.disposing || this.disposed) throw new Error('本地沙箱正在关闭。')
    if (signal?.aborted) throw abortedError()
    this.pendingCommands += 1
    try {
      return await this.withLock(async () => {
        if (this.disposing || this.disposed) throw new Error('本地沙箱正在关闭。')
        if (signal?.aborted) throw abortedError()
        const previousWorkspaces = new Set(this.workspaces)
        this.registerWorkspace(cwd)
        let signature
        try {
          signature = this.signature()
        } catch (error) {
          this.workspaces = previousWorkspaces
          this.lastError = publicSandboxError(error)
          throw error
        }
        const switching = signature !== this.initializedSignature
        const switchStartedAt = switching ? Date.now() : null
        if (switching) this.switchingWorkspace = true
        try {
          if (switching) {
            await this.waitForIdle(signal)
            if (this.disposing || this.disposed) throw new Error('本地沙箱正在关闭。')
            if (signal?.aborted) throw abortedError()
            if (this.manager.isSandboxingEnabled()) await this.manager.reset()
            this.initializedSignature = ''
          }
          if (!this.initializedSignature) {
            if (!this.isSupported()) throw new Error(`当前平台 ${this.platform} 不支持本地沙箱。`)
            await this.manager.initialize(this.config(), undefined, false)
            this.initializedSignature = signature
          }
          this.lastError = null
        } catch (error) {
          this.workspaces = previousWorkspaces
          this.lastError = publicSandboxError(error)
          throw error
        } finally {
          if (switchStartedAt != null) {
            this.switchingWorkspace = false
            this.lastSwitchDurationMs = Date.now() - switchStartedAt
          }
        }
        if (this.disposing || this.disposed) throw new Error('本地沙箱正在关闭。')
        if (signal?.aborted) throw abortedError()
        this.activeCommands += 1
        return () => this.releaseCommand()
      })
    } finally {
      this.pendingCommands = Math.max(0, this.pendingCommands - 1)
    }
  }

  createBashOperations() {
    return {
      exec: async (command, cwd, { onData, signal, timeout }) => {
        const release = await this.acquire(cwd, signal)
        let child
        let timedOut = false
        let timeoutHandle
        const shellPath = this.platform === 'win32' ? resolveWindowsShell() : '/bin/bash'
        try {
          const wrapped = await this.manager.wrapWithSandboxArgv(
            this.platform === 'win32' ? windowsCommand(command, shellPath, windowsSensitiveGuardPaths(this.dataDir, this.homeDir)) : command,
            shellPath,
            buildCommandSandboxOverrides(this.workspaces, cwd, this.platform),
            signal,
            cwd,
          )
          if (signal?.aborted) throw abortedError()
          child = spawn(wrapped.argv[0], wrapped.argv.slice(1), {
            cwd,
            detached: this.platform !== 'win32',
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            // The sandbox wrapper owns the final environment. In particular, it
            // removes denied credentials and injects the network proxy boundary.
            env: sandboxChildEnvironment(wrapped.env),
          })
          this.activeChildren.add(child)
          if (timeout && timeout > 0) {
            timeoutHandle = setTimeout(() => {
              timedOut = true
              terminateProcessTree(child, this.platform)
            }, timeout * 1000)
            timeoutHandle.unref?.()
          }
          const abort = () => terminateProcessTree(child, this.platform)
          if (signal?.aborted) abort()
          else signal?.addEventListener('abort', abort, { once: true })
          return await new Promise((resolveExec, rejectExec) => {
            child.stdout?.on('data', onData)
            child.stderr?.on('data', onData)
            child.on('error', rejectExec)
            child.on('close', (code) => {
              signal?.removeEventListener('abort', abort)
              if (signal?.aborted) rejectExec(new Error('aborted'))
              else if (timedOut) rejectExec(new Error(`timeout:${timeout}`))
              else resolveExec({ exitCode: code })
            })
          })
        } finally {
          if (timeoutHandle) clearTimeout(timeoutHandle)
          if (child) this.activeChildren.delete(child)
          try { this.manager.cleanupAfterCommand() } catch {}
          release()
        }
      },
    }
  }

  async getStatus() {
    if (!this.isSupported()) return { supported: false, backend: SANDBOX_BACKEND, platform: this.platform, state: 'unsupported' }
    try {
      if (this.platform === 'win32') {
        const status = await checkWindowsSandboxStatusAsync({ srtWin: this.windowsSpawn() })
        const ready = Boolean(status.user.provisioned && status.user.credPresent)
        return {
          supported: true,
          backend: SANDBOX_BACKEND,
          platform: this.platform,
          state: ready ? (this.activeCommands > 0 ? 'active' : 'ready') : 'not-installed',
          requiresElevation: !ready,
          initialized: Boolean(this.initializedSignature),
          userProvisioned: Boolean(status.user.provisioned),
          networkFilter: status.wfp.state,
          scheduler: this.schedulerStatus(),
          error: this.lastError,
        }
      }
      const dependencies = await this.manager.checkDependenciesAsync()
      return {
        supported: dependencies.errors.length === 0,
        backend: SANDBOX_BACKEND,
        platform: this.platform,
        state: dependencies.errors.length ? 'unavailable' : this.activeCommands > 0 ? 'active' : 'ready',
        requiresElevation: false,
        initialized: Boolean(this.initializedSignature),
        scheduler: this.schedulerStatus(),
        errors: dependencies.errors,
        warnings: dependencies.warnings,
        error: this.lastError,
      }
    } catch (error) {
      return {
        supported: false,
        backend: SANDBOX_BACKEND,
        platform: this.platform,
        requiresElevation: false,
        scheduler: this.schedulerStatus(),
        ...publicSandboxError(error),
      }
    }
  }

  async install() {
    if (this.platform !== 'win32') return this.getStatus()
    return this.withLock(async () => {
      try {
        if (this.disposing || this.disposed) throw new Error('本地沙箱正在关闭。')
        await this.waitForIdle()
        if (this.manager.isSandboxingEnabled()) await this.manager.reset()
        this.initializedSignature = ''
        const result = await installWindowsSandboxAsync({
          srtWin: this.windowsSpawn(),
          proxyPortRange: DEFAULT_WINDOWS_PROXY_PORT_RANGE,
        })
        if (result.cancelled) return { ...(await this.getStatus()), cancelled: true }
        this.lastError = null
        return this.getStatus()
      } catch (error) {
        this.lastError = publicSandboxError(error)
        throw error
      }
    })
  }

  async dispose() {
    if (this.disposed) return
    this.disposing = true
    for (const child of this.activeChildren) terminateProcessTree(child, this.platform)
    await this.withLock(async () => {
      if (this.activeCommands > 0) {
        await Promise.race([
          this.waitForIdle(),
          unrefDelay(this.disposeGraceMs),
        ])
      }
      if (this.manager.isSandboxingEnabled()) {
        try { await this.manager.reset() } catch (error) { this.lastError = publicSandboxError(error) }
      }
      this.initializedSignature = ''
      this.workspaces.clear()
      this.disposed = true
      this.disposing = false
    })
  }
}
