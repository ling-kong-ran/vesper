import { bodyJson, json, sseSend } from './response.mjs'

export function createApiHandler(runtime) {
  return async function handleApi(req, res, url) {
    if (!url.pathname.startsWith('/api/')) return false
    try {
      if (req.method === 'GET' && url.pathname === '/api/health') {
        json(res, 200, { ok: true, engine: '@earendil-works/pi-coding-agent', version: '0.80.10' })
        return true
      }
      if (req.method === 'GET' && url.pathname === '/api/config') {
        json(res, 200, await runtime.getConfig())
        return true
      }
      if (req.method === 'GET' && url.pathname === '/api/settings/notifications') {
        json(res, 200, await runtime.getNotificationSettings())
        return true
      }
      if (req.method === 'PATCH' && url.pathname === '/api/settings/notifications/browser') {
        json(res, 200, await runtime.updateBrowserNotifications(await bodyJson(req)))
        return true
      }
      if (req.method === 'GET' && url.pathname === '/api/settings/notifications/browser/events') {
        json(res, 200, await runtime.getBrowserNotificationEvents(url.searchParams.get('after') || ''))
        return true
      }
      const notificationTemplateTestMatch = url.pathname.match(/^\/api\/settings\/notifications\/templates\/([^/]+)\/(feishu|weixin|browser)\/test$/)
      if (req.method === 'POST' && notificationTemplateTestMatch) {
        json(res, 200, await runtime.testNotificationTemplate(decodeURIComponent(notificationTemplateTestMatch[1]), notificationTemplateTestMatch[2]))
        return true
      }
      const notificationTemplateMatch = url.pathname.match(/^\/api\/settings\/notifications\/templates\/([^/]+)\/(feishu|weixin|browser)$/)
      if (req.method === 'PUT' && notificationTemplateMatch) {
        json(res, 200, await runtime.saveNotificationTemplate(decodeURIComponent(notificationTemplateMatch[1]), notificationTemplateMatch[2], await bodyJson(req)))
        return true
      }
      if (req.method === 'GET' && url.pathname === '/api/usage/today') {
        json(res, 200, await runtime.getTodayUsage())
        return true
      }
      if (req.method === 'GET' && url.pathname === '/api/schedules') {
        json(res, 200, await runtime.getSchedules())
        return true
      }
      if (req.method === 'POST' && url.pathname === '/api/schedules') {
        json(res, 201, await runtime.createSchedule(await bodyJson(req)))
        return true
      }
      const scheduleRunMatch = url.pathname.match(/^\/api\/schedules\/([^/]+)\/run$/)
      if (req.method === 'POST' && scheduleRunMatch) {
        const result = await runtime.runSchedule(decodeURIComponent(scheduleRunMatch[1]))
        if (!result) json(res, 404, { error: '定时任务不存在。' })
        else json(res, 202, result)
        return true
      }
      const scheduleMatch = url.pathname.match(/^\/api\/schedules\/([^/]+)$/)
      if (req.method === 'PATCH' && scheduleMatch) {
        const result = await runtime.updateSchedule(decodeURIComponent(scheduleMatch[1]), await bodyJson(req))
        if (!result) json(res, 404, { error: '定时任务不存在。' })
        else json(res, 200, result)
        return true
      }
      if (req.method === 'DELETE' && scheduleMatch) {
        const deleted = await runtime.deleteSchedule(decodeURIComponent(scheduleMatch[1]))
        if (!deleted) json(res, 404, { error: '定时任务不存在。' })
        else json(res, 200, { deleted: true })
        return true
      }
      if (req.method === 'GET' && url.pathname === '/api/directories') {
        json(res, 200, await runtime.listDirectories(url.searchParams.get('path')))
        return true
      }
      if (req.method === 'GET' && url.pathname === '/api/assets') {
        json(res, 200, { assets: await runtime.listAssets({ query: url.searchParams.get('query'), kind: url.searchParams.get('kind'), sessionId: url.searchParams.get('sessionId') }) })
        return true
      }
      if (req.method === 'GET' && url.pathname === '/api/channels') {
        json(res, 200, await runtime.getChannels())
        return true
      }
      const onboardingStartMatch = url.pathname.match(/^\/api\/channels\/(feishu|weixin)\/onboarding$/)
      if (req.method === 'POST' && onboardingStartMatch) {
        json(res, 201, await runtime.startChannelOnboarding(onboardingStartMatch[1]))
        return true
      }
      const onboardingMatch = url.pathname.match(/^\/api\/channels\/(feishu|weixin)\/onboarding\/([^/]+)$/)
      if (req.method === 'GET' && onboardingMatch) {
        const result = runtime.getChannelOnboarding(onboardingMatch[1], decodeURIComponent(onboardingMatch[2]))
        if (!result) json(res, 404, { error: '扫码任务不存在或已过期。' })
        else json(res, 200, result)
        return true
      }
      if (req.method === 'DELETE' && onboardingMatch) {
        json(res, 200, { cancelled: runtime.cancelChannelOnboarding(onboardingMatch[1], decodeURIComponent(onboardingMatch[2])) })
        return true
      }
      const onboardingVerifyMatch = url.pathname.match(/^\/api\/channels\/(feishu|weixin)\/onboarding\/([^/]+)\/verify$/)
      if (req.method === 'POST' && onboardingVerifyMatch) {
        const result = runtime.verifyChannelOnboarding(onboardingVerifyMatch[1], decodeURIComponent(onboardingVerifyMatch[2]), (await bodyJson(req)).code)
        if (!result) json(res, 404, { error: '扫码任务不存在或已过期。' })
        else json(res, 200, result)
        return true
      }
      const reconnectMatch = url.pathname.match(/^\/api\/channels\/(feishu|weixin)\/reconnect$/)
      if (req.method === 'POST' && reconnectMatch) {
        json(res, 200, await runtime.reconnectChannel(reconnectMatch[1]))
        return true
      }
      const channelMatch = url.pathname.match(/^\/api\/channels\/(feishu|weixin)$/)
      if (req.method === 'PATCH' && channelMatch) {
        json(res, 200, await runtime.updateChannel(channelMatch[1], await bodyJson(req)))
        return true
      }
      if (req.method === 'DELETE' && channelMatch) {
        await runtime.deleteChannel(channelMatch[1])
        json(res, 200, { deleted: true })
        return true
      }
      const channelScopeMatch = url.pathname.match(/^\/api\/channels\/scopes\/([^/]+)$/)
      if (req.method === 'DELETE' && channelScopeMatch) {
        const deleted = await runtime.resetChannelScope(decodeURIComponent(channelScopeMatch[1]))
        if (!deleted) json(res, 404, { error: '渠道会话不存在。' })
        else json(res, 200, { deleted: true })
        return true
      }
      if (req.method === 'POST' && url.pathname === '/api/assets') {
        json(res, 201, await runtime.createAsset(await bodyJson(req)))
        return true
      }
      const assetContentMatch = url.pathname.match(/^\/api\/assets\/([^/]+)\/content$/)
      if (req.method === 'GET' && assetContentMatch) {
        const content = await runtime.getAssetContent(decodeURIComponent(assetContentMatch[1]))
        if (!content) json(res, 404, { error: '资产不存在。' })
        else json(res, 200, content)
        return true
      }
      const assetDownloadMatch = url.pathname.match(/^\/api\/assets\/([^/]+)\/download$/)
      if (req.method === 'GET' && assetDownloadMatch) {
        const download = await runtime.getAssetDownload(decodeURIComponent(assetDownloadMatch[1]))
        if (!download) json(res, 404, { error: '资产不存在或不可下载。' })
        else {
          res.writeHead(200, {
            'Content-Type': download.asset.mimeType || 'application/octet-stream',
            'Content-Length': download.buffer.length,
            'Content-Disposition': `${url.searchParams.get('inline') === '1' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(download.asset.name)}`,
            'Cache-Control': 'private, max-age=60',
          })
          res.end(download.buffer)
        }
        return true
      }
      const assetMatch = url.pathname.match(/^\/api\/assets\/([^/]+)$/)
      if (req.method === 'DELETE' && assetMatch) {
        const deleted = await runtime.deleteAsset(decodeURIComponent(assetMatch[1]))
        if (!deleted) json(res, 404, { error: '资产不存在。' })
        else json(res, 200, { deleted: true })
        return true
      }
      if (req.method === 'PUT' && url.pathname === '/api/config') {
        json(res, 200, await runtime.saveConfig(await bodyJson(req)))
        return true
      }
      if (req.method === 'GET' && url.pathname === '/api/plugins') {
        json(res, 200, await runtime.getPlugins())
        return true
      }
      if (req.method === 'PUT' && url.pathname === '/api/plugins') {
        json(res, 200, await runtime.savePlugins(await bodyJson(req)))
        return true
      }
      if (req.method === 'POST' && url.pathname === '/api/providers') {
        json(res, 201, await runtime.createProvider(await bodyJson(req)))
        return true
      }
      const providerEnabledMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/enabled$/)
      if (req.method === 'PUT' && providerEnabledMatch) {
        const body = await bodyJson(req)
        json(res, 200, await runtime.setProviderEnabled(decodeURIComponent(providerEnabledMatch[1]), Boolean(body.enabled)))
        return true
      }
      const providerModelsMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/models$/)
      if (req.method === 'POST' && providerModelsMatch) {
        json(res, 201, await runtime.addProviderModel(decodeURIComponent(providerModelsMatch[1]), await bodyJson(req)))
        return true
      }
      const providerMatch = url.pathname.match(/^\/api\/providers\/([^/]+)$/)
      if (req.method === 'DELETE' && providerMatch) {
        const deleted = await runtime.deleteProvider(decodeURIComponent(providerMatch[1]))
        if (!deleted) json(res, 404, { error: 'Provider 不存在。' })
        else json(res, 200, deleted)
        return true
      }
      if (req.method === 'GET' && url.pathname === '/api/sessions') {
        json(res, 200, { sessions: await runtime.listSessions() })
        return true
      }
      if (req.method === 'POST' && url.pathname === '/api/sessions') {
        const body = await bodyJson(req)
        json(res, 201, await runtime.createSession(body.name))
        return true
      }
      const sessionModelMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/model$/)
      if (req.method === 'PUT' && sessionModelMatch) {
        const body = await bodyJson(req)
        json(res, 200, await runtime.setSessionModel(decodeURIComponent(sessionModelMatch[1]), String(body.provider || ''), String(body.model || '')))
        return true
      }
      const sessionCwdMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/cwd$/)
      if (req.method === 'PUT' && sessionCwdMatch) {
        const body = await bodyJson(req)
        const updated = await runtime.setSessionCwd(decodeURIComponent(sessionCwdMatch[1]), body.cwd)
        if (!updated) json(res, 404, { error: '会话不存在。' })
        else json(res, 200, updated)
        return true
      }
      const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/)
      if (req.method === 'PATCH' && sessionMatch) {
        const id = decodeURIComponent(sessionMatch[1])
        const updated = await runtime.renameSession(id, (await bodyJson(req)).name, { manual: true })
        if (!updated) json(res, 404, { error: '会话不存在。' })
        else json(res, 200, updated)
        return true
      }
      if (req.method === 'DELETE' && sessionMatch) {
        const id = decodeURIComponent(sessionMatch[1])
        const deleted = await runtime.deleteSession(id)
        if (!deleted) json(res, 404, { error: '会话不存在。' })
        else json(res, 200, { deleted: true, id })
        return true
      }
      const messagesMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/messages$/)
      if (req.method === 'GET' && messagesMatch) {
        json(res, 200, { messages: await runtime.getSessionMessages(decodeURIComponent(messagesMatch[1])) })
        return true
      }
      const abortMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/abort$/)
      if (req.method === 'POST' && abortMatch) {
        json(res, 200, { aborted: await runtime.abortSession(decodeURIComponent(abortMatch[1])) })
        return true
      }
      if (req.method === 'POST' && url.pathname === '/api/chat') {
        const body = await bodyJson(req)
        if (!String(body.message || '').trim()) throw new Error('消息不能为空。')
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        })
        res.flushHeaders?.()
        try {
          await runtime.streamPrompt({
            sessionId: body.sessionId,
            message: String(body.message).trim(),
            attachments: body.attachments,
            send: (event, data) => sseSend(res, event, data),
          })
        } catch (error) {
          sseSend(res, 'error', { message: error instanceof Error ? error.message : String(error) })
        }
        res.end()
        return true
      }
      json(res, 404, { error: '接口不存在。' })
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) })
    }
    return true
  }
}
