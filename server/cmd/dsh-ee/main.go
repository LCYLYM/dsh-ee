// dsh-ee 服务端入口。
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/hikariming/dsh-ee/server/internal/api"
	"github.com/hikariming/dsh-ee/server/internal/config"
	"github.com/hikariming/dsh-ee/server/internal/secret"
	"github.com/hikariming/dsh-ee/server/internal/store"
)

func main() {
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	if err := run(log); err != nil {
		log.Error("启动失败", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	st, err := store.Open(ctx, cfg.DSN)
	if err != nil {
		return err
	}
	defer st.Close()
	if err := st.Migrate(ctx); err != nil {
		return err
	}

	created, err := api.Bootstrap(ctx, st, cfg.BootstrapAdmin, cfg.BootstrapAdminPassword)
	if err != nil {
		return err
	}
	if created {
		log.Info("已创建初始管理员", "username", cfg.BootstrapAdmin)
	} else if n, _ := st.CountUsers(ctx); n == 0 {
		log.Warn("还没有任何用户：设置 DSH_EE_BOOTSTRAP_ADMIN_PASSWORD 后重启以创建管理员")
	}

	box, err := secret.NewBox(cfg.SecretKey)
	if err != nil {
		return err
	}
	srv := api.New(st, box, api.Options{CookieSecure: cfg.CookieSecure, SessionTTL: cfg.SessionTTL}, log)

	go sweepSessions(ctx, st, log)

	httpSrv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		// 不设 WriteTimeout：流式回答可能持续数分钟
	}
	errCh := make(chan error, 1)
	go func() {
		log.Info("dsh-ee 已启动", "addr", cfg.Addr)
		errCh <- httpSrv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		log.Info("正在关闭")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		return httpSrv.Shutdown(shutdownCtx)
	}
	return nil
}

// sweepSessions 每小时清理过期会话。
func sweepSessions(ctx context.Context, st *store.Store, log *slog.Logger) {
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if n, err := st.DeleteExpiredSessions(ctx); err != nil {
				log.Warn("清理过期会话失败", "err", err)
			} else if n > 0 {
				log.Info("已清理过期会话", "count", n)
			}
		}
	}
}
