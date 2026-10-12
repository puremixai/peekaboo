// Package config 从环境变量读取运行配置。
// 全部配置项都有合理默认值，本地直接 `go run ./...` 也能起来。
package config

import (
	"os"
	"strconv"
	"time"
)

// Config 是服务运行配置。
type Config struct {
	Addr       string        // 监听地址，如 :8080
	DataDir    string        // 数据目录（cameras.json / details.json / comments.json）
	WebDir     string        // 前端构建产物目录（index.html + assets/）
	AmapWebKey string        // 高德 Web 服务 Key（仅服务端使用）
	AmapJSKey  string        // 高德 JS API Key（下发给浏览器，需配 Referer 白名单）
	AmapSec    string        // JS API 2.0 安全密钥；配了就走 /_AMapService 代理转发，不下发前端
	AmapTMO    time.Duration // 调用高德的单次超时
	City       string        // 输入提示限定的城市
	LogReqs    bool          // 是否打印每个请求
	AdminToken string        // 管理接口令牌；为空则管理接口只允许本机访问
}

// Load 读取环境变量并套用默认值。
func Load() Config {
	c := Config{
		Addr:       env("ADDR", ":"+env("PORT", "8080")),
		DataDir:    env("DATA_DIR", "./data"),
		WebDir:     env("WEB_DIR", "./web/dist"),
		AmapWebKey: env("AMAP_WEB_KEY", ""),
		AmapJSKey:  env("AMAP_JS_KEY", ""),
		AmapSec:    env("AMAP_SECURITY_CODE", ""),
		City:       env("AMAP_CITY", "北京"),
		LogReqs:    envBool("LOG_REQUESTS", false),
		AdminToken: env("ADMIN_TOKEN", ""),
	}
	c.AmapTMO = time.Duration(envInt("AMAP_TIMEOUT_SEC", 20)) * time.Second
	// JS Key 没单独配就复用 Web Key（本项目实测同一个 Key 两种用途都可用）
	if c.AmapJSKey == "" {
		c.AmapJSKey = c.AmapWebKey
	}
	return c
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func envInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func envBool(k string, def bool) bool {
	if v := os.Getenv(k); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return def
}
