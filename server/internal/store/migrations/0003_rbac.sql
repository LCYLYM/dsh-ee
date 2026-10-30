-- RBAC：权限点 → 角色 → 用户（多角色），以及可在线配置的菜单 / 页面。
-- 权限点的名称、分组由服务启动时按代码里的目录同步；这里只建表和种子角色。

CREATE TABLE permissions (
  code        VARCHAR(64)  NOT NULL,
  name        VARCHAR(128) NOT NULL,
  group_name  VARCHAR(64)  NOT NULL DEFAULT '',
  description VARCHAR(255) NOT NULL DEFAULT '',
  -- 1 = 代码内置（随版本同步，不能删）；0 = 管理员自建（给还没有后端的页面用）
  builtin     TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  DATETIME(3)  NOT NULL,
  PRIMARY KEY (code)
);

CREATE TABLE roles (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  code        VARCHAR(64)  NOT NULL,
  name        VARCHAR(128) NOT NULL,
  description VARCHAR(255) NOT NULL DEFAULT '',
  -- 超级管理员：自动拥有全部权限（包括以后新增的）
  is_super    TINYINT(1)   NOT NULL DEFAULT 0,
  -- 内置角色不能删除
  builtin     TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  DATETIME(3)  NOT NULL,
  updated_at  DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_roles_code (code)
);

CREATE TABLE role_permissions (
  role_id         BIGINT      NOT NULL,
  permission_code VARCHAR(64) NOT NULL,
  PRIMARY KEY (role_id, permission_code),
  KEY idx_role_permissions_code (permission_code)
);

CREATE TABLE user_roles (
  user_id BIGINT NOT NULL,
  role_id BIGINT NOT NULL,
  PRIMARY KEY (user_id, role_id),
  KEY idx_user_roles_role (role_id)
);

-- 菜单即页面配置：前端只认 page_key 对应的组件，标题、路由、图标、分组、排序、
-- 所需权限都在这里改。kind: group 分组 / page 站内页面 / link 外部链接。
CREATE TABLE menus (
  id         BIGINT       NOT NULL AUTO_INCREMENT,
  parent_id  BIGINT       NULL,
  kind       VARCHAR(16)  NOT NULL,
  title      VARCHAR(64)  NOT NULL,
  path       VARCHAR(255) NULL,
  page_key   VARCHAR(64)  NULL,
  icon       VARCHAR(64)  NULL,
  permission VARCHAR(64)  NULL,
  sort       INT          NOT NULL DEFAULT 0,
  visible    TINYINT(1)   NOT NULL DEFAULT 1,
  created_at DATETIME(3)  NOT NULL,
  updated_at DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY idx_menus_parent (parent_id)
);

INSERT INTO roles (code, name, description, is_super, builtin, created_at, updated_at)
VALUES ('admin', '超级管理员', '拥有全部权限，包括以后新增的权限', 1, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3));

INSERT INTO roles (code, name, description, is_super, builtin, created_at, updated_at)
VALUES ('member', '员工', '新用户的默认角色', 0, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3));

-- 原有的 users.role 迁成角色关联
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id FROM users u JOIN roles r ON r.code = u.role;

ALTER TABLE users DROP COLUMN role;
