-- 大模型接入：上游加厂商、优先级与连通性检查结果；模型单独成表，
-- 支持「对外名称 ↔ 上游模型名」映射，同一对外名称挂多个上游时按优先级故障转移。
-- providers.models（JSON）从此不再使用，启动时由程序把旧数据导入 models 表。

ALTER TABLE providers
  ADD COLUMN vendor VARCHAR(32) NOT NULL DEFAULT 'custom',
  ADD COLUMN priority INT NOT NULL DEFAULT 100,
  ADD COLUMN last_check_at DATETIME(3) NULL,
  ADD COLUMN last_check_ok TINYINT(1) NULL,
  ADD COLUMN last_check_msg VARCHAR(255) NOT NULL DEFAULT '';

CREATE TABLE models (
  id             BIGINT       NOT NULL AUTO_INCREMENT,
  provider_id    BIGINT       NOT NULL,
  -- 员工调用时写的模型名（对外名称）
  name           VARCHAR(128) NOT NULL,
  -- 转发给上游时替换成的模型名
  upstream_model VARCHAR(128) NOT NULL,
  display_name   VARCHAR(128) NOT NULL DEFAULT '',
  enabled        TINYINT(1)   NOT NULL DEFAULT 1,
  created_at     DATETIME(3)  NOT NULL,
  updated_at     DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_models_provider_name (provider_id, name),
  KEY idx_models_name (name)
);
