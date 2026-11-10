-- 配额检查在每次模型调用前都要算「这个账号 / 令牌本月用了多少 token」：
--   SELECT SUM(total_tokens) FROM usage_logs WHERE user_id = ? AND created_at >= 月初
-- 原来的 (user_id, created_at) 索引里没有 total_tokens，每命中一行都要回表取一次，
-- 耗时随本月调用次数线性增长（重度用户、机器人账号到月底一次检查要回表十万行以上）。
-- 把 total_tokens 带进索引后，求和只扫索引。先建新索引再删旧的，中间不会出现没有索引可用的时刻。
ALTER TABLE usage_logs ADD KEY idx_usage_user_tokens (user_id, created_at, total_tokens);
ALTER TABLE usage_logs ADD KEY idx_usage_token_tokens (token_id, created_at, total_tokens);
ALTER TABLE usage_logs DROP KEY idx_usage_user_time;
ALTER TABLE usage_logs DROP KEY idx_usage_token_time;
