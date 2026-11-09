package api

import (
	"context"
	"net/http"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/hikariming/dsh-ee/server/internal/store"
)

// 「待补文档」：员工（经 AI）想查却没查到的东西，给维护者补文档用。
// 模型一次提问会换好几个说法搜，单看「这次搜索没命中」噪音很大（「宿费」没命中，换成「住宿」就找到了）。
// 所以只有一次没命中的搜索之后 gapWindow 内，同一个人没有读过这个库里任何文档，才算真的没查到。

const (
	gapWindow = 10 * time.Minute
	gapDays   = 30
)

type kbGap struct {
	Key    string    `json:"key"`
	Query  string    `json:"query"` // 最近一次原样的检索词
	Count  int       `json:"count"`
	Users  int       `json:"users"`
	LastAt time.Time `json:"last_at"`
}

// gapKey 把检索词归一化：小写、去重、排序。「住宿 标准」和「标准 住宿」算同一个。
func gapKey(q string) string {
	var terms []string
	for _, t := range strings.Fields(strings.ToLower(q)) {
		if !slices.Contains(terms, t) {
			terms = append(terms, t)
		}
	}
	sort.Strings(terms)
	key := strings.Join(terms, " ")
	if len([]rune(key)) > 200 {
		key = string([]rune(key)[:200])
	}
	return key
}

// kbGaps 算出这些库最近 30 天的待补检索词，按次数排序。
func (s *Server) kbGaps(ctx context.Context, bases []int64) (map[int64][]kbGap, error) {
	since := time.Now().AddDate(0, 0, -gapDays)
	searches, err := s.store.RecentKQueries(ctx, store.KQueryFilter{Tool: "search", Since: since, Limit: 5000})
	if err != nil {
		return nil, err
	}
	reads, err := s.store.RecentKQueries(ctx, store.KQueryFilter{Tool: "read", Since: since, Limit: 5000})
	if err != nil {
		return nil, err
	}
	ignores, err := s.store.KBGapIgnores(ctx)
	if err != nil {
		return nil, err
	}
	// 每个人读过哪个库的时间
	readAt := map[int64][]*store.KQuery{}
	for _, r := range reads {
		readAt[r.UserID] = append(readAt[r.UserID], r)
	}
	readAfter := func(user, base int64, t time.Time) bool {
		for _, r := range readAt[user] {
			if !r.CreatedAt.Before(t) && r.CreatedAt.Sub(t) <= gapWindow && slices.Contains(r.Bases, base) {
				return true
			}
		}
		return false
	}
	type acc struct {
		gap   kbGap
		users map[int64]bool
	}
	byBase := map[int64]map[string]*acc{}
	for _, q := range searches {
		if q.Hits > 0 {
			continue
		}
		key := gapKey(q.Query)
		if key == "" {
			continue
		}
		for _, b := range q.Bases {
			if !slices.Contains(bases, b) || ignores[b][key] || readAfter(q.UserID, b, q.CreatedAt) {
				continue
			}
			if byBase[b] == nil {
				byBase[b] = map[string]*acc{}
			}
			a := byBase[b][key]
			if a == nil {
				a = &acc{gap: kbGap{Key: key, Query: q.Query, LastAt: q.CreatedAt}, users: map[int64]bool{}}
				byBase[b][key] = a
			}
			a.gap.Count++
			a.users[q.UserID] = true
			if q.CreatedAt.After(a.gap.LastAt) {
				a.gap.LastAt, a.gap.Query = q.CreatedAt, q.Query
			}
		}
	}
	out := map[int64][]kbGap{}
	for b, m := range byBase {
		for _, a := range m {
			a.gap.Users = len(a.users)
			out[b] = append(out[b], a.gap)
		}
		sort.Slice(out[b], func(i, j int) bool {
			x, y := out[b][i], out[b][j]
			if x.Users != y.Users {
				return x.Users > y.Users
			}
			if x.Count != y.Count {
				return x.Count > y.Count
			}
			return x.LastAt.After(y.LastAt)
		})
	}
	return out, nil
}

// GET /api/kb/{id}/gaps：维护者看的「待补文档」和「常被读的文档」。
func (s *Server) handleKBGaps(w http.ResponseWriter, r *http.Request) {
	b, v, ok := s.loadKBase(w, r)
	if !ok {
		return
	}
	if !v.kbMaintains(b) {
		writeErr(w, http.StatusForbidden, "只有维护者能看这个库的检索情况")
		return
	}
	gaps, err := s.kbGaps(r.Context(), []int64{b.ID})
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	items := gaps[b.ID]
	if items == nil {
		items = []kbGap{}
	}
	// 常被读的文档：最近 30 天读的次数
	reads, err := s.store.RecentKQueries(r.Context(), store.KQueryFilter{Tool: "read", Base: b.ID, Since: time.Now().AddDate(0, 0, -gapDays), Limit: 5000})
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	count := map[int64]int{}
	readers := map[int64]map[int64]bool{}
	for _, q := range reads {
		for _, d := range q.Docs {
			count[d]++
			if readers[d] == nil {
				readers[d] = map[int64]bool{}
			}
			readers[d][q.UserID] = true
		}
	}
	docs, err := s.store.ListKDocs(r.Context(), b.ID)
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	type popular struct {
		Doc   int64  `json:"doc"`
		Title string `json:"title"`
		Reads int    `json:"reads"`
		Users int    `json:"users"`
	}
	pop := []popular{}
	for _, d := range docs {
		if count[d.ID] > 0 {
			pop = append(pop, popular{Doc: d.ID, Title: d.Title, Reads: count[d.ID], Users: len(readers[d.ID])})
		}
	}
	sort.Slice(pop, func(i, j int) bool { return pop[i].Reads > pop[j].Reads })
	if len(pop) > 10 {
		pop = pop[:10]
	}
	writeJSON(w, http.StatusOK, map[string]any{"gaps": items, "popular": pop, "days": gapDays})
}

type kbGapIgnoreReq struct {
	Key string `json:"key"`
}

// POST /api/kb/{id}/gaps/ignore：这个检索词不用补（库外的问题）。
func (s *Server) handleKBGapIgnore(w http.ResponseWriter, r *http.Request) {
	b, v, ok := s.loadKBase(w, r)
	if !ok {
		return
	}
	var req kbGapIgnoreReq
	if !readJSON(w, r, &req) {
		return
	}
	if !v.kbMaintains(b) {
		writeErr(w, http.StatusForbidden, "只有维护者能处理这个库的待补文档")
		return
	}
	key := gapKey(req.Key)
	if key == "" {
		writeErr(w, http.StatusBadRequest, "key 不能为空")
		return
	}
	if err := s.store.IgnoreKBGap(r.Context(), b.ID, key, currentUser(r).ID); err != nil {
		s.internalErr(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
