package api

import "context"

// RunElevationExpiry 让黑盒测试单独跑管理模式到期监控（RunBackground 还会起一堆别的后台任务）。
func (s *Server) RunElevationExpiry(ctx context.Context) { s.runElevationExpiry(ctx) }
