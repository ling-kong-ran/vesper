const RUNTIME_BLOCK = /\n*<vesper_runtime>[\s\S]*?<\/vesper_runtime>\n*/g
const PI_OPENING = 'You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.'
const VESPER_OPENING = 'You are an expert coding assistant operating inside Vesper, a desktop coding agent application. You help users by reading files, executing commands, editing code, and writing new files.'

function modelIdentity(model) {
  const provider = String(model?.provider || 'unknown').trim() || 'unknown'
  const id = String(model?.id || model?.model || 'unknown').trim() || 'unknown'
  return { provider, id }
}

export function vesperSystemPrompt(basePrompt, model) {
  const identity = modelIdentity(model)
  const prompt = String(basePrompt || '')
    .replace(RUNTIME_BLOCK, '\n\n')
    .replace(PI_OPENING, VESPER_OPENING)
    .replace(
      'Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):',
      'Vesper runtime documentation (read only when the user asks about Vesper internals, its embedded SDK, extensions, themes, skills, or UI runtime):',
    )
    .replace('When reading pi docs or examples', 'When reading Vesper runtime docs or examples')
    .replace('adding models (docs/models.md), pi packages (docs/packages.md)', 'adding models (docs/models.md), runtime packages (docs/packages.md)')
    .replace('When working on pi topics, read the docs and examples', 'When working on Vesper runtime topics, read the docs and examples')
    .replace('Always read pi .md files completely', 'Always read the referenced runtime .md files completely')
    .trim()
  const runtime = `<vesper_runtime>
Application: Vesper
Active provider: ${identity.provider}
Active model: ${identity.id}

Runtime response rules:
- Preserve the coding-agent role, tool instructions, skills, and project context defined above.
- If asked about the application or product, name Vesper.
- If asked which model is active, report the exact active provider and model shown above. Do not guess a training identity or a different model.
- Respond in the language used by the user's latest message unless the user explicitly requests another language.
- Keep technical names, source-code identifiers, file paths, and quoted text in their original form when appropriate.
</vesper_runtime>`

  return `${prompt}\n\n${runtime}`.trim()
}

export function applyVesperSystemPrompt(session, model = session?.model) {
  if (!session?.agent?.state) return ''
  const prompt = vesperSystemPrompt(session.agent.state.systemPrompt, model)
  session.agent.state.systemPrompt = prompt
  return prompt
}

export function vesperPromptExtension(pi) {
  pi.on('before_agent_start', async (event, context) => ({
    systemPrompt: vesperSystemPrompt(event.systemPrompt, context.model),
  }))
}
