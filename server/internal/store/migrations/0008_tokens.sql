-- 统一接入令牌、设备码登录、机器人账号，以及按令牌统计的用量与审计。

CREATE TABLE access_tokens (
  id                  BIGINT        NOT NULL AUTO_INCREMENT,
  user_id             BIGINT        NOT NULL,
  name                VARCHAR(128)  NOT NULL,
  prefix              VARCHAR(24)   NOT NULL,
  token_hash          CHAR(64)      NOT NULL,
  source              VARCHAR(16)   NOT NULL,
  scopes              VARCHAR(255)  NOT NULL,
  monthly_token_limit BIGINT        NULL,
  allowed_models      TEXT          NULL,
  expires_at          DATETIME(3)   NULL,
  sliding_days        INT           NULL,
  admin_until         DATETIME(3)   NULL,
  client_name         VARCHAR(128)  NOT NULL DEFAULT '',
  client_os           VARCHAR(64)   NOT NULL DEFAULT '',
  client_version      VARCHAR(64)   NOT NULL DEFAULT '',
  last_used_at        DATETIME(3)   NULL,
  last_ip             VARCHAR(64)   NOT NULL DEFAULT '',
  revoked_at          DATETIME(3)   NULL,
  created_by          BIGINT        NOT NULL,
  created_at          DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_access_tokens_hash (token_hash),
  KEY idx_access_tokens_user (user_id),
  KEY idx_access_tokens_client (user_id, client_name),
  KEY idx_access_tokens_expiry (expires_at)
);

CREATE TABLE device_codes (
  id               BIGINT        NOT NULL AUTO_INCREMENT,
  device_hash      CHAR(64)      NOT NULL,
  user_code        CHAR(8)       NOT NULL,
  client_name      VARCHAR(128)  NOT NULL DEFAULT '',
  client_os        VARCHAR(64)   NOT NULL DEFAULT '',
  client_version   VARCHAR(64)   NOT NULL DEFAULT '',
  client_ip        VARCHAR(64)   NOT NULL DEFAULT '',
  interval_seconds INT           NOT NULL DEFAULT 5,
  scopes           VARCHAR(255)  NOT NULL,
  status           VARCHAR(16)   NOT NULL,
  user_id          BIGINT        NULL,
  token_id         BIGINT        NULL,
  token_sealed     VARBINARY(256) NULL,
  last_poll_at     DATETIME(3)   NULL,
  expires_at       DATETIME(3)   NOT NULL,
  created_at       DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_device_hash (device_hash),
  UNIQUE KEY uk_device_user_code (user_code),
  KEY idx_device_expiry (expires_at)
);

ALTER TABLE users
  ADD COLUMN account_type VARCHAR(8) NOT NULL DEFAULT 'human',
  ADD COLUMN owner_id     BIGINT     NULL;

ALTER TABLE usage_logs ADD COLUMN token_id BIGINT NULL;
ALTER TABLE usage_logs ADD KEY idx_usage_token_time (token_id, created_at);

ALTER TABLE audit_logs
  ADD COLUMN via      VARCHAR(8)   NOT NULL DEFAULT 'web',
  ADD COLUMN token_id BIGINT       NULL,
  ADD COLUMN client   VARCHAR(128) NOT NULL DEFAULT '';

INSERT INTO permissions (code, name, group_name, description, builtin, created_at)
VALUES ('tokens.dept_manage', '本部门令牌管理', '大模型', '查看、下发和吊销本部门机器人账号的令牌', 1, UTC_TIMESTAMP(3));

UPDATE menus SET title = '我的令牌', path = '/tokens', updated_at = UTC_TIMESTAMP(3)
WHERE page_key = 'my-keys' AND title = '额度与 API key' AND path = '/keys';

UPDATE menus SET title = '令牌管理', path = '/admin/tokens', updated_at = UTC_TIMESTAMP(3)
WHERE page_key = 'admin-keys' AND title = 'API key' AND path = '/admin/keys';
