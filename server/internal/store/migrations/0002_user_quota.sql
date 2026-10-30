-- 额度从「每个 key 各自限额」改为「每个用户一份月度额度」：
-- 同一用户的全部 key 共享额度；员工可以自助创建 / 吊销 key。
--
-- 三态约定：
--   monthly_token_limit IS NULL  不限额度（管理员显式选择）
--   monthly_token_limit = 0      未分配，不能调用
--   monthly_token_limit > 0      每月可用 token 上限（UTC 自然月重置）
ALTER TABLE users
  ADD COLUMN monthly_token_limit BIGINT NULL,
  ADD COLUMN allowed_models TEXT NULL,
  ADD COLUMN quota_expires_at DATETIME(3) NULL;

-- 迁移已有的 key 限额：所有 key 都有限额时合并为用户的月度额度；
-- 只要有一个 key 不限额，用户也保持不限额（NULL）。
UPDATE users u
SET monthly_token_limit = (
  SELECT SUM(k.monthly_token_limit) FROM api_keys k WHERE k.user_id = u.id
)
WHERE EXISTS (SELECT 1 FROM api_keys k WHERE k.user_id = u.id AND k.monthly_token_limit IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM api_keys k WHERE k.user_id = u.id AND k.monthly_token_limit IS NULL);

-- 没有 key 的历史用户默认 0（未分配）；管理员分配后才能自助建 key 调用。
UPDATE users u
SET monthly_token_limit = 0
WHERE NOT EXISTS (SELECT 1 FROM api_keys k WHERE k.user_id = u.id);

-- 管理员默认不限额，避免升级后被自己的额度挡住；可在「额度分配」里调整。
UPDATE users SET monthly_token_limit = NULL WHERE role = 'admin';

-- 旧 key 上的 allowed_models 继续生效（网关按「用户 ∩ key」校验），
-- 旧的 key 级 monthly_token_limit 不再使用，用户额度已在上面的回填里合并。
