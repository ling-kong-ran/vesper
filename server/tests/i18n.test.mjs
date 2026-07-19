import assert from 'node:assert/strict'
import test from 'node:test'
import { translateText } from '../../src/app/i18n.js'

test('English interface translations resolve static and interpolated messages', () => {
  assert.equal(translateText('配置', 'en-US'), 'Settings')
  assert.equal(translateText('界面语言', 'en-US'), 'Display language')
  assert.equal(translateText('{count} 个模型', 'en-US', { count: 3 }), '3 models')
  assert.equal(translateText('删除 Provider 连接', 'en-US'), 'Delete Provider connection')
})

test('Chinese remains the default interface language', () => {
  assert.equal(translateText('界面语言'), '界面语言')
  assert.equal(translateText('{count} 个模型', 'zh-CN', { count: 3 }), '3 个模型')
})
