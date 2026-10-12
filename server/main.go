// 幽州迂道览胜舆 —— 后端服务入口。
//
// 架构：Go 提供 REST 接口 + 托管 React 构建产物，单进程单端口。
// 高德 Web 服务 Key 只存在服务端；前端只拿到 JS API Key。
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/puremixai/beijing-camera-nav/server/internal/amap"
	"github.com/puremixai/beijing-camera-nav/server/internal/config"
	"github.com/puremixai/beijing-camera-nav/server/internal/httpapi"
	"github.com/puremixai/beijing-camera-nav/server/internal/planner"
	"github.com/puremixai/beijing-camera-nav/server/internal/store"
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	log.SetPrefix("[nav] ")

	cfg := config.Load()

	st, err := store.Load(cfg.DataDir)
	if err != nil {
		log.Fatalf("加载数据失败（DATA_DIR=%s）：%v", cfg.DataDir, err)
	}
	pts, det, cmPoints, cmTotal := st.Stats()
	log.Printf("数据就绪：点位 %d · 详情 %d · 有评论点位 %d（评论 %d 条）",
		pts, det, cmPoints, cmTotal)
	if cfg.AmapWebKey == "" {
		log.Printf("⚠ 未配置 AMAP_WEB_KEY，/api/plan 与 /api/tips 将不可用")
	}
	if cfg.AmapJSKey == "" {
		log.Printf("⚠ 未配置 AMAP_JS_KEY，前端地图将无法加载")
	}

	am := amap.New(cfg.AmapWebKey, cfg.AmapTMO)
	// 用 Holder 持有数据集，支持 /api/admin/reload 热重载而不重启进程
	holder := store.NewHolder(st)
	pl := planner.New(holder, am)
	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           httpapi.New(cfg, holder, pl, am).Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      httpapi.PlanTimeout + 30*time.Second, // 规划最长要跑一两分钟
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		log.Printf("监听 %s（静态资源目录 %s）", cfg.Addr, cfg.WebDir)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("服务启动失败：%v", err)
		}
	}()

	// 优雅关闭：收到信号后停止接收新请求，给在途请求 10 秒收尾
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	log.Printf("收到退出信号，正在关闭…")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("关闭时出错：%v", err)
	}
	log.Printf("已退出")
}
