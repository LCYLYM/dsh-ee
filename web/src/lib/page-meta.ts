/**
 * 前端页面目录：每个页面组件一个稳定的 page_key。
 *
 * 页面叫什么、挂在哪个路由、放在哪个分组、谁能看，都在「菜单与页面」里在线配置（存后端 menus 表）；
 * 这里只记录组件本身的信息，供菜单编辑器选择，以及菜单里还没配置这个页面时作为站内链接的兜底路由。
 * 新增页面：在这里加一项，在 pages/registry.tsx 里登记组件，然后去「菜单与页面」把它挂出来。
 */
export interface PageMeta {
  title: string;
  /** 菜单里没有这个页面时，站内链接回退到这个路由。 */
  defaultPath: string;
  description: string;
}

const META = {
  workbench: { title: "我的工作台", defaultPath: "/workbench", description: "个人指标、我的微应用、已装能力" },
  apps: { title: "微应用", defaultPath: "/apps", description: "基于 DSH 运行的企业微应用" },
  market: { title: "能力市场", defaultPath: "/market", description: "浏览与安装企业能力（模拟数据）" },
  "dsh-download": { title: "下载 DSH", defaultPath: "/dsh", description: "DSH 核心与桌面版下载（模拟数据）" },
  setup: { title: "接入指南", defaultPath: "/setup", description: "一条命令接入企业源" },
  publish: { title: "分享能力", defaultPath: "/publish", description: "上传或申请引入能力（模拟数据）" },
  "my-keys": { title: "额度与 API key", defaultPath: "/keys", description: "我的额度，自助创建与吊销 key" },
  "admin-users": { title: "用户", defaultPath: "/admin/users", description: "账号、禁用、重置密码、分配角色" },
  "admin-roles": { title: "角色与权限", defaultPath: "/admin/roles", description: "角色、权限点与授权" },
  "admin-menus": { title: "菜单与页面", defaultPath: "/admin/menus", description: "页面名称、路由、图标、分组与访问权限" },
  "admin-providers": { title: "模型接入", defaultPath: "/admin/providers", description: "上游模型服务、企业 key 与对外模型" },
  "admin-quotas": { title: "额度分配", defaultPath: "/admin/quotas", description: "用户的月度 token 额度与可用模型" },
  "admin-keys": { title: "API key", defaultPath: "/admin/keys", description: "全部员工的 key：查看、代发、吊销" },
  "admin-dashboard": { title: "总览", defaultPath: "/admin", description: "全链路总览（模拟数据）" },
  "admin-stats": { title: "运营数据", defaultPath: "/admin/stats", description: "安装趋势与存储（模拟数据）" },
  "admin-plugins": { title: "能力管理", defaultPath: "/admin/plugins", description: "能力上下架（模拟数据）" },
  "admin-review": { title: "待审核", defaultPath: "/admin/review", description: "审核队列（模拟数据）" },
  "admin-registry": { title: "npm 源", defaultPath: "/admin/registry", description: "路由规则、上游、访问令牌（模拟数据）" },
  "admin-upstream": { title: "上游预载", defaultPath: "/admin/upstream", description: "在线同步与离线导入（模拟数据）" },
  "admin-distribution": { title: "DSH 分发", defaultPath: "/admin/distribution", description: "DSH 本体分发（模拟数据）" },
  "admin-settings": { title: "系统设置", defaultPath: "/admin/settings", description: "全局设置（模拟数据）" },
} satisfies Record<string, PageMeta>;

export type PageKey = keyof typeof META;

/** 按任意字符串取页面信息（菜单里的 page_key 来自数据库，可能不在目录里）。 */
export const PAGE_META: Record<string, PageMeta> = META;
