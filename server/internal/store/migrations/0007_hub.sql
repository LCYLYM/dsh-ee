-- 能力中心：技能、提示词、微应用、企业连接，以及插件的可用范围与下发方式。

CREATE TABLE assets (
  id          BIGINT        NOT NULL AUTO_INCREMENT,
  -- skill / prompt / app / connection
  kind        VARCHAR(16)   NOT NULL,
  -- 技能名（DSH 里的 /名字）或连接名（MCP 工具名前缀），全局唯一
  slug        VARCHAR(64)   NOT NULL,
  title       VARCHAR(128)  NOT NULL,
  description VARCHAR(1024) NOT NULL DEFAULT '',
  category    VARCHAR(32)   NOT NULL DEFAULT '',
  owner_id    BIGINT        NULL,
  -- 可用范围（JSON）：{"all":true} 或 {"departments":[…],"roles":[…],"users":[…]}
  scope       TEXT          NOT NULL,
  -- auto：范围内的人自动生效 / optional：在能力中心自己启用
  delivery    VARCHAR(16)   NOT NULL DEFAULT 'optional',
  -- active / unpublished（整体下架）
  status      VARCHAR(16)   NOT NULL DEFAULT 'active',
  -- 连接的上游凭据，主密钥加密
  secret_enc  VARBINARY(4096) NULL,
  secret_hint VARCHAR(16)   NOT NULL DEFAULT '',
  created_at  DATETIME(3)   NOT NULL,
  updated_at  DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_assets_slug (slug),
  KEY idx_assets_kind (kind)
);

CREATE TABLE asset_versions (
  asset_id    BIGINT        NOT NULL,
  version     INT           NOT NULL,
  -- 内容（JSON），按 kind 解释
  spec        MEDIUMTEXT    NOT NULL,
  -- pending / published / rejected，与 npm 包版本一致
  status      VARCHAR(16)   NOT NULL,
  review_note VARCHAR(1024) NOT NULL DEFAULT '',
  created_by  BIGINT        NULL,
  reviewed_by BIGINT        NULL,
  reviewed_at DATETIME(3)   NULL,
  created_at  DATETIME(3)   NOT NULL,
  PRIMARY KEY (asset_id, version),
  KEY idx_asset_versions_status (status, created_at)
);

CREATE TABLE asset_subscriptions (
  user_id    BIGINT      NOT NULL,
  asset_id   BIGINT      NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (user_id, asset_id),
  KEY idx_asset_subscriptions_asset (asset_id)
);

-- DSH 加载技能、提示词、微应用的记录（使用统计）
CREATE TABLE asset_usage (
  id         BIGINT      NOT NULL AUTO_INCREMENT,
  asset_id   BIGINT      NOT NULL,
  user_id    BIGINT      NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_asset_usage_asset (asset_id, created_at),
  KEY idx_asset_usage_time (created_at)
);

-- 插件的可用范围与下发方式；没有记录表示全公司可见、自选安装
CREATE TABLE plugin_policies (
  name       VARCHAR(214) NOT NULL,
  scope      TEXT         NOT NULL,
  -- optional：自选安装 / auto：范围内的人的 DSH 自动安装
  delivery   VARCHAR(16)  NOT NULL,
  updated_by BIGINT       NULL,
  updated_at DATETIME(3)  NOT NULL,
  PRIMARY KEY (name)
);

-- 连接的工具：从上游 MCP 同步，或由 OpenAPI 导入
CREATE TABLE connection_tools (
  asset_id     BIGINT        NOT NULL,
  name         VARCHAR(64)   NOT NULL,
  description  TEXT          NOT NULL,
  input_schema MEDIUMTEXT    NOT NULL,
  -- OpenAPI 操作：{"method":"GET","path":"/customers/{id}","params":[…],"body":true}
  operation    TEXT          NULL,
  read_only    TINYINT(1)    NOT NULL DEFAULT 0,
  enabled      TINYINT(1)    NOT NULL DEFAULT 1,
  -- 额外限定的角色（JSON 数组）；空表示连接可用范围内的人都能用
  roles        TEXT          NULL,
  updated_at   DATETIME(3)   NOT NULL,
  PRIMARY KEY (asset_id, name)
);

CREATE TABLE connection_calls (
  id         BIGINT        NOT NULL AUTO_INCREMENT,
  asset_id   BIGINT        NOT NULL,
  tool       VARCHAR(64)   NOT NULL,
  user_id    BIGINT        NOT NULL,
  ok         TINYINT(1)    NOT NULL,
  error      VARCHAR(512)  NOT NULL DEFAULT '',
  latency_ms INT           NOT NULL,
  created_at DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  KEY idx_connection_calls_asset (asset_id, created_at),
  KEY idx_connection_calls_time (created_at)
);

-- 「能力市场」改名为「能力中心」（管理员改过名字或路由的不动）
UPDATE menus SET title = '能力中心', path = '/hub', updated_at = UTC_TIMESTAMP(3)
WHERE page_key = 'market' AND title = '能力市场' AND path = '/market';

-- 已有部署：在「能力管理」后面挂上「企业连接」
INSERT INTO menus (parent_id, kind, title, path, page_key, icon, permission, sort, visible, created_at, updated_at)
SELECT m.parent_id, 'page', '企业连接', '/admin/connections', 'admin-connections', 'Cable', 'connections.manage', m.sort + 5, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM menus m WHERE m.page_key = 'admin-plugins' LIMIT 1;
