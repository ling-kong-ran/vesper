import assert from 'node:assert/strict'
import test from 'node:test'
import { i18n, translateText } from '../../src/app/i18n.js'

test('English interface translations resolve static and interpolated messages', () => {
  assert.equal(translateText('配置', 'en-US'), 'Settings')
  assert.equal(translateText('工作台', 'en-US'), 'Workbench')
  assert.equal(translateText('会话', 'en-US'), 'Sessions')
  assert.equal(translateText('工具', 'en-US'), 'Tools')
  assert.equal(translateText('设置', 'en-US'), 'Settings')
  assert.equal(translateText('界面语言', 'en-US'), 'Display language')
  assert.equal(translateText('{count} 个模型', 'en-US', { count: 3 }), '3 models')
  assert.equal(translateText('删除 Provider 连接', 'en-US'), 'Delete Provider connection')
  assert.equal(translateText('本机 Provider 配置', 'en-US'), 'Local provider configuration')
  assert.equal(translateText('需要 Codex CLI 登录', 'en-US'), 'Codex CLI login required')
  assert.equal(translateText('连接 MCP 服务', 'en-US'), 'Connect MCP server')
  assert.equal(translateText('让我们从一束想法开始', 'en-US'), 'Let’s begin with a spark of an idea')
  assert.equal(translateText('拆分到左侧', 'en-US'), 'Split to left')
  assert.equal(translateText('将 {name} 拆分到右侧', 'en-US', { name: 'Research' }), 'Split Research to the right')
  assert.equal(translateText('正在压缩上下文', 'en-US'), 'Compacting context')
  assert.equal(translateText('上下文占用：{tokens} / {limit} tokens（{percent}%）', 'en-US', { tokens: '64K', limit: '128K', percent: 50 }), 'Context usage: 64K / 128K tokens (50%)')
  assert.equal(translateText('上下文已压缩：{before} → {after} tokens', 'en-US', { before: '92K', after: '18.5K' }), 'Context compacted: 92K → 18.5K tokens')
  assert.equal(translateText('这片星域尚未点亮。点击左上角 +，种下第一颗星。', 'en-US'), 'This memory space is still unlit. Click + in the top-left to plant the first star.')
  assert.equal(translateText('{count} 个技能包', 'en-US', { count: 2 }), '2 skill packages')
  assert.equal(translateText('Web 源码落后 main 3 个提交，请查看更新内容后自行更新。', 'en-US'), 'The Web source is 3 commits behind main. Review the changes before updating.')
})

test('Chinese remains the default interface language', () => {
  assert.equal(translateText('界面语言'), '界面语言')
  assert.equal(translateText('{count} 个模型', 'zh-CN', { count: 3 }), '3 个模型')
})

test('i18next owns the active language and keeps legacy interpolation compatible', async () => {
  await i18n.changeLanguage('en-US')
  assert.equal(i18n.resolvedLanguage, 'en-US')
  assert.equal(translateText('搜索{page}', i18n.resolvedLanguage, { page: 'Memory' }), 'Search Memory')
  await i18n.changeLanguage('zh-CN')
})
