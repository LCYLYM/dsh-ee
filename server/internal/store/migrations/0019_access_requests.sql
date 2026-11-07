-- 统一的权限申请（第一版 M7）：原来的连接申请扩成连接、技能、知识库三类。
-- kind = connection / skill 时 asset_id 是能力的 id；kind = knowledge 时是知识库的 id。
-- app_id 是「为了用哪个应用」申请的（0 表示没有指明）；note 是审批人写的说明。
ALTER TABLE connection_requests
  ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT 'connection',
  ADD COLUMN app_id BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN note VARCHAR(500) NOT NULL DEFAULT '';
