-- 知识库「待补文档」里被维护者点了「忽略」的检索词（这是库外的问题，不用补）。
CREATE TABLE kb_gap_ignores (
  base_id    BIGINT        NOT NULL,
  -- 归一化后的检索词：小写、去重、排序后用空格连起来
  query_key  VARCHAR(255)  NOT NULL,
  created_by BIGINT        NULL,
  created_at DATETIME(3)   NOT NULL,
  PRIMARY KEY (base_id, query_key)
);
