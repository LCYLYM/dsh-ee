package store

import (
	"context"
	"errors"
	"testing"
)

func TestDshReleaseStore(t *testing.T) {
	st := openTokenTestStore(t)
	ctx := context.Background()
	first := &DshRelease{Target: "mac-arm64", Kind: "zip", Version: "1.0.0", ReleasedAt: now(), File: "dsh-1.zip", Size: 100, SHA512: "aGFzaA==", UpstreamURL: "https://download.deepseek.com/dsh-1.zip", State: ReleaseAvailable}
	if err := st.CreateDshRelease(ctx, first); err != nil {
		t.Fatal(err)
	}
	duplicate := *first
	duplicate.ID = 0
	if err := st.CreateDshRelease(ctx, &duplicate); err == nil {
		t.Fatal("相同 target、kind、version 应触发唯一键冲突")
	}
	second := &DshRelease{Target: first.Target, Kind: first.Kind, Version: "1.0.1", ReleasedAt: now(), File: "dsh-2.zip", Size: 200, SHA512: "aGFzaA==", UpstreamURL: "https://download.deepseek.com/dsh-2.zip", State: ReleaseMirrored, LocalPath: "/tmp/dsh-2.zip"}
	if err := st.CreateDshRelease(ctx, second); err != nil {
		t.Fatal(err)
	}
	if err := st.SetDshReleaseRecommended(ctx, first.ID); !errors.Is(err, ErrReleaseNotMirrored) {
		t.Fatalf("未下载版本不能推荐：%v", err)
	}
	if err := st.UpdateDshReleaseState(ctx, first.ID, ReleaseMirrored, "/tmp/dsh-1.zip", ""); err != nil {
		t.Fatal(err)
	}
	if err := st.SetDshReleaseRecommended(ctx, first.ID); err != nil {
		t.Fatal(err)
	}
	if err := st.SetDshReleaseRecommended(ctx, second.ID); err != nil {
		t.Fatal(err)
	}
	items, err := st.ListDshReleases(ctx, first.Target)
	if err != nil || len(items) != 2 {
		t.Fatalf("版本列表：%d %v", len(items), err)
	}
	if !items[0].Recommended || items[0].ID != second.ID {
		t.Fatalf("推荐版本应排在最前：%+v", items[0])
	}
	old, err := st.DshReleaseByID(ctx, first.ID)
	if err != nil || old.Recommended {
		t.Fatalf("设置新推荐时应清除旧推荐：%+v %v", old, err)
	}
	if err := st.ResetDshRelease(ctx, second.ID); !errors.Is(err, ErrReleaseRecommended) {
		t.Fatalf("推荐版本不能删除：%v", err)
	}
	if err := st.ResetDshRelease(ctx, first.ID); err != nil {
		t.Fatal(err)
	}
	old, err = st.DshReleaseByID(ctx, first.ID)
	if err != nil || old.State != ReleaseAvailable || old.LocalPath != "" || old.MirroredAt != nil {
		t.Fatalf("删除本地文件后应回到 available：%+v %v", old, err)
	}
}
