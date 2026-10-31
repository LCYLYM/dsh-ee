-- 审计日志、npm 客户端信息、LDAP 账号。

CREATE TABLE audit_logs (
  id         BIGINT       NOT NULL AUTO_INCREMENT,
  -- 操作人；登录失败等匿名操作为 NULL
  actor_id   BIGINT       NULL,
  -- 操作时的用户名（账号改名或删除后仍可读）
  actor_name VARCHAR(64)  NOT NULL DEFAULT '',
  action     VARCHAR(64)  NOT NULL,
  target     VARCHAR(255) NOT NULL DEFAULT '',
  -- 附加信息（JSON 对象）
  detail     TEXT         NULL,
  ip         VARCHAR(64)  NOT NULL DEFAULT '',
  created_at DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY idx_audit_time (created_at),
  KEY idx_audit_action (action, created_at),
  KEY idx_audit_actor (actor_id, created_at)
);

-- 从 User-Agent 解析出的客户端（npm / pnpm / yarn）、操作系统与架构，用于终端分布
ALTER TABLE npm_downloads
  ADD COLUMN client VARCHAR(16) NOT NULL DEFAULT '',
  ADD COLUMN os     VARCHAR(16) NOT NULL DEFAULT '',
  ADD COLUMN arch   VARCHAR(16) NOT NULL DEFAULT '';

ALTER TABLE npm_downloads ADD INDEX idx_npm_downloads_user (user_id, created_at);

-- local：本地密码 / ldap：由企业目录认证，本地不存密码
ALTER TABLE users
  ADD COLUMN auth_source   VARCHAR(16)  NOT NULL DEFAULT 'local',
  ADD COLUMN email         VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN external_dn   VARCHAR(512) NULL,
  ADD COLUMN last_login_at DATETIME(3)  NULL;

-- 已有部署：把「审计日志」页面挂在「运营数据」后面（全新部署由默认菜单写入）
INSERT INTO menus (parent_id, kind, title, path, page_key, icon, permission, sort, visible, created_at, updated_at)
SELECT m.parent_id, 'page', '审计日志', '/admin/audit', 'admin-audit', 'ScrollText', 'audit.view', m.sort + 5, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM menus m WHERE m.page_key = 'admin-stats' LIMIT 1;
