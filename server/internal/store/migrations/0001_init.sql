-- 只用 MySQL 协议里 OceanBase（MySQL 模式）与 TiDB 都支持的写法：
-- 时间由应用写入（UTC），JSON 存 TEXT，不依赖外键。

CREATE TABLE users (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  username      VARCHAR(64)  NOT NULL,
  display_name  VARCHAR(128) NOT NULL DEFAULT '',
  department    VARCHAR(128) NOT NULL DEFAULT '',
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(16)  NOT NULL DEFAULT 'member',
  disabled      TINYINT(1)   NOT NULL DEFAULT 0,
  created_at    DATETIME(3)  NOT NULL,
  updated_at    DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_username (username)
);

-- 会话只存 token 的 sha256，数据库泄露也拿不到可用的 cookie。
CREATE TABLE sessions (
  token_hash CHAR(64)    NOT NULL,
  user_id    BIGINT      NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (token_hash),
  KEY idx_sessions_user (user_id)
);

-- 企业的上游模型服务（OpenAI 兼容接口），api_key 用主密钥 AES-GCM 加密。
CREATE TABLE providers (
  id           BIGINT        NOT NULL AUTO_INCREMENT,
  name         VARCHAR(64)   NOT NULL,
  base_url     VARCHAR(512)  NOT NULL,
  api_key_enc  VARBINARY(1024) NOT NULL,
  api_key_hint VARCHAR(16)   NOT NULL DEFAULT '',
  models       TEXT          NOT NULL,
  enabled      TINYINT(1)    NOT NULL DEFAULT 1,
  created_at   DATETIME(3)   NOT NULL,
  updated_at   DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_providers_name (name)
);

-- 分发给员工的 key，只存 sha256；明文只在创建时返回一次。
CREATE TABLE api_keys (
  id                  BIGINT       NOT NULL AUTO_INCREMENT,
  user_id             BIGINT       NOT NULL,
  name                VARCHAR(128) NOT NULL,
  prefix              VARCHAR(24)  NOT NULL,
  key_hash            CHAR(64)     NOT NULL,
  monthly_token_limit BIGINT       NULL,
  allowed_models      TEXT         NULL,
  expires_at          DATETIME(3)  NULL,
  revoked_at          DATETIME(3)  NULL,
  last_used_at        DATETIME(3)  NULL,
  created_by          BIGINT       NOT NULL,
  created_at          DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_api_keys_hash (key_hash),
  KEY idx_api_keys_user (user_id)
);

-- 每次经网关的调用一行：既是用量统计，也是审计记录。
CREATE TABLE usage_logs (
  id                BIGINT       NOT NULL AUTO_INCREMENT,
  api_key_id        BIGINT       NOT NULL,
  user_id           BIGINT       NOT NULL,
  provider_id       BIGINT       NOT NULL,
  model             VARCHAR(128) NOT NULL,
  prompt_tokens     INT          NOT NULL DEFAULT 0,
  completion_tokens INT          NOT NULL DEFAULT 0,
  total_tokens      INT          NOT NULL DEFAULT 0,
  status_code       INT          NOT NULL,
  latency_ms        INT          NOT NULL,
  created_at        DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY idx_usage_key_time (api_key_id, created_at),
  KEY idx_usage_user_time (user_id, created_at)
);
