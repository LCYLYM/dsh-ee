package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/hikariming/dsh-ee/server/internal/store"
)

// 反馈与「答不上来的问题」（第一版 M8）。
// DSH 里每条回答旁的 👍👎 打到 POST /api/dsh/feedback；kb 检索为空、app__ 工具报错、被点 👎
// 都会聚合成 unanswered，作者在自己的应用详情里看到合并后的待办（只有问题文本和次数）。

// handleDshFeedback：员工对一次回答打分。app 是会话当前绑定的应用（插件填），可以空。
func (s *Server) handleDshFeedback(w http.ResponseWriter, r *http.Request) {
	v, ok := s.dshAuth(w, r)
	if !ok {
		return
	}
	var req struct {
		App     string `json:"app"`
		Session string `json:"session"`
		Message string `json:"message"`
		Vote    int    `json:"vote"`
		Note    string `json:"note"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	if req.Vote != 1 && req.Vote != -1 {
		writeErr(w, http.StatusBadRequest, "vote 只能是 1 或 -1")
		return
	}
	var assetID int64
	if slug := strings.TrimSpace(req.App); slug != "" {
		if a, err := s.store.GetAssetBySlug(r.Context(), slug); err == nil && a.Kind == store.KindApp {
			assetID = a.ID
		}
	}
	f := &store.Feedback{UserID: v.user.ID, AssetID: assetID, SessionRef: req.Session, MessageRef: req.Message, Vote: req.Vote}
	// 按字符截断：列是字符长度，按字节切会把中文截成半个字符。
	req.Note = truncate(req.Note, 500)
	f.Note = req.Note
	ctx := context.WithoutCancel(r.Context())
	if err := s.store.RecordFeedback(ctx, f); err != nil {
		s.internalErr(w, r, err)
		return
	}
	if req.Vote < 0 {
		q := req.Note
		if q == "" {
			q = "（未说明原因的差评）"
		}
		if err := s.store.RecordUnanswered(ctx, assetID, "", "thumbs_down", q); err != nil {
			s.log.Warn("记录答不上来的问题失败", "err", err)
		}
	}
	s.audit(r, "feedback.vote", req.App, map[string]any{"vote": req.Vote})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// feedbackExtras 给能力详情补上反馈统计与待办问题（只有问题文本和次数，看不到是谁）。
func (s *Server) feedbackExtras(r *http.Request, resp map[string]any, a *store.Asset) {
	if a.Kind != store.KindApp {
		return
	}
	if st, err := s.store.FeedbackStats(r.Context(), a.ID); err == nil && (st.Up+st.Down) > 0 {
		resp["feedback"] = st
	}
	if qs, err := s.store.UnansweredFor(r.Context(), a.ID, 10); err == nil && len(qs) > 0 {
		resp["questions"] = qs
	}
}
