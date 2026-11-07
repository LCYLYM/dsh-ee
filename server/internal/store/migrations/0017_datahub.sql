-- 数据中台（第一版 M15）：表与数据集的说明。表本身在单独的库（如 dsh_ee_data）里。

CREATE TABLE data_tables (
  name        VARCHAR(40)  NOT NULL,
  title       VARCHAR(64)  NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  columns     JSON         NOT NULL,
  row_count   BIGINT       NOT NULL DEFAULT 0,
  created_by  BIGINT       NOT NULL,
  updated_by  BIGINT       NOT NULL,
  created_at  DATETIME(3)  NOT NULL,
  updated_at  DATETIME(3)  NOT NULL,
  PRIMARY KEY (name)
);

CREATE TABLE data_sets (
  id          BIGINT        NOT NULL AUTO_INCREMENT,
  slug        VARCHAR(48)   NOT NULL,
  title       VARCHAR(64)   NOT NULL,
  description VARCHAR(500)  NOT NULL DEFAULT '',
  sql_text    TEXT          NOT NULL,
  params      JSON          NOT NULL,
  scope       JSON          NOT NULL,
  created_by  BIGINT        NOT NULL,
  updated_by  BIGINT        NOT NULL,
  created_at  DATETIME(3)   NOT NULL,
  updated_at  DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_data_sets_slug (slug)
);
