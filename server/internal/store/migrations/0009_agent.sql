-- DSH 里的 Agent 操作 dsh-ee：危险操作的两步确认，以及员工申请使用企业连接。

-- 危险操作先返回预览并发一个一次性确认码；确认码绑定用户、令牌、工具、动作与参数哈希。
CREATE TABLE agent_confirms (
  id         BIGINT       NOT NULL AUTO_INCREMENT,
  user_id    BIGINT       NOT NULL,
  token_id   BIGINT       NOT NULL DEFAULT 0,
  tool       VARCHAR(64)  NOT NULL,
  action     VARCHAR(64)  NOT NULL,
  args_hash  CHAR(64)     NOT NULL,
  nonce_hash CHAR(64)     NOT NULL,
  expires_at DATETIME(3)  NOT NULL,
  used_at    DATETIME(3)  NULL,
  created_at DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_agent_confirm_nonce (nonce_hash),
  KEY idx_agent_confirm_expiry (expires_at)
);

-- 员工申请使用某个企业连接；管理员在审计日志与能力中心里看到后处理。
CREATE TABLE connection_requests (
  id         BIGINT       NOT NULL AUTO_INCREMENT,
  user_id    BIGINT       NOT NULL,
  asset_id   BIGINT       NOT NULL,
  reason     VARCHAR(500) NOT NULL DEFAULT '',
  status     VARCHAR(16)  NOT NULL DEFAULT 'pending',
  handled_by BIGINT       NULL,
  handled_at DATETIME(3)  NULL,
  created_at DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY idx_connection_requests_user (user_id, created_at),
  KEY idx_connection_requests_status (status, created_at)
);
