-- 管理后台导航重组：网页侧栏把 /admin 页面单独作为「管理后台」显示，管理分组按要办的事拆细；
-- 系统设置里的「品牌与外观」「登录方式」各自成页。只改还是默认值的项，管理员改过名字或路由的不动。
-- 全新部署的菜单表是空的，由启动时写入默认菜单（rbac.DefaultMenus），下面的语句都不生效。

UPDATE menus SET title = '运营', sort = 100, updated_at = UTC_TIMESTAMP(3)
WHERE kind = 'group' AND parent_id IS NULL AND title = '管理';

UPDATE menus SET title = '账号与权限', sort = 110, updated_at = UTC_TIMESTAMP(3)
WHERE kind = 'group' AND parent_id IS NULL AND title = '账号与模型';

INSERT INTO menus (parent_id, kind, title, path, page_key, icon, permission, sort, visible, created_at, updated_at)
SELECT NULL, 'group', '模型与额度', NULL, NULL, NULL, NULL, 120, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM DUAL WHERE EXISTS (SELECT 1 FROM menus) AND NOT EXISTS (SELECT 1 FROM menus WHERE kind = 'group' AND parent_id IS NULL AND title = '模型与额度');

INSERT INTO menus (parent_id, kind, title, path, page_key, icon, permission, sort, visible, created_at, updated_at)
SELECT NULL, 'group', '能力与连接', NULL, NULL, NULL, NULL, 130, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM DUAL WHERE EXISTS (SELECT 1 FROM menus) AND NOT EXISTS (SELECT 1 FROM menus WHERE kind = 'group' AND parent_id IS NULL AND title = '能力与连接');

INSERT INTO menus (parent_id, kind, title, path, page_key, icon, permission, sort, visible, created_at, updated_at)
SELECT NULL, 'group', '分发与源', NULL, NULL, NULL, NULL, 140, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM DUAL WHERE EXISTS (SELECT 1 FROM menus) AND NOT EXISTS (SELECT 1 FROM menus WHERE kind = 'group' AND parent_id IS NULL AND title = '分发与源');

INSERT INTO menus (parent_id, kind, title, path, page_key, icon, permission, sort, visible, created_at, updated_at)
SELECT NULL, 'group', '系统', NULL, NULL, NULL, NULL, 150, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM DUAL WHERE EXISTS (SELECT 1 FROM menus) AND NOT EXISTS (SELECT 1 FROM menus WHERE kind = 'group' AND parent_id IS NULL AND title = '系统');

-- 默认页面挪进新分组
UPDATE menus m JOIN (SELECT id FROM menus WHERE kind = 'group' AND title = '运营' AND parent_id IS NULL ORDER BY id DESC LIMIT 1) g
SET m.parent_id = g.id, m.sort = 10, m.updated_at = UTC_TIMESTAMP(3)
WHERE m.page_key = 'admin-dashboard' AND m.title = '总览' AND m.path = '/admin';

UPDATE menus m JOIN (SELECT id FROM menus WHERE kind = 'group' AND title = '运营' AND parent_id IS NULL ORDER BY id DESC LIMIT 1) g
SET m.parent_id = g.id, m.sort = 20, m.updated_at = UTC_TIMESTAMP(3)
WHERE m.page_key = 'admin-stats' AND m.title = '运营数据' AND m.path = '/admin/stats';

UPDATE menus m JOIN (SELECT id FROM menus WHERE kind = 'group' AND title = '运营' AND parent_id IS NULL ORDER BY id DESC LIMIT 1) g
SET m.parent_id = g.id, m.sort = 30, m.updated_at = UTC_TIMESTAMP(3)
WHERE m.page_key = 'admin-audit' AND m.title = '审计日志' AND m.path = '/admin/audit';

UPDATE menus m JOIN (SELECT id FROM menus WHERE kind = 'group' AND title = '账号与权限' AND parent_id IS NULL ORDER BY id DESC LIMIT 1) g
SET m.parent_id = g.id, m.sort = 10, m.updated_at = UTC_TIMESTAMP(3)
WHERE m.page_key = 'admin-users' AND m.title = '用户' AND m.path = '/admin/users';

UPDATE menus m JOIN (SELECT id FROM menus WHERE kind = 'group' AND title = '账号与权限' AND parent_id IS NULL ORDER BY id DESC LIMIT 1) g
SET m.parent_id = g.id, m.sort = 20, m.updated_at = UTC_TIMESTAMP(3)
WHERE m.page_key = 'admin-roles' AND m.title = '角色与权限' AND m.path = '/admin/roles';

UPDATE menus m JOIN (SELECT id FROM menus WHERE kind = 'group' AND title = '账号与权限' AND parent_id IS NULL ORDER BY id DESC LIMIT 1) g
SET m.parent_id = g.id, m.sort = 30, m.updated_at = UTC_TIMESTAMP(3)
WHERE m.page_key = 'admin-menus' AND m.title = '菜单与页面' AND m.path = '/admin/menus';

UPDATE menus m JOIN (SELECT id FROM menus WHERE kind = 'group' AND title = '模型与额度' AND parent_id IS NULL ORDER BY id DESC LIMIT 1) g
SET m.parent_id = g.id, m.sort = 10, m.updated_at = UTC_TIMESTAMP(3)
WHERE m.page_key = 'admin-providers' AND m.title = '模型接入' AND m.path = '/admin/providers';

