// Package store 负责把三个数据文件加载进内存，并提供空间索引。
//
// 数据来源（与仓库根目录下的抓取脚本产物一致）：
//
//	cameras.json   6288 个点位
//	details.json   每个点位的详情页（精确到秒的更新时间 + 违章截图）
//	comments.json  每个点位的车主评论（96k+ 条）
//
// 全部常驻内存：合计约 11 MB，对单机服务完全可接受，
// 也避免了为一次查询引入数据库的复杂度。
package store

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"sync"
)

const (
	cellSize = 0.01 // 空间网格边长（度），约 1.1km
)

// Camera 是一个进京证摄像头点位。
type Camera struct {
	Name     string  `json:"name"`
	Lng      float64 `json:"lng"`
	Lat      float64 `json:"lat"`
	Type     string  `json:"aa"`       // 类型码：2=主要抓拍点位（红）
	Time     string  `json:"time"`     // 原站标注的更新时间
	EditTime string  `json:"edittime"` // 少数点位有
	Href     string  `json:"href"`     // 原站详情页链接 /content/?<id>.html

	DetailID int `json:"-"` // 从 Href 解析出的详情页 id
}

// Detail 是原站详情页的抓取结果。Missing 为 true 表示原站该页已不存在。
type Detail struct {
	Time    string      `json:"t"`
	Imgs    [][2]string `json:"imgs"` // [[图片路径, 图片标题], ...]
	Missing bool        `json:"missing,omitempty"`
}

// Comment 是一条车主评论：[时间, 评论者, 内容]。
type Comment [3]string

// Store 持有全部数据与空间索引。
type Store struct {
	Cameras []Camera
	Pos     [][2]float64 // 与 Cameras 等长，便于几何运算
	Details map[string]Detail
	Comment map[string][]Comment

	grid map[int64][]int32 // 空间网格 → 点位下标
	mu   sync.RWMutex      // 目前只读，为后续热更新留出余地
}

var hrefRe = regexp.MustCompile(`/content/\?(\d+)\.html`)

func detailIDFromHref(href string) int {
	m := hrefRe.FindStringSubmatch(href)
	if len(m) != 2 {
		return 0
	}
	n, _ := strconv.Atoi(m[1])
	return n
}

// Load 从 dir 读取三个数据文件。
func Load(dir string) (*Store, error) {
	s := &Store{
		Details: map[string]Detail{},
		Comment: map[string][]Comment{},
		grid:    map[int64][]int32{},
	}

	if err := readJSON(filepath.Join(dir, "cameras.json"), &s.Cameras); err != nil {
		return nil, fmt.Errorf("加载 cameras.json 失败: %w", err)
	}
	if len(s.Cameras) == 0 {
		return nil, fmt.Errorf("cameras.json 中没有点位")
	}
	for i := range s.Cameras {
		s.Cameras[i].DetailID = detailIDFromHref(s.Cameras[i].Href)
	}

	// details.json / comments.json 允许缺失：应用仍可用，只是弹窗没有详情与评论。
	if err := readJSON(filepath.Join(dir, "details.json"), &s.Details); err != nil {
		fmt.Printf("[warn] 未加载 details.json（%v），弹窗将没有截图与精确时间\n", err)
	}
	if err := readJSON(filepath.Join(dir, "comments.json"), &s.Comment); err != nil {
		fmt.Printf("[warn] 未加载 comments.json（%v），弹窗将没有车主评论\n", err)
	}

	s.buildIndex()
	return s, nil
}

func readJSON(path string, v any) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return json.NewDecoder(f).Decode(v)
}

func (s *Store) buildIndex() {
	s.Pos = make([][2]float64, len(s.Cameras))
	for i := range s.Cameras {
		c := &s.Cameras[i]
		s.Pos[i] = [2]float64{c.Lng, c.Lat}
		k := cellKey(int32(c.Lng/cellSize), int32(c.Lat/cellSize))
		s.grid[k] = append(s.grid[k], int32(i))
	}
}

func cellKey(i, j int32) int64 {
	return int64(i)<<32 | int64(uint32(j))
}

// Stats 返回各类数据的规模，用于启动日志与 /api/health。
func (s *Store) Stats() (points, details, comments, commentsTotal int) {
	points = len(s.Cameras)
	details = len(s.Details)
	comments = len(s.Comment)
	for _, v := range s.Comment {
		commentsTotal += len(v)
	}
	return
}

// DetailOf 返回某点位的详情；第二个返回值表示是否存在。
func (s *Store) DetailOf(id int) (Detail, bool) {
	d, ok := s.Details[strconv.Itoa(id)]
	return d, ok
}

// CommentsOf 返回某点位的全部评论。
func (s *Store) CommentsOf(id int) []Comment {
	return s.Comment[strconv.Itoa(id)]
}
