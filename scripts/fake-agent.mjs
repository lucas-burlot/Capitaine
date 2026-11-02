// Replays the OSC 7501 status sequence Claude Code 2.1.316 emits, to exercise the agent UI
// without spending tokens. Run it inside a Capitaine terminal: `node scripts/fake-agent.mjs`.
const osc = (body) => process.stdout.write(`\x1b]7501;${body}\x07`)
const b64 = (text) => Buffer.from(text).toString('base64')
const title = (text) => process.stdout.write(`\x1b]0;${text}\x07`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const step = Number(process.env.FAKE_AGENT_STEP_MS ?? 1500)

if (process.stdin.isTTY) process.stdin.setRawMode(true)
// The terminal's probe reply lands on stdin; swallow it so it never echoes.
process.stdin.on('data', () => {})

osc('?')
await sleep(300)
title('Claude Code')
osc('state=idle:app=claude-code')
console.log('fake agent: idle')
await sleep(step)

title('Refactor du parseur')
osc('state=working:app=claude-code')
console.log('fake agent: working')
await sleep(step)

osc(`state=working:app=claude-code:id=a1:title=${b64('Explorer le code')}`)
osc(`state=working:app=claude-code:id=a2:title=${b64('Écrire les tests')}`)
console.log('fake agent: 2 subagents')
await sleep(step)

osc('state=clear:id=a1')
osc(`state=blocked:app=claude-code:kind=question:msg=${b64('answer: Garder l’ancien format ? (Oui · Non)')}`)
console.log('fake agent: blocked on a question')
await sleep(step * 2)

osc('state=clear:id=a2')
osc('state=working:app=claude-code')
await sleep(step)
osc('state=done:app=claude-code')
console.log('fake agent: done')
await sleep(Number(process.env.FAKE_AGENT_HOLD_MS ?? step))

osc('state=clear')
title('')
process.exit(0)
