-- 示例公司（第一版 M1）：导入时记下每一项示例数据，清除时只删这些，不碰用户自己建的内容。

CREATE TABLE demo_records (
  -- kb / asset / user / usage（模拟使用数据的标记，ref_id 为 0）
  kind       VARCHAR(16)  NOT NULL,
  ref_id     BIGINT       NOT NULL,
  slug       VARCHAR(128) NOT NULL DEFAULT '',
  created_at DATETIME(3)  NOT NULL,
  PRIMARY KEY (kind, ref_id)
);
