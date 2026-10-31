import fs from 'node:fs'
import path from 'node:path'

const runtime = JSON.parse(fs.readFileSync(new URL('./runtime.json', import.meta.url), 'utf8'))

export const name = 'dsh-ee-agent-connect-spikes'
export const inject = {
  tools: { required: true },
  authorization: { required: false },
  credentials: { required: false },
  commands: { required: false },
}

const output = {
  schema: {},
  render(_args, value) {
    return [{ type: 'text', text: JSON.stringify(value) }]
  },
}

function definition(name, execute) {
  return {
    name,
    description: `Run the ${name} spike.`,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output,
    execute,
  }
}

export function apply(ctx) {
  const statePath = runtime.statePath
  const record = (type, data = {}) => {
    if (!statePath) return
    fs.mkdirSync(path.dirname(statePath), { recursive: true })
    fs.appendFileSync(statePath, `${JSON.stringify({ type, ...data })}\n`)
  }
  const register = (tool) => {
    const dispose = ctx.tools.register(tool)
    ctx.effect(() => dispose)
    return dispose
  }

  if (runtime.pendingPath && fs.existsSync(runtime.pendingPath)) {
    ctx.effect(async () => {
      const token = fs.readFileSync(runtime.pendingPath, 'utf8').trim()
      await ctx.get('credentials').set('DSHEE_TOKEN', token)
      fs.unlinkSync(runtime.pendingPath)
      record('s9-imported')
    })
  }

  const authorization = ctx.get('authorization')
  if (authorization) {
    const key = 'dsh-ee-spike/default'
    const dispose = authorization.registerFlow({
      key,
      label: 'dsh-ee spike',
      methods: [{ id: 'device', label: 'Authorize the spike device' }],
      async run(session) {
        session.notify({
          message: 'Authorize the spike device',
          url: 'http://127.0.0.1/device?code=KQ7M-4XPD',
          code: 'KQ7M-4XPD',
        })
        await session.commit({ kind: 'grant', payload: { token: 'ee_at_spike' } })
      },
    })
    ctx.effect(() => dispose)
    record('s1-flow-registered', { flows: authorization.list().map((flow) => flow.key) })
  }

  register(definition('spike_auth', async () => {
    if (!authorization) throw new Error('authorization service unavailable')
    let notice
    const outcome = await authorization.begin({
      key: 'dsh-ee-spike/default',
      method: 'device',
      interaction: {
        notify(value) {
          notice = value
        },
        async prompt() {
          throw new Error('unexpected prompt')
        },
      },
    })
    return { ...outcome, notice }
  }))

  register(definition('spike_rotate', async () => {
    const credentials = ctx.get('credentials')
    if (!credentials) throw new Error('credentials service unavailable')
    await credentials.set('DSHEE_TOKEN', 'token-two')
    const resolved = await credentials.resolve('DSHEE_TOKEN')
    record('s2-rotated', { source: resolved?.source })
    return { rotated: true }
  }))

  let disposeDynamic
  const dynamic = definition('spike_dynamic', async () => {
    record('s3-dynamic-executed')
    disposeDynamic?.()
    disposeDynamic = undefined
    return { removed: true }
  })
  register(definition('spike_add', async () => {
    disposeDynamic = register(dynamic)
    record('s3-dynamic-added')
    return { added: true }
  }))
  ctx.effect(() => () => disposeDynamic?.())

  register(definition('spike_write', async () => {
    record('s4-write-executed')
    return { written: true }
  }))
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name !== 'spike_write') return next()
    record('s4-approval-requested', { callId: exec.callId })
    return {
      kind: 'ask',
      reason: 'Run the spike write operation',
      displayReason: { en: 'Run the spike write operation', zh: '执行 spike 写操作' },
    }
  })

  const commands = ctx.get('commands')
  if (commands) {
    const credentials = ctx.get('credentials')
    let pending
    const registerCommand = (definition) => {
      const dispose = commands.register(definition)
      ctx.effect(() => dispose)
    }
    registerCommand({
      name: 'ee-login',
      description: 'Log in to the enterprise account',
      handler: () => {
        if (!pending) {
          record('s8-background-started')
          pending = (async () => {
            await new Promise((resolve) => setTimeout(resolve, 1500))
            await credentials.set('DSHEE_TOKEN', 'token-two')
            record('s8-background-completed')
          })()
        }
        record('s8-command-returned')
        return {
          kind: 'success',
          text: '请在浏览器确认，确认码 KQ7M-4XPD，链接 http://127.0.0.1/device?code=KQ7M-4XPD',
        }
      },
    })
    registerCommand({
      name: 'ee-status',
      description: 'Show enterprise login status',
      handler: async () => {
        const resolved = await credentials.resolve('DSHEE_TOKEN')
        return { kind: 'success', text: resolved ? `已登录，凭据来源 ${resolved.source}` : '未登录，请运行 /ee-login' }
      },
    })
  }
}
