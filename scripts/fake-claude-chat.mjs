#!/usr/bin/env node
// Stand-in for `claude -p --input-format stream-json …` in the smoke test: answers `initialize` and
// `set_model`, and plays back the frames Claude Code 2.1 sends for `/context`, `/help`, `/clear`
// and a plain message (recorded from the real CLI, trimmed to the fields the chat reads).
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'

const MODELS = { default: 'claude-opus-5-5', opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' }
const NAMES = { default: 'Default (recommended)', opus: 'Opus 5.5', sonnet: 'Sonnet 5.5', haiku: 'Haiku 5.5' }
let model = MODELS.default
let sessionId = randomUUID()

const send = (frame) => process.stdout.write(`${JSON.stringify({ ...frame, session_id: sessionId })}\n`)
const state = (value) => send({ type: 'system', subtype: 'session_state_changed', state: value })
const init = () => send({ type: 'system', subtype: 'init', model, permissionMode: 'default' })
const synthetic = (text) => send({ type: 'assistant', message: { id: randomUUID(), model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text }] } })
const result = (numTurns, durationMs) => send({ type: 'result', subtype: 'success', is_error: false, num_turns: numTurns, duration_ms: durationMs, total_cost_usd: 0 })
const commandEcho = (uuid, name, args = '') =>
  send({
    type: 'user',
    uuid,
    isReplay: true,
    parent_tool_use_id: null,
    message: { role: 'user', content: `<command-name>/${name}</command-name>\n            <command-message>${name}</command-message>\n            <command-args>${args}</command-args>` }
  })

function control(message) {
  const { request_id: requestId, request } = message
  const reply = (response) => send({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } })
  if (request.subtype === 'initialize') {
    return reply({
      commands: [
        { name: 'clear', description: 'Start a new conversation', argumentHint: '' },
        { name: 'context', description: 'Show context usage', argumentHint: '' },
        { name: 'model', description: 'Set the AI model', argumentHint: '[model]' }
      ],
      models: Object.keys(MODELS).map((value) => ({ value, displayName: NAMES[value], description: '', supportedEffortLevels: ['low', 'high'] })),
      account: { tokenSource: 'claude.ai' },
      capabilities: []
    })
  }
  if (request.subtype === 'set_model') {
    if (!MODELS[request.model]) {
      return send({ type: 'control_response', response: { subtype: 'error', request_id: requestId, error: `Model '${request.model}' not found` } })
    }
    model = MODELS[request.model]
    return reply({ model })
  }
  reply({})
}

function user(message) {
  const text = (message.message.content ?? []).map((block) => (block.type === 'text' ? block.text : '')).join('').trim()
  state('running')
  init()
  if (text === '/context') {
    synthetic('## Context Usage\n\n**Tokens:** 14.9k / 1m (1%)\n\n| Category | Tokens |\n|----------|--------|\n| System prompt | 2.7k |\n| Messages | 8 |')
    commandEcho(message.uuid, 'context')
    result(0, 557)
  } else if (text === '/help') {
    synthetic("/help isn't available in this environment.")
    result(0, 14)
  } else if (text === '/clear') {
    send({ type: 'conversation_reset', trigger: 'clear', user_message_uuid: message.uuid })
    sessionId = randomUUID()
    init()
    commandEcho(message.uuid, 'clear')
    result(0, 20)
  } else {
    send({ type: 'user', uuid: message.uuid, isReplay: true, parent_tool_use_id: null, message: message.message })
    const id = `msg_${randomUUID()}`
    const answer = `Réponse à : ${text}`
    send({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'message_start', message: { id } } })
    send({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } })
    for (const word of answer.split(/(?= )/)) {
      send({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: word } } })
    }
    send({ type: 'assistant', parent_tool_use_id: null, message: { id, model, role: 'assistant', content: [{ type: 'text', text: answer }], usage: { input_tokens: 9000, output_tokens: 20 } } })
    send({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_stop', index: 0 } })
    send({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'message_stop' } })
    result(1, 2300)
  }
  state('idle')
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return
  const message = JSON.parse(line)
  if (message.type === 'control_request') control(message)
  else if (message.type === 'user') user(message)
})
