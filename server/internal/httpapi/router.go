// Package httpapi 提供 REST 接口与前端静态资源服务。
//
// 接口一览：
//
//	GET  /api/health          健康检查 + 数据规模
//	GET  /api/config          前端启动所需配置（JS Key、默认半径等）
//	GET  /api/points          全部点位（约 690KB，gzip 后约 130KB）
//	GET  /api/points/{id}     单个点位的详情 + 车主评论（点击弹窗时懒加载）
//	POST /api/plan            服务端跑完整避让算法，一次返回全部方案
//	GET  /api/tips?kw=        起终点输入提示（代理高德，Key 不外泄）
package httpapi

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/puremixai/beijing-camera-nav/server/internal/amap"
	"github.com/puremixai/beijing-camera-nav/server/internal/config"
	"github.com/puremixai/beijing-camera-nav/server/internal/planner"
	"github.com/puremixai/beijing-camera-nav/server/internal/store"
)

// PlanTimeout 是单次规划的总超时：一轮算路约 1~2 秒，最多 24 轮，留足余量。
const PlanTimeout = 150 * time.Second

// DefaultCommentLimit 是单个点位默认返回的评论条数（最近 N 条）。
const DefaultCommentLimit = 20

// Server 聚合依赖。
type Server struct {
	cfg   config.Config
	st    *store.Store
	pl    *planner.Planner
	am    *amap.Client
	proxy *http.Client // 用于 /_AMapService/ 反向代理
}

// New 创建 API 服务。
func New(cfg config.Config, st *store.Store, pl *planner.Planner, am *amap.Client) *Server {
	return &Server{
		cfg: cfg, st: st, pl: pl, am: am,
		proxy: &http.Client{Timeout: 30 * time.Second},
	}
}

// Handler 返回装配好的 http.Handler。
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.health)
	mux.HandleFunc("GET /api/config", s.getConfig)
	mux.HandleFunc("GET /api/points", s.points)
	mux.HandleFunc("GET /api/points/{id}", s.pointDetail)
	mux.HandleFunc("POST /api/plan", s.plan)
	mux.HandleFunc("GET /api/tips", s.tips)
	// 高德 JS API 的安全密钥代理：前端只拿到 /_AMapService 这个地址，
	// 真正的 securityJsCode 由本服务在转发时注入（见 amapProxy）。
	mux.HandleFunc("/_AMapService/", s.amapProxy)
	mux.Handle("/", s.staticSPA())

	var h http.Handler = mux
	h = cors(h)
	h = gzipMW(h)
	if s.cfg.LogReqs {
		h = logMW(h)
	}
	return h
}

/* ---------------- 高德安全密钥代理 ---------------- */

// amapProxy 实现高德官方文档推荐的「代理服务器转发安全密钥」方案。
//
// 官方给了两种用法：
//  1. 明文：window._AMapSecurityConfig = { securityJsCode: "xxx" }
//     —— 密钥随页面下发，DevTools 里直接可见，官方明确「不建议在生产环境使用」。
//  2. 代理：window._AMapSecurityConfig = { serviceHost: "https://你的域名/_AMapService" }
//     —— 前端只知道代理地址，真实密钥留在服务端，转发时补上 &jscode=xxx。
//
// 本函数实现第 2 种。注意：代理的是「安全密钥」，不是 key 本身——
// key 仍然必须出现在 <script src="...&key=xxx"> 里，那是 JS API 的固有设计，
// 靠高德控制台的 Referer 白名单防护。
func (s *Server) amapProxy(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/_AMapService")
	if rest == "" || !strings.HasPrefix(rest, "/") {
		writeErr(w, http.StatusBadRequest, "路径必须以 /_AMapService/ 开头")
		return
	}
	// 按官方文档的映射关系选择上游
	base := "https://restapi.amap.com"
	if strings.HasPrefix(rest, "/v4/map/styles") {
		base = "https://webapi.amap.com"
	}

	target := base + rest
	if r.URL.RawQuery != "" {
		target += "?" + r.URL.RawQuery
	}
	if s.cfg.AmapSec != "" {
		sep := "&"
		if !strings.Contains(target, "?") {
			sep = "?"
		}
		target += sep + "jscode=" + url.QueryEscape(s.cfg.AmapSec)
	}

	req, err := http.NewRequestWithContext(r.Context(), r.Method, target, r.Body)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "构造上游请求失败")
		return
	}
	// 只透传必要的头；刻意不转发 Accept-Encoding，
	// 让 Go 的 transport 自己协商并解压，避免 Content-Encoding 与实际内容不符。
	if ct := r.Header.Get("Content-Type"); ct != "" {
		req.Header.Set("Content-Type", ct)
	}
	req.Header.Set("User-Agent", "beijing-camera-nav-proxy/1.0")

	resp, err := s.proxy.Do(req)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "转发到高德失败: "+err.Error())
		return
	}
	defer resp.Body.Close()

	for k, vs := range resp.Header {
		switch strings.ToLower(k) {
		case "content-encoding", "content-length", "transfer-encoding", "connection":
			continue // 由本服务重新协商
		}
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, io.LimitReader(resp.Body, 16<<20))
}

