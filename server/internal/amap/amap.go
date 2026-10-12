// Package amap 封装高德地图 Web 服务接口。
//
// 关键点：Key 只在服务端使用，绝不下发给浏览器做 REST 调用。
// 前端仍然需要 JS API 的 Key 来加载地图 SDK——那个 Key 天然会暴露在页面里，
// 只能靠高德控制台的 Referer 白名单保护，所以建议 JS Key 与 Web 服务 Key 分开申请。
package amap

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	drivingURL   = "https://restapi.amap.com/v5/direction/driving"
	inputTipsURL = "https://restapi.amap.com/v3/assistant/inputtips"
)

// Client 是高德 Web 服务客户端。
type Client struct {
	Key string
	hc  *http.Client
}

// New 创建客户端。timeout 为单次请求超时。
func New(key string, timeout time.Duration) *Client {
	return &Client{
		Key: key,
		hc:  &http.Client{Timeout: timeout},
	}
}

// ErrNoKey 表示服务端未配置高德 Web 服务 Key。
var ErrNoKey = errors.New("服务端未配置 AMAP_WEB_KEY")

// Path 是一条驾车路线的精简结果。
type Path struct {
	Distance float64 // 米
	Duration float64 // 秒
	Poly     [][2]float64
}

type rawResp struct {
	Status   string `json:"status"`
	Info     string `json:"info"`
	Infocode string `json:"infocode"`
	Route    struct {
		Paths []struct {
			Distance string `json:"distance"`
			Cost     struct {
				Duration string `json:"duration"`
			} `json:"cost"`
			Steps []struct {
				Polyline string `json:"polyline"`
			} `json:"steps"`
		} `json:"paths"`
	} `json:"route"`
}

// Driving 调用 v5 驾车路径规划。
//
// avoidPolygons 形如 "lng,lat;lng,lat;lng,lat;lng,lat|..."，
// 高德限制：最多 32 个区域、每区最多 16 个顶点、单区面积不超过 81 平方公里。
// 传空串表示不避让。
func (c *Client) Driving(origin, dest [2]float64, avoidPolygons string, strategy int) (*Path, error) {
	if c.Key == "" {
		return nil, ErrNoKey
	}
	params := [][2]string{
		{"origin", coord(origin)},
		{"destination", coord(dest)},
		{"strategy", strconv.Itoa(strategy)},
		{"show_fields", "cost,polyline"},
		{"key", c.Key},
	}
	if avoidPolygons != "" {
		params = append(params, [2]string{"avoidpolygons", avoidPolygons})
	}

	var r rawResp
	if err := c.get(drivingURL, params, &r); err != nil {
		return nil, err
	}
	if r.Status != "1" {
		return nil, fmt.Errorf("%s（%s）", orDefault(r.Info, "接口错误"), r.Infocode)
	}
	if len(r.Route.Paths) == 0 {
		return nil, errors.New("未返回可行路线（避让区可能已封死路网）")
	}
	p := r.Route.Paths[0]
	out := &Path{
		Distance: atof(p.Distance),
		Duration: atof(p.Cost.Duration),
	}
	for _, st := range p.Steps {
		out.Poly = appendPolyline(out.Poly, st.Polyline)
	}
	if len(out.Poly) < 2 {
		return nil, errors.New("路线折线为空")
	}
	return out, nil
}

// Tip 是一条输入提示。
type Tip struct {
	Name     string `json:"name"`
	District string `json:"district"`
	Location string `json:"location"` // "lng,lat"
}

// InputTips 调用输入提示接口，用于起终点联想。
func (c *Client) InputTips(keywords, city string) ([]Tip, error) {
	if c.Key == "" {
		return nil, ErrNoKey
	}
	params := [][2]string{
		{"keywords", keywords},
		{"city", city},
		{"citylimit", "true"},
		{"key", c.Key},
	}
	var r struct {
		Status   string `json:"status"`
		Info     string `json:"info"`
		Infocode string `json:"infocode"`
		Tips     []Tip  `json:"tips"`
	}
	if err := c.get(inputTipsURL, params, &r); err != nil {
		return nil, err
	}
	if r.Status != "1" {
		return nil, fmt.Errorf("%s（%s）", orDefault(r.Info, "接口错误"), r.Infocode)
	}
	out := make([]Tip, 0, len(r.Tips))
	for _, t := range r.Tips {
		if t.Location != "" {
			out = append(out, t)
		}
	}
	return out, nil
}

// get 发起 GET 请求并解析 JSON。
//
// 注意 query 是手工拼的：高德要求 avoidpolygons 里的 ; | , 保持字面量，
// 用 url.Values.Encode() 会把它们转义成 %3B / %7C / %2C，导致避让区解析失败。
func (c *Client) get(base string, params [][2]string, out any) error {
	var sb strings.Builder
	sb.WriteString(base)
	sb.WriteByte('?')
	for i, kv := range params {
		if i > 0 {
			sb.WriteByte('&')
		}
		sb.WriteString(kv[0])
		sb.WriteByte('=')
		sb.WriteString(escapeValue(kv[1]))
	}

	resp, err := c.hc.Get(sb.String())
	if err != nil {
		return fmt.Errorf("请求高德失败: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return fmt.Errorf("读取高德响应失败: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("高德返回 HTTP %d", resp.StatusCode)
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("解析高德响应失败: %w", err)
	}
	return nil
}

// escapeValue 只转义真正需要转义的字符，保留 ; | , 的字面量形式。
func escapeValue(s string) string {
	r := strings.NewReplacer(
		"%", "%25",
		" ", "%20",
		"#", "%23",
		"&", "%26",
		"+", "%2B",
		"?", "%3F",
		"=", "%3D",
	)
	return r.Replace(s)
}

func coord(p [2]float64) string {
	return strconv.FormatFloat(p[0], 'f', 6, 64) + "," + strconv.FormatFloat(p[1], 'f', 6, 64)
}

func appendPolyline(dst [][2]float64, s string) [][2]float64 {
	for _, seg := range strings.Split(s, ";") {
		lng, lat, ok := strings.Cut(seg, ",")
		if !ok {
			continue
		}
		x, err1 := strconv.ParseFloat(strings.TrimSpace(lng), 64)
		y, err2 := strconv.ParseFloat(strings.TrimSpace(lat), 64)
		if err1 != nil || err2 != nil {
			continue
		}
		dst = append(dst, [2]float64{x, y})
	}
	return dst
}

func atof(s string) float64 {
	f, _ := strconv.ParseFloat(s, 64)
	return f
}

func orDefault(s, def string) string {
	if strings.TrimSpace(s) == "" {
		return def
	}
	return s
}

// ParseLocation 把 "lng,lat" 解析成坐标。
func ParseLocation(s string) ([2]float64, bool) {
	lng, lat, ok := strings.Cut(s, ",")
	if !ok {
		return [2]float64{}, false
	}
	x, err1 := strconv.ParseFloat(strings.TrimSpace(lng), 64)
	y, err2 := strconv.ParseFloat(strings.TrimSpace(lat), 64)
	if err1 != nil || err2 != nil {
		return [2]float64{}, false
	}
	return [2]float64{x, y}, true
}
