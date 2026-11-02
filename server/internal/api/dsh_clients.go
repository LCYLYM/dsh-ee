package api

import (
	"net/http"
	"time"
)

func (s *Server) handleMyDshClients(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.ListActiveDshClients(r.Context(), currentUser(r).ID, time.Now().Add(-10*time.Minute))
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		out = append(out, map[string]any{
			"client_name": item.ClientName, "last_client": item.LastClient, "last_host": item.LastHost, "last_used_at": item.LastUsedAt,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"clients": out})
}