/* ---------------- 基础接口 ---------------- */

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	pts, det, cm, cmTotal := s.st.Stats()
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":            true,
		"points":        pts,
		"details":       det,
		"commentPoints": cm,
		"comments":      cmTotal,
		"amapKeySet":    s.cfg.AmapWebKey != "",
	})
}

func (s *Server) getConfig(w http.ResponseWriter, r *http.Request) {
	// 只下发 JS API Key 与「安全密钥代理地址」，绝不下发 securityJsCode 本身。
	// 配了 AMAP_SECURITY_CODE 时前端走 serviceHost 代理模式（官方推荐），
	// 没配则前端不设 _AMapSecurityConfig，按无安全密钥的方式加载。
	serviceHost := ""
	if s.cfg.AmapSec != "" {
		serviceHost = baseURL(r) + "/_AMapService"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"jsKey":         s.cfg.AmapJSKey,
		"serviceHost":   serviceHost,
		"securityProxy": s.cfg.AmapSec != "",
		"city":          s.cfg.City,
		"center":        [2]float64{116.397045, 39.909729},
		"zoom":          11,
		"defaultRadius": 100,
		"redType":       planner.RedType,
		"maxPlans":      planner.MaxPlans,
		"maxAreas":      planner.MaxAreas,
		"edgeExM":       planner.EdgeExM,
	})
}

// baseURL 推断服务对外地址，兼容反向代理（Nginx / 云负载均衡）。
func baseURL(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if v := r.Header.Get("X-Forwarded-Proto"); v != "" {
		scheme = v
	}
	host := r.Host
	if v := r.Header.Get("X-Forwarded-Host"); v != "" {
		host = v
	}
	return scheme + "://" + host
}

// pointDTO 是点位对外结构。字段名刻意缩短，6288 个点位的体积差别很可观。
type pointDTO struct {
	Lng      float64 `json:"lng"`
	Lat      float64 `json:"lat"`
	Type     string  `json:"t"`
	Name     string  `json:"n"`
	Time     string  `json:"time"`
	EditTime string  `json:"et,omitempty"`
	DetailID int     `json:"id"`
}

func (s *Server) points(w http.ResponseWriter, r *http.Request) {
	out := make([]pointDTO, len(s.st.Cameras))
	for i := range s.st.Cameras {
		c := &s.st.Cameras[i]
		out[i] = pointDTO{
			Lng: c.Lng, Lat: c.Lat, Type: c.Type, Name: c.Name,
			Time: c.Time, EditTime: c.EditTime, DetailID: c.DetailID,
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"count": len(out), "points": out})
}

type detailDTO struct {
	Time    string      `json:"time"`
	Imgs    [][2]string `json:"imgs"`
	Missing bool        `json:"missing"`
}

func (s *Server) pointDetail(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "id 必须是数字")
		return
	}

	// 原站按时间倒序返回评论。热门点位可能有几百条（最多的一个 600 条），
	// 全量下发既浪费带宽又会让前端渲染出几百个 DOM 节点，
	// 所以默认只给最近 DefaultCommentLimit 条，总数单独返回。
	limit := DefaultCommentLimit
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, e := strconv.Atoi(v); e == nil && n > 0 && n <= 200 {
			limit = n
		}
	}

	resp := map[string]any{
		"id":       id,
		"detail":   nil,
		"comments": []store.Comment{},
		"total":    0,
		"limit":    limit,
	}
	if d, ok := s.st.DetailOf(id); ok {
		resp["detail"] = detailDTO{Time: d.Time, Imgs: d.Imgs, Missing: d.Missing}
	}
	if cs := s.st.CommentsOf(id); len(cs) > 0 {
		resp["total"] = len(cs)
		if len(cs) > limit {
			cs = cs[:limit]
		}
		resp["comments"] = cs
	}
	writeJSON(w, http.StatusOK, resp)
}

/* ---------------- 规划 ---------------- */

type planReq struct {
	Start     []float64 `json:"start"`
	End       []float64 `json:"end"`
	Radius    float64   `json:"radius"`
	TargetAll bool      `json:"targetAll"`
	Strategy  int       `json:"strategy"`
}

