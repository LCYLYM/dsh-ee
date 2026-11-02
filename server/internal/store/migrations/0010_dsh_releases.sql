-- macOS DSH Desktop 官方安装包的同步、镜像与推荐版本。

CREATE TABLE dsh_releases (
  id           BIGINT       NOT NULL AUTO_INCREMENT,
  target       VARCHAR(32)  NOT NULL,
  kind         VARCHAR(8)   NOT NULL,
  version      VARCHAR(64)  NOT NULL,
  released_at  DATETIME(3)  NOT NULL,
  file         VARCHAR(255) NOT NULL,
  size         BIGINT       NOT NULL,
  sha512       VARCHAR(128) NOT NULL,
  upstream_url TEXT         NOT NULL,
  state        VARCHAR(16)  NOT NULL,
  recommended  BOOL         NOT NULL DEFAULT 0,
  local_path   TEXT         NULL,
  error        TEXT         NULL,
  mirrored_at  DATETIME(3)  NULL,
  created_at   DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_dsh_release_target_kind_version (target, kind, version),
  KEY idx_dsh_release_target_state (target, kind, state),
  KEY idx_dsh_release_recommended (target, kind, recommended)
);
