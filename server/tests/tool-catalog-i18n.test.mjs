import assert from 'node:assert/strict'
import test from 'node:test'
import { translateText } from '../../src/app/i18n.js'
import { toolNameKey } from '../../src/features/plugins/tool-labels.js'
import { TOOL_CATALOG } from '../tools/registry.mjs'

const CJK_PATTERN = /[\u3400-\u9fff]/

test('tool catalog labels and user-facing metadata have English translations', () => {
  for (const tool of TOOL_CATALOG) {
    const nameKey = toolNameKey(tool)
    assert.ok(nameKey, `${tool.id} is missing a localized name key`)
    assert.notEqual(translateText(nameKey, 'en-US'), nameKey, `${tool.id} name is not internationalized`)

    for (const field of ['category', 'risk', 'description', 'scope', 'capability']) {
      const value = String(tool[field] || '')
      if (!CJK_PATTERN.test(value)) continue
      assert.notEqual(translateText(value, 'en-US'), value, `${tool.id}.${field} is not internationalized`)
    }
  }

  assert.equal(translateText('Vesper 应用工具', 'en-US'), 'Vesper app tools')
  assert.equal(translateText('Vesper 内置工具', 'en-US'), 'Vesper built-in tools')
})
