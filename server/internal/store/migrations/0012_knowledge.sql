-- 知识库：文档原文转成 Markdown 存在库里，检索用 dsh-ee 进程里的关键词索引（不用向量）。设计见 docs/knowledge.md。

CREATE TABLE kb_bases (
  id          BIGINT        NOT NULL AUTO_INCREMENT,
  -- 给模型和网址用的标识，全局唯一
  slug        VARCHAR(64)   NOT NULL,
  title       VARCHAR(128)  NOT NULL,
  description VARCHAR(1024) NOT NULL DEFAULT '',
  -- 谁能查（JSON，与能力中心的可用范围相同）
  scope       TEXT          NOT NULL,
  -- 维护者（JSON）：{"users":[…],"roles":[…]}，能上传、编辑、删除文档
  maintainers TEXT          NOT NULL,
  -- 文档有任何变化就换一个，内存索引据此判断要不要重建
  revision    VARCHAR(32)   NOT NULL,
  created_by  BIGINT        NULL,
  created_at  DATETIME(3)   NOT NULL,
  updated_at  DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_kb_bases_slug (slug)
);

CREATE TABLE kb_docs (
  id          BIGINT        NOT NULL AUTO_INCREMENT,
  base_id     BIGINT        NOT NULL,
  title       VARCHAR(255)  NOT NULL,
  -- 目录，用 / 分隔，空表示根目录
  folder      VARCHAR(255)  NOT NULL DEFAULT '',
  -- 上传时的文件名、类型与原件（blob 存储里的 sha512），网页上编辑过的正文没有原件变化
  source_name VARCHAR(255)  NOT NULL DEFAULT '',
  mime        VARCHAR(128)  NOT NULL DEFAULT '',
  blob_key    VARCHAR(128)  NOT NULL DEFAULT '',
  size        BIGINT        NOT NULL DEFAULT 0,
  -- 当前正文的版本号（kb_doc_texts）与行数
  version     INT           NOT NULL,
  line_count  INT           NOT NULL DEFAULT 0,
  updated_by  BIGINT        NULL,
  created_at  DATETIME(3)   NOT NULL,
  updated_at  DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  KEY idx_kb_docs_base (base_id, folder)
);

-- 正文的每个版本：引用带着版本号，旧版本留着用来核对和回滚
CREATE TABLE kb_doc_texts (
  doc_id     BIGINT        NOT NULL,
  version    INT           NOT NULL,
  markdown   MEDIUMTEXT    NOT NULL,
  note       VARCHAR(255)  NOT NULL DEFAULT '',
  created_by BIGINT        NULL,
  created_at DATETIME(3)   NOT NULL,
  PRIMARY KEY (doc_id, version)
);

-- 模型与面板经 /mcp 的每一次检索与阅读
CREATE TABLE kb_queries (
  id         BIGINT        NOT NULL AUTO_INCREMENT,
  user_id    BIGINT        NOT NULL,
  -- search / read / browse
  tool       VARCHAR(16)   NOT NULL,
  query      VARCHAR(512)  NOT NULL DEFAULT '',
  -- 查了哪些库、读了或命中了哪些文档（JSON 数组）
  bases      TEXT          NOT NULL,
  docs       TEXT          NOT NULL,
  hits       INT           NOT NULL DEFAULT 0,
  created_at DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  KEY idx_kb_queries_time (created_at),
  KEY idx_kb_queries_user (user_id, created_at)
);

-- 已有部署：在「能力中心」后面挂上「知识库」
INSERT INTO menus (parent_id, kind, title, path, page_key, icon, permission, sort, visible, created_at, updated_at)
SELECT m.parent_id, 'page', '知识库', '/knowledge', 'knowledge', 'BookOpen', 'portal.view', m.sort + 5, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM menus m WHERE m.page_key = 'market' LIMIT 1;
