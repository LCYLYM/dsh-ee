import http from 'node:http'

function frame(data) {
  return `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`
}

export function textResponse(text) {
  return [
    { choices: [{ delta: { role: 'assistant', content: '' }, index: 0, finish_reason: null }] },
    { choices: [{ delta: { content: text }, index: 0, finish_reason: null }] },
    { choices: [{ delta: {}, index: 0, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1 } },
    '[DONE]',
  ]
}

let callCounter = 0

export function toolResponse(name, args = {}) {
  // 同一轮里多次调用同一个工具时 id 不能重复
  const id = `call_${name}_${++callCounter}`
  return [
    { choices: [{ delta: { role: 'assistant', content: '' }, index: 0, finish_reason: null }] },
    {
      choices: [{
        delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] },
        index: 0,
        finish_reason: null,
      }],
    },
    { choices: [{ delta: {}, index: 0, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 3, completion_tokens: 1 } },
    '[DONE]',
  ]
}

const scripts = {
  s1: [toolResponse('spike_auth'), textResponse('S1 finished')],
  s2: [toolResponse('spike_rotate'), textResponse('S2 finished')],
  s3: [toolResponse('spike_add'), toolResponse('spike_dynamic'), textResponse('S3 finished')],
  s4: [toolResponse('spike_write'), textResponse('S4 finished')],
  s7: [{
    status: 401,
    body: { error: { code: 'token_revoked', message: '企业账号登录已失效，在对话框输入 /ee-login 重新登录' } },
  }],
  's7-403': [{
    status: 403,
    body: { error: { code: 'token_expired', message: '企业账号登录已失效，在对话框输入 /ee-login 重新登录' } },
  }],
  's7-400': [{
    status: 400,
    body: { error: { message: '企业账号登录已失效，在对话框输入 /ee-login 重新登录', type: 'invalid_request_error', code: 'token_revoked' } },
  }],
  s8: [textResponse('S8 first turn'), textResponse('S8 finished')],
  s9: [textResponse('S9 finished')],
  s5: [
    toolResponse('mcp__acme__get_user', { mode: 'read', nested: { items: [{ id: '1' }] }, choice: 'x' }),
    toolResponse('bad.name'),
    toolResponse(`x${'y'.repeat(80)}`),
    textResponse('S5 finished'),
  ],
}

export async function startFakeLlm(scenario) {
  const selected = scenario === 's8-cli' ? 's8' : scenario.endsWith('-web') ? scenario.slice(0, -4) : scenario
  const script = [...(scripts[selected] ?? scripts.s4)]
  const requests = []
  // 按任务文本编排：请求的用户消息等于某个 task 时，依次取它的剧本；没有匹配的才走默认剧本。
  // DSH 的会话标题等附带请求不会匹配，不会吃掉工具调用。
  const tasks = new Map()
  const sse = { active: 0, opened: 0, closed: 0, maxActive: 0 }
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (req.method === 'GET' && req.url === '/sse') {
        sse.active += 1
        sse.opened += 1
        sse.maxActive = Math.max(sse.maxActive, sse.active)
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
        res.write('data: {"ready":true}\n\n')
        res.on('close', () => {
          sse.active -= 1
          sse.closed += 1
        })
        return
      }
      if (req.method === 'GET' && req.url === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'spike-model', object: 'model' }] }))
        return
      }
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
        res.writeHead(404).end()
        return
      }
      const body = JSON.parse(text)
      requests.push({ body, headers: req.headers })
      let behavior
      for (const [task, queue] of tasks) {
        if (queue.length && body.messages?.some((message) => message.role === 'user' && String(message.content) === task)) {
          behavior = queue.shift()
          break
        }
      }
      behavior ??= script.shift() ?? textResponse('script exhausted')
      // 剧本项可以是函数：按这次请求的内容（例如上一步工具返回的确认码）现算
      if (typeof behavior === 'function') behavior = behavior(body)
      if (!Array.isArray(behavior)) {
        res.writeHead(behavior.status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(behavior.body))
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const event of behavior) res.write(frame(event))
      res.end()
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return {
    requests,
    sse,
    script(task, behaviors) {
      tasks.set(task, [...behaviors])
    },
    url: `http://127.0.0.1:${address.port}/v1`,
    async close() {
      await new Promise((resolve) => server.close(resolve))
      server.closeAllConnections()
    },
  }
}