UPDATE menus m JOIN (SELECT id FROM menus WHERE kind = 'group' AND title = '模型与额度' AND parent_id IS NULL ORDER BY id DESC LIMIT 1) g
SET m.parent_id = g.id, m.sort = 20, m.updated_at = UTC_TIMESTAMP(3)
WHERE m.page_key = 'admin-quotas' AND m.title = '额度分配' AND m.path = '/admin/quotas';

UPDATE menus m JOIN (SELECT id FROM menus WHERE kind = 'group' AND title = '模型与额度' AND parent_id IS NULL ORDER BY id DESC LIMIT 1) g
SET m.parent_id = g.id, m.sort = 30, m.updated_at = UTC_TIMESTAMP(3)
WHERE m.page_key = 'admin-keys' AND m.title = '令牌管理' AND m.path = '/admin/tokens';

UPDATE menus m JOIN (SELECT id FROM menus WHERE kind = 'group' AND title = '能力与连接' AND parent_id IS NULL ORDER BY id DESC LIMIT 1) g
SET m.parent_id = g.id, m.sort = 10, m.updated_at = UTC_TIMESTAMP(3)
WHERE m.page_key = 'admin-plugins' AND m.title = '能力管理' AND m.path = '/admin/plugins';

UPDATE menus m JOIN (SELECT id FROM menus WHERE kind = 'group' AND title = '能力与连接' AND parent_id IS NULL ORDER BY id DESC LIMIT 1) g
SET m.parent_id = g.id, m.sort = 20, m.updated_at = UTC_TIMESTAMP(3)
WHERE m.page_key = 'admin-review' AND m.title = '待审核' AND m.path = '/admin/review';

UPDATE menus m JOIN (SELECT id FROM menus WHERE kind = 'group' AND title = '能力与连接' AND parent_id IS NULL ORDER BY id DESC LIMIT 1) g
SET m.parent_id = g.id, m.sort = 30, m.updated_at = UTC_TIMESTAMP(3)
WHERE m.page_key = 'admin-connections' AND m.title = '企业连接' AND m.path = '/admin/connections';

UPDATE menus m JOIN (SELECT id FROM menus WHERE kind = 'group' AND title = '分发与源' AND parent_id IS NULL ORDER BY id DESC LIMIT 1) g
SET m.parent_id = g.id, m.sort = 10, m.updated_at = UTC_TIMESTAMP(3)
WHERE m.page_key = 'admin-distribution' AND m.title = 'DSH 分发' AND m.path = '/admin/distribution';

UPDATE menus m JOIN (SELECT id FROM menus WHERE kind = 'group' AND title = '分发与源' AND parent_id IS NULL ORDER BY id DESC LIMIT 1) g
SET m.parent_id = g.id, m.sort = 20, m.updated_at = UTC_TIMESTAMP(3)
WHERE m.page_key = 'admin-registry' AND m.title = 'npm 源' AND m.path = '/admin/registry';

UPDATE menus m JOIN (SELECT id FROM menus WHERE kind = 'group' AND title = '分发与源' AND parent_id IS NULL ORDER BY id DESC LIMIT 1) g
SET m.parent_id = g.id, m.sort = 30, m.updated_at = UTC_TIMESTAMP(3)
WHERE m.page_key = 'admin-upstream' AND m.title = '上游预载' AND m.path = '/admin/upstream';

UPDATE menus m JOIN (SELECT id FROM menus WHERE kind = 'group' AND title = '系统' AND parent_id IS NULL ORDER BY id DESC LIMIT 1) g
SET m.parent_id = g.id, m.sort = 30, m.updated_at = UTC_TIMESTAMP(3)
WHERE m.page_key = 'admin-settings' AND m.title = '系统设置' AND m.path = '/admin/settings';

-- 新页面放在「系统设置」所在的分组里（管理员挪过系统设置，就跟着它）
INSERT INTO menus (parent_id, kind, title, path, page_key, icon, permission, sort, visible, created_at, updated_at)
SELECT s.parent_id, 'page', '品牌与外观', '/admin/brand', 'admin-brand', 'Palette', 'settings.manage', 10, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM menus s WHERE s.page_key = 'admin-settings' AND NOT EXISTS (SELECT 1 FROM menus WHERE page_key = 'admin-brand') ORDER BY s.id LIMIT 1;

INSERT INTO menus (parent_id, kind, title, path, page_key, icon, permission, sort, visible, created_at, updated_at)
SELECT s.parent_id, 'page', '登录方式', '/admin/auth', 'admin-auth', 'LogIn', 'settings.manage', 20, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM menus s WHERE s.page_key = 'admin-settings' AND NOT EXISTS (SELECT 1 FROM menus WHERE page_key = 'admin-auth') ORDER BY s.id LIMIT 1;

-- 挪空了的分组删掉（管理员自己建的分组不会被挪空，不受影响）
DELETE g FROM menus g LEFT JOIN menus c ON c.parent_id = g.id
WHERE g.kind = 'group' AND g.parent_id IS NULL AND g.title IN ('运营', '账号与权限', '模型与额度', '能力与连接', '分发与源', '系统') AND c.id IS NULL;
