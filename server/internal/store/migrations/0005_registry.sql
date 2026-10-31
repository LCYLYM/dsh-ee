-- 内置 npm 源：托管包与上游镜像、逐版本审核、访问令牌、下载日志、预载任务，以及系统设置。
-- 包名只会是 ASCII，VARCHAR(214) 与 npm 的长度上限一致。

-- 系统设置：一行一个分组，value 是 JSON。目前只有 app（与前端 Settings 结构一致）。
CREATE TABLE settings (
  name       VARCHAR(64) NOT NULL,
  value      MEDIUMTEXT  NOT NULL,
  updated_by BIGINT      NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (name)
);

CREATE TABLE npm_packages (
  name           VARCHAR(214)  NOT NULL,
  -- hosted 企业作用域内发布的包（永不回源） / upstream 从上游镜像来的包
  origin         VARCHAR(16)   NOT NULL,
  -- 有任一版本声明了 dsh.bundle：会出现在能力市场与 DSH 索引里
  is_plugin      TINYINT(1)    NOT NULL DEFAULT 0,
  -- hosted：第一次发布的人，之后只有他和有审核权限的人能发新版本
  owner_id       BIGINT        NULL,
  dist_tags      TEXT          NOT NULL,
  -- 能力市场的展示信息：发布 / 预载时从清单或 dshfind 带过来
  title          VARCHAR(255)  NOT NULL DEFAULT '',
  description    VARCHAR(1024) NOT NULL DEFAULT '',
  author         VARCHAR(255)  NOT NULL DEFAULT '',
  category       VARCHAR(32)   NOT NULL DEFAULT '',
  kind           VARCHAR(16)   NOT NULL DEFAULT '',
  icon           VARCHAR(512)  NOT NULL DEFAULT '',
  homepage       VARCHAR(512)  NOT NULL DEFAULT '',
  repository     VARCHAR(512)  NOT NULL DEFAULT '',
  featured       TINYINT(1)    NOT NULL DEFAULT 0,
  upstream_score INT           NULL,
  upstream_stars INT           NULL,
  -- 作为预载根时的依赖闭包统计
  dep_count      INT           NULL,
  closure_size   BIGINT        NULL,
  offline_ready  TINYINT(1)    NULL,
  created_at     DATETIME(3)   NOT NULL,
  updated_at     DATETIME(3)   NOT NULL,
  PRIMARY KEY (name)
);

-- 每个版本一行。审核状态：pending 待审 / published 已上架 / rejected 已驳回 / unpublished 已下架。
-- 只有 published 的版本会出现在 packument 里、能被下载。
CREATE TABLE npm_versions (
  name               VARCHAR(214)  NOT NULL,
  version            VARCHAR(128)  NOT NULL,
  manifest           MEDIUMTEXT    NOT NULL,
  integrity          VARCHAR(128)  NOT NULL,
  shasum             CHAR(40)      NOT NULL,
  size               BIGINT        NOT NULL,
  blob_key           CHAR(128)     NOT NULL,
  is_plugin          TINYINT(1)    NOT NULL DEFAULT 0,
  has_install_script TINYINT(1)    NOT NULL DEFAULT 0,
  status             VARCHAR(16)   NOT NULL,
  -- 自动检查结果（JSON 数组）
  scan               TEXT          NULL,
  -- hosted：发布者；upstream：申请引入或执行预载的人
  publisher_id       BIGINT        NULL,
  review_note        VARCHAR(1024) NOT NULL DEFAULT '',
  reviewed_by        BIGINT        NULL,
  reviewed_at        DATETIME(3)   NULL,
  deprecated         VARCHAR(1024) NULL,
  created_at         DATETIME(3)   NOT NULL,
  published_at       DATETIME(3)   NULL,
  PRIMARY KEY (name, version),
  KEY idx_npm_versions_status (status, created_at)
);

-- npm / pnpm 用的个人令牌，只存 sha256。access: read 只能安装 / publish 还能发布。
CREATE TABLE npm_tokens (
  id           BIGINT       NOT NULL AUTO_INCREMENT,
  user_id      BIGINT       NOT NULL,
  name         VARCHAR(128) NOT NULL,
  prefix       VARCHAR(24)  NOT NULL,
  token_hash   CHAR(64)     NOT NULL,
  access       VARCHAR(16)  NOT NULL,
  last_used_at DATETIME(3)  NULL,
  revoked_at   DATETIME(3)  NULL,
  created_at   DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_npm_tokens_hash (token_hash),
  KEY idx_npm_tokens_user (user_id)
);

-- tarball 下载日志：安装审计与内部热门榜。
CREATE TABLE npm_downloads (
  id         BIGINT       NOT NULL AUTO_INCREMENT,
  name       VARCHAR(214) NOT NULL,
  version    VARCHAR(128) NOT NULL,
  user_id    BIGINT       NULL,
  token_id   BIGINT       NULL,
  created_at DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY idx_npm_downloads_name (name, created_at),
  KEY idx_npm_downloads_time (created_at)
);

-- 上游预载 / 申请引入 / 离线导入任务。
CREATE TABLE sync_jobs (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  kind        VARCHAR(16)  NOT NULL,
  status      VARCHAR(16)  NOT NULL,
  params      TEXT         NOT NULL,
  total       INT          NOT NULL DEFAULT 0,
  done        INT          NOT NULL DEFAULT 0,
  failed      INT          NOT NULL DEFAULT 0,
  bytes       BIGINT       NOT NULL DEFAULT 0,
  log         MEDIUMTEXT   NULL,
  created_by  BIGINT       NULL,
  created_at  DATETIME(3)  NOT NULL,
  finished_at DATETIME(3)  NULL,
  PRIMARY KEY (id),
  KEY idx_sync_jobs_time (created_at)
);
