// dsh-ee 接入插件：把企业的技能、提示词与微应用接进 DSH，并安装企业设为「自动安装」的插件。
// 企业连接（MCP）与模型由同一组合包里的 dsh-mcp-client、llm-pi-ai 配置行负责。
// 本文件由 dsh-ee 生成，请勿手改：重新接入或 dsh-ee 升级时会被覆盖。

export const name = 'dsh-ee-connect'
export const inject = { skills: { required: true }, pluginManager: { required: false } }

const PREFIX = '[dsh-ee]'

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ baseUrl: string, tokenEnv: string, pollSeconds: number, rank: number, installRequired: boolean }} config
 */
export function apply(ctx, config) {
  const base = String(config.baseUrl ?? '').replace(/\/+$/, '')
  if (!/^https?:\/\//.test(base)) throw new Error(`${PREFIX} baseUrl 必须是 http(s) 地址`)
  const tokenEnv = config.tokenEnv || 'DSHEE_TOKEN'
  const pollMs = Math.max(15, Number(config.pollSeconds) || 60) * 1000
  const rank = Number.isInteger(config.rank) ? config.rank : 350
  const token = () => process.env[tokenEnv] ?? ''
  const log = (...args) => console.error(PREFIX, ...args)

  /** 最近一次拿到的目录；etag 为空表示还没拿到过。 */
  let catalog = { skills: [], required_plugins: [] }
  let etag = ''
  let warned = ''
  const warnOnce = (msg) => {
    if (msg !== warned) log(msg)
    warned = msg
  }

  /** 拉取目录；目录有变化返回 true。 */
  async function refresh(signal) {
    if (!token()) {
      warnOnce(`缺少接入令牌：在 dsh-ee 的「接入指南」生成令牌，写进 DSH 的 .env：${tokenEnv}=<令牌>`)
      return false
    }
    const headers = { Authorization: `Bearer ${token()}`, Accept: 'application/json' }
    if (etag) headers['If-None-Match'] = etag
    const res = await fetch(`${base}/api/dsh/catalog`, { headers, signal })
    if (res.status === 304) return false
    if (!res.ok) {
      warnOnce(`读取企业能力目录失败：HTTP ${res.status}`)
      return false
    }
    catalog = await res.json()
    etag = res.headers.get('etag') ?? 'loaded'
    warned = ''
    return true
  }

  // ---- 必装插件 ----
  let installing = false
  async function installRequired() {
    if (!config.installRequired || installing) return
    const manager = ctx.get('pluginManager')
    if (!manager || catalog.required_plugins.length === 0) return
    installing = true
    try {
      const have = new Set((await manager.listBundles()).filter((b) => b.installed || b.enabled).map((b) => b.name))
      for (const p of catalog.required_plugins) {
        if (have.has(p.name)) continue
        log(`安装企业插件 ${p.name}@${p.version}`)
        const result = await manager.installBundle(p.name, { registry: `${base}/npm/` })
        if (result.error) log(`安装 ${p.name} 失败：${result.error.message ?? result.application}`)
        else if (result.application === 'restart-required') log(`${p.name} 已安装，重启 DSH 后生效`)
      }
    } catch (error) {
      log('安装企业插件失败：', error instanceof Error ? error.message : error)
    } finally {
      installing = false
    }
  }

  // ---- 技能来源 ----
  ctx.skills.registerProvider((control) => {
    let timer
    const tick = async () => {
      try {
        if (await refresh(control.signal)) {
          control.invalidate()
          await installRequired()
        }
      } catch (error) {
        if (!control.signal.aborted) warnOnce(`连不上 dsh-ee（${base}）：${error instanceof Error ? error.message : error}`)
      } finally {
        if (!control.signal.aborted) timer = setTimeout(tick, pollMs)
      }
    }
    // 启动后先等一会儿再装插件，免得和 DSH 自己的启动抢 profile
    timer = setTimeout(tick, 5000)
    control.signal.addEventListener('abort', () => clearTimeout(timer))

    return {
      name: 'dsh-ee',
      async list(options) {
        if (!etag) {
          try {
            await refresh(options.signal)
          } catch (error) {
            warnOnce(`连不上 dsh-ee（${base}）：${error instanceof Error ? error.message : error}`)
            return { candidates: [], complete: false }
          }
        }
        return catalog.skills.map((s) => {
          const candidate = {
            name: s.name,
            description: s.description || s.title,
            invocation: { modelInvocable: Boolean(s.model_invocable), userInvocable: Boolean(s.user_invocable) },
            provider: 'dsh-ee',
            source: 'dsh-ee',
            rank,
            locator: s.name,
            metadata: { title: s.title, kind: s.kind, version: s.version },
          }
          if (s.when_to_use) candidate.whenToUse = s.when_to_use
          return candidate
        })
      },
      async get(candidate, options) {
        const res = await fetch(`${base}/api/dsh/skills/${encodeURIComponent(String(candidate.locator))}`, {
          headers: { Authorization: `Bearer ${token()}`, Accept: 'application/json' },
          signal: options.signal,
        })
        if (!res.ok) return undefined
        const body = await res.json()
        const { rank: _rank, locator: _locator, ...summary } = candidate
        return { ...summary, content: body.content }
      },
    }
  })
}