func (s *Server) plan(w http.ResponseWriter, r *http.Request) {
	var req planReq
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体不是合法 JSON")
		return
	}
	if len(req.Start) != 2 || len(req.End) != 2 {
		writeErr(w, http.StatusBadRequest, "start / end 必须是 [经度, 纬度]")
		return
	}
	if s.cfg.AmapWebKey == "" {
		writeErr(w, http.StatusServiceUnavailable, "服务端未配置 AMAP_WEB_KEY，无法算路")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), PlanTimeout)
	defer cancel()

	t0 := time.Now()
	res, err := s.pl.Plan(ctx, planner.Request{
		Start:     [2]float64{req.Start[0], req.Start[1]},
		End:       [2]float64{req.End[0], req.End[1]},
		Radius:    req.Radius,
		TargetAll: req.TargetAll,
		Strategy:  req.Strategy,
	})
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			writeErr(w, http.StatusGatewayTimeout, "规划超时，请缩小半径或换更近的起终点")
			return
		}
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	log.Printf("plan %.0fm 起=%v 终=%v 方案=%d 调用高德=%d 耗时=%.1fs",
		res.Radius, req.Start, req.End, len(res.Plans), res.Calls, time.Since(t0).Seconds())
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) tips(w http.ResponseWriter, r *http.Request) {
	kw := strings.TrimSpace(r.URL.Query().Get("kw"))
	if kw == "" {
		writeJSON(w, http.StatusOK, map[string]any{"tips": []amap.Tip{}})
		return
	}
	if s.cfg.AmapWebKey == "" {
		writeErr(w, http.StatusServiceUnavailable, "服务端未配置 AMAP_WEB_KEY")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	type res struct {
		tips []amap.Tip
		err  error
	}
	ch := make(chan res, 1)
	go func() {
		t, err := s.am.InputTips(kw, s.cfg.City)
		ch <- res{t, err}
	}()
	select {
	case <-ctx.Done():
		writeErr(w, http.StatusGatewayTimeout, "输入提示超时")
	case v := <-ch:
		if v.err != nil {
			writeErr(w, http.StatusBadGateway, v.err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"tips": v.tips})
	}
}

/* ---------------- 静态资源 ---------------- */

// staticSPA 提供前端构建产物，并为前端路由做 index.html 兜底。
func (s *Server) staticSPA() http.Handler {
	dir := s.cfg.WebDir
	fs := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			writeErr(w, http.StatusNotFound, "接口不存在")
			return
		}
		clean := filepath.Clean("/" + r.URL.Path)
		full := filepath.Join(dir, clean)
		// 防目录穿越：拼接结果必须仍在 WebDir 之内
		if rel, err := filepath.Rel(dir, full); err == nil && !strings.HasPrefix(rel, "..") {
			if st, err := os.Stat(full); err == nil && !st.IsDir() {
				w.Header().Set("Cache-Control", cacheFor(clean))
				fs.ServeHTTP(w, r)
				return
			}
		}
		idx := filepath.Join(dir, "index.html")
		if _, err := os.Stat(idx); err != nil {
			writeErr(w, http.StatusNotFound,
				"前端未构建。开发时请在 web/ 运行 npm run dev（Vite 会代理 /api）；"+
					"部署时用 docker compose 构建镜像，或先执行 npm run build")
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, idx)
	})
}

// cacheFor：带内容哈希的 assets 可以长缓存，index.html 必须每次校验。
func cacheFor(p string) string {
	if strings.HasPrefix(p, "/assets/") {
		return "public, max-age=31536000, immutable"
	}
	return "no-cache"
}

/* ---------------- 中间件 ---------------- */

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type gzipWriter struct {
	http.ResponseWriter
	gz          *gzip.Writer
	wroteHeader bool
}

func (g *gzipWriter) WriteHeader(code int) {
	g.wroteHeader = true
	g.Header().Del("Content-Length") // 压缩后长度未知
	g.ResponseWriter.WriteHeader(code)
}

func (g *gzipWriter) Write(b []byte) (int, error) {
	if !g.wroteHeader {
		g.WriteHeader(http.StatusOK)
	}
	return g.gz.Write(b)
}

func gzipMW(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Add("Vary", "Accept-Encoding")
		gz := gzip.NewWriter(w)
		defer gz.Close()
		next.ServeHTTP(&gzipWriter{ResponseWriter: w, gz: gz}, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	code int
}

func (s *statusRecorder) WriteHeader(c int) { s.code = c; s.ResponseWriter.WriteHeader(c) }

func logMW(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t0 := time.Now()
		rec := &statusRecorder{ResponseWriter: w, code: 200}
		next.ServeHTTP(rec, r)
		log.Printf("%d %s %s %.0fms", rec.code, r.Method, r.URL.Path,
			float64(time.Since(t0).Milliseconds()))
	})
}

/* ---------------- 工具 ---------------- */

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false) // 点位名/评论里有中文与特殊字符，别转义成 \uXXXX
	_ = enc.Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
