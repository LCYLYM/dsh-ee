-- 人人都能搭建（第一版 M4）：「自己用」免审核、扩大范围走审核；菜单按「用 / 造 / 管」重组。

-- 负责人申请扩大到的范围（JSON，同 scope），审核通过前不生效
ALTER TABLE assets
  ADD COLUMN pending_scope      TEXT          NULL,
  ADD COLUMN scope_requested_at DATETIME(3)   NULL,
  ADD COLUMN scope_note         VARCHAR(1024) NOT NULL DEFAULT '';

-- ---- 菜单：只改还是默认值的项，管理员改过名字或路由的不动 ----

UPDATE menus SET title = '用', updated_at = UTC_TIMESTAMP(3)
WHERE kind = 'group' AND parent_id IS NULL AND title = '工作台';

UPDATE menus SET title = '企业应用', sort = 10, updated_at = UTC_TIMESTAMP(3)
WHERE page_key = 'apps' AND title = '微应用' AND path = '/apps';

UPDATE menus SET title = '知识问答', sort = 20, updated_at = UTC_TIMESTAMP(3)
WHERE page_key = 'knowledge' AND title = '知识库' AND path = '/knowledge';

UPDATE menus SET sort = 30, updated_at = UTC_TIMESTAMP(3)
WHERE page_key = 'workbench' AND title = '我的工作台' AND path = '/workbench';

-- 能力中心对员工只剩应用：去掉这一项，/hub 由前端跳到「企业应用」或「原料」
DELETE FROM menus WHERE page_key = 'market' AND title = '能力中心' AND path = '/hub';

-- 「造」与「接入」两个分组，排在「用」后面（全新部署的菜单表还是空的，由启动时写入默认菜单）
INSERT INTO menus (parent_id, kind, title, path, page_key, icon, permission, sort, visible, created_at, updated_at)
SELECT NULL, 'group', '造', NULL, NULL, NULL, NULL, 13, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM DUAL WHERE EXISTS (SELECT 1 FROM menus);

INSERT INTO menus (parent_id, kind, title, path, page_key, icon, permission, sort, visible, created_at, updated_at)
SELECT NULL, 'group', '接入', NULL, NULL, NULL, NULL, 16, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM DUAL WHERE EXISTS (SELECT 1 FROM menus);

INSERT INTO menus (parent_id, kind, title, path, page_key, icon, permission, sort, visible, created_at, updated_at)
SELECT g.id, 'page', '新建应用', '/build/new', 'app-new', 'SquarePlus', 'registry.publish', 10, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM menus g WHERE g.kind = 'group' AND g.title = '造' AND g.parent_id IS NULL ORDER BY g.id DESC LIMIT 1;

INSERT INTO menus (parent_id, kind, title, path, page_key, icon, permission, sort, visible, created_at, updated_at)
SELECT g.id, 'page', '我的应用', '/build', 'build', 'LayoutGrid', 'portal.view', 20, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM menus g WHERE g.kind = 'group' AND g.title = '造' AND g.parent_id IS NULL ORDER BY g.id DESC LIMIT 1;

INSERT INTO menus (parent_id, kind, title, path, page_key, icon, permission, sort, visible, created_at, updated_at)
SELECT g.id, 'page', '从样板复制', '/build/templates', 'templates', 'Copy', 'registry.publish', 30, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM menus g WHERE g.kind = 'group' AND g.title = '造' AND g.parent_id IS NULL ORDER BY g.id DESC LIMIT 1;

INSERT INTO menus (parent_id, kind, title, path, page_key, icon, permission, sort, visible, created_at, updated_at)
SELECT g.id, 'page', '原料', '/build/materials', 'materials', 'Layers', 'portal.view', 40, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM menus g WHERE g.kind = 'group' AND g.title = '造' AND g.parent_id IS NULL ORDER BY g.id DESC LIMIT 1;

-- 「分享能力」（上传插件）挪进「造」并从侧边栏隐藏，入口在「原料 → 高级选项」
UPDATE menus m JOIN (SELECT id FROM menus WHERE kind = 'group' AND title = '造' AND parent_id IS NULL ORDER BY id DESC LIMIT 1) g
SET m.parent_id = g.id, m.title = '分享插件', m.visible = 0, m.sort = 50, m.updated_at = UTC_TIMESTAMP(3)
WHERE m.page_key = 'publish' AND m.title = '分享能力' AND m.path = '/publish';

UPDATE menus m JOIN (SELECT id FROM menus WHERE kind = 'group' AND title = '接入' AND parent_id IS NULL ORDER BY id DESC LIMIT 1) g
SET m.parent_id = g.id, m.sort = 10, m.updated_at = UTC_TIMESTAMP(3)
WHERE m.page_key = 'dsh-download' AND m.title = '下载 DSH' AND m.path = '/dsh';

UPDATE menus m JOIN (SELECT id FROM menus WHERE kind = 'group' AND title = '接入' AND parent_id IS NULL ORDER BY id DESC LIMIT 1) g
SET m.parent_id = g.id, m.sort = 20, m.updated_at = UTC_TIMESTAMP(3)
WHERE m.page_key = 'setup' AND m.title = '接入指南' AND m.path = '/setup';

UPDATE menus m JOIN (SELECT id FROM menus WHERE kind = 'group' AND title = '接入' AND parent_id IS NULL ORDER BY id DESC LIMIT 1) g
SET m.parent_id = g.id, m.sort = 30, m.updated_at = UTC_TIMESTAMP(3)
WHERE m.page_key = 'my-keys' AND m.title = '我的令牌' AND m.path = '/tokens';
