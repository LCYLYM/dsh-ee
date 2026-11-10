-- 反馈与答不上来的问题（第一版 M8）：feedback 记每次 👍👎，unanswered 按信号聚合。

CREATE TABLE feedback (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  user_id     BIGINT       NOT NULL,
  asset_id    BIGINT       NOT NULL DEFAULT 0,
  session_ref VARCHAR(64)  NOT NULL DEFAULT '',
  message_ref VARCHAR(128) NOT NULL DEFAULT '',
  vote        TINYINT      NOT NULL,
  note        VARCHAR(500) NOT NULL DEFAULT '',
  created_at  DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY idx_feedback_asset (asset_id, created_at)
);

-- 答不上来的问题：同一应用同一信号同一问题合并计数；asset_id = 0 表示归不到具体应用；
-- kb 非空时记知识库标识（kb_empty 信号来自知识库检索）。
-- signal 是 MySQL 8.x 的保留字（SIGNAL ... SQLSTATE），列名与唯一键里都用反引号；
-- 反引号在 TiDB 与 OceanBase（MySQL 模式）下同样可用，不加时 MySQL 8.4 直接报 1064。
CREATE TABLE unanswered (
  id        BIGINT       NOT NULL AUTO_INCREMENT,
  asset_id  BIGINT       NOT NULL DEFAULT 0,
  kb        VARCHAR(48)  NOT NULL DEFAULT '',
  `signal`  VARCHAR(20)  NOT NULL,
  question  VARCHAR(200) NOT NULL,
  count     BIGINT       NOT NULL DEFAULT 1,
  last_at   DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_unanswered (asset_id, kb, `signal`, question)
);
