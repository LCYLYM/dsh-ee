import http from 'node:http'

function frame(data) {
  return `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`
}

function textResponse(text) {
  return [
    { choices: [{ delta: { role: 'assistant', content: '' }, index: 0, finish_reason: null }] },
    { choices: [{ delta: { content: text }, index: 0, finish_reason: null }] },
    { choices: [{ delta: {}, index: 0, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1 } },
    '[DONE]',
  ]
}

function toolResponse(name) {
  return [
    { choices: [{ delta: { role: 'assistant', content: '' }, index: 0, finish_reason: null }] },
    {
      choices: [{
        delta: { tool_calls: [{ index: 0, id: `call_${name}`, type: 'function', function: { name, arguments: '{}' } }] },
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
}

export async function startFakeLlm(scenario) {
  const selected = scenario === 's8-cli' ? 's8' : scenario.endsWith('-web') ? scenario.slice(0, -4) : scenario
  const script = [...(scripts[selected] ?? scripts.s4)]
  const requests = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
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
      const behavior = script.shift() ?? textResponse('script exhausted')
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
    url: `http://127.0.0.1:${address.port}/v1`,
    async close() {
      await new Promise((resolve) => server.close(resolve))
      server.closeAllConnections()
    },
  }
}
