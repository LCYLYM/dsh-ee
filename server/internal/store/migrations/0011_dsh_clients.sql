-- 记录接入插件的宿主，供员工下载页确认 Desktop 已上线。

ALTER TABLE access_tokens
  ADD COLUMN last_client VARCHAR(128) NOT NULL DEFAULT '',
  ADD COLUMN last_host   VARCHAR(128) NOT NULL DEFAULT '';

ALTER TABLE access_tokens ADD KEY idx_access_tokens_client_active (user_id, last_used_at);
