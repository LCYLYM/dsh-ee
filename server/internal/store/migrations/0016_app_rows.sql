-- 应用自带数据（第一版 M13）：所有应用的行放在一张通用表里，按 JSON 存，不为每个应用建表。
-- 删除（行被删、或整个应用被删）只记 deleted_at，30 天后清掉，这期间可以恢复。

CREATE TABLE app_rows (
  id         BIGINT      NOT NULL AUTO_INCREMENT,
  asset_id   BIGINT      NOT NULL,
  tbl        VARCHAR(40) NOT NULL,
  owner_id   BIGINT      NOT NULL,
  data       JSON        NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  updated_by BIGINT      NOT NULL,
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_app_rows_table (asset_id, tbl, deleted_at),
  KEY idx_app_rows_owner (owner_id),
  KEY idx_app_rows_deleted (deleted_at)
);
