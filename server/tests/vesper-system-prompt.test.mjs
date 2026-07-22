import assert from 'node:assert/strict'
import test from 'node:test'
import { applyVesperSystemPrompt, vesperPromptExtension, vesperSystemPrompt } from '../prompts/vesper-system-prompt.mjs'

const piPrompt = `You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

Available tools:
- read: Read a file
- edit: Edit a file

Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):
- When reading pi docs or examples, resolve docs/... under Additional docs and examples/...
- When asked about: adding models (docs/models.md), pi packages (docs/packages.md)
- When working on pi topics, read the docs and examples
- Always read pi .md files completely`

test('Vesper prompt replaces only Pi branding while preserving the coding role and tool guidance', () => {
  const prompt = vesperSystemPrompt(piPrompt, { provider: 'xai', id: 'grok-4.5' })
  assert.match(prompt, /^You are an expert coding assistant operating inside Vesper/)
  assert.match(prompt, /Application: Vesper/)
  assert.match(prompt, /Active provider: xai/)
  assert.match(prompt, /Active model: grok-4\.5/)
  assert.match(prompt, /Respond in the language used by the user's latest message/)
  assert.match(prompt, /- read: Read a file/)
  assert.doesNotMatch(prompt, /You are Vesper/i)
  assert.doesNotMatch(prompt, /operating inside pi|Pi documentation|pi packages|pi topics|pi \.md/i)
})

test('Vesper prompt updates model identity without duplicating its runtime block', () => {
  const first = vesperSystemPrompt(piPrompt, { provider: 'openai', id: 'gpt-5.6' })
  const second = vesperSystemPrompt(first, { provider: 'anthropic', id: 'claude-sonnet-4-6' })
  assert.equal((second.match(/<vesper_runtime>/g) || []).length, 1)
  assert.match(second, /Active provider: anthropic/)
  assert.match(second, /Active model: claude-sonnet-4-6/)
  assert.doesNotMatch(second, /Active model: gpt-5\.6/)
})

test('Vesper prompt can be applied directly to an Agent session', () => {
  const session = {
    model: { provider: 'openai', id: 'gpt-5.6' },
    agent: { state: { systemPrompt: piPrompt } },
  }
  const prompt = applyVesperSystemPrompt(session)
  assert.equal(session.agent.state.systemPrompt, prompt)
  assert.match(prompt, /Application: Vesper/)
})

test('Vesper extension modifies the final per-turn system prompt with the active model', async () => {
  let handler
  vesperPromptExtension({
    on(event, value) {
      assert.equal(event, 'before_agent_start')
      handler = value
    },
  })
  const result = await handler({ systemPrompt: piPrompt }, { model: { provider: 'xai', id: 'grok-4.5' } })
  assert.match(result.systemPrompt, /^You are an expert coding assistant operating inside Vesper/)
  assert.match(result.systemPrompt, /Active provider: xai/)
  assert.match(result.systemPrompt, /Active model: grok-4\.5/)
})
