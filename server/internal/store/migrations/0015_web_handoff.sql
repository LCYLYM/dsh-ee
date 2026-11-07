-- 从 DSH 打开网页免登录（第一版 M12）：凭设备令牌换来的网页会话标记为 limited，只带员工权限，
-- 管理功能仍要输入密码重新登录。
ALTER TABLE sessions ADD COLUMN limited TINYINT(1) NOT NULL DEFAULT 0;
