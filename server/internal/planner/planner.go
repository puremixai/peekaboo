// Package planner 是避让算法的服务端实现（从原前端 JS 版本一比一移植）。
//
// 为什么放到服务端：
//  1. 高德 Web 服务 Key 不再出现在浏览器里；
//  2. 一次规划要串行调用高德接口十几到二十几次，放服务端可以做超时控制、并发隔离与缓存；
//  3. 算法可以脱离浏览器单测。
//
// 算法思路（「逐轮避让」）：
//
//	第 0 轮：先算一条不避让的基准路线。
//	之后每一轮：
//	  1. 找出当前路线半径 R 米内、且还没被避让区覆盖过的目标点位；
//	  2. 按「离路线由近到远」排序，贪心聚团成矩形避让区
//	     （高德限制最多 32 个区域，所以聚团半径会自适应放大直到装得下）；
//	  3. 带着全部避让区重新算路，得到新路线，重复。
//	红点清零、连续多轮无改善、或避让区用满即停止。
//
//	最后对全部轮次做帕累托筛选（红点越少越好、里程越短越好）并压缩成最多 4 个方案。
package planner

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"

	"github.com/puremixai/beijing-camera-nav/server/internal/amap"
	"github.com/puremixai/beijing-camera-nav/server/internal/geo"
	"github.com/puremixai/beijing-camera-nav/server/internal/store"
)

// 与前端旧版保持一致的参数。
const (
	MaxRounds = 24  // 最多迭代轮数
	MaxAreas  = 32  // 高德接口上限：避让区数量
	MaxPlans  = 4   // 方案列表最多展示条数
	EdgeExM   = 60  // 起终点这个距离内的点位视为无法避让
	RedType   = "2" // 「主要抓拍点位」的类型码
)

// ClusterSteps 是自适应聚团半径（米）：逐步放大直到区域数装得下。
var ClusterSteps = []float64{120, 200, 320, 500, 800, 1200, 1800, 2800, 4200, 6500, 10000}

// Area 是一个矩形避让区。
type Area struct {
	Poly    [][2]float64 `json:"poly"`
	Members []int32      `json:"members"`
}

// Plan 是一个候选方案。
type Plan struct {
	Label  string       `json:"label"`
	Dist   float64      `json:"dist"`
	Dur    float64      `json:"dur"`
	Poly   [][2]float64 `json:"poly"`
	Near   []int32      `json:"near"` // 半径 R 内的点位下标
	Red    int          `json:"red"`  // 其中红点个数
	Areas  []Area       `json:"areas"`
	Rounds int          `json:"rounds"`
}

// EdgeRed 是起终点附近、无论如何都避不开的红点。
type EdgeRed struct {
	Idx   int32   `json:"i"`
	Dist  float64 `json:"d"`
	Where string  `json:"where"` // 起点 / 终点
}

// Request 是一次规划请求。
type Request struct {
	Start     [2]float64
	End       [2]float64
	Radius    float64
	TargetAll bool // false=只避让红点，true=避让全部类型
	Strategy  int
}

// Result 是一次规划的完整结果。
type Result struct {
	Radius    float64   `json:"radius"`
	TargetAll bool      `json:"targetAll"`
	Baseline  Plan      `json:"baseline"`
	Plans     []Plan    `json:"plans"`
	EdgeRed   []EdgeRed `json:"edgeRed"`
	Calls     int       `json:"calls"`             // 调用高德接口的次数
	Warning   string    `json:"warning,omitempty"` // 部分轮次失败时的提示
}

// Planner 持有数据与高德客户端。
//
// 数据通过 store.Holder 以原子指针访问：热重载换数据集时只换指针，
// 规划过程中拿到的 *store.Store 是稳定快照，不会读到半新半旧的状态。
type Planner struct {
	h  *store.Holder
	am *amap.Client
}

// New 创建规划器。
func New(h *store.Holder, am *amap.Client) *Planner {
	return &Planner{h: h, am: am}
}

func (p *Planner) isTarget(st *store.Store, r *run, idx int32) bool {
	return r.targetAll || st.Cameras[idx].Type == RedType
}

// 每次 Plan 调用期间的可变状态（避免挂在 Planner 上导致并发问题）。
type run struct {
	targetAll bool
	radius    float64
	exclude   map[int32]bool
	calls     int
}

func (r *run) countRed(idxs []int32, st *store.Store) int {
	n := 0
	for _, i := range idxs {
		if st.Cameras[i].Type == RedType {
			n++
		}
	}
	return n
}

// Plan 执行一次完整规划。
func (p *Planner) Plan(ctx context.Context, req Request) (*Result, error) {
	if req.Radius <= 0 {
		req.Radius = 100
	}
	if req.Radius > 2000 {
		req.Radius = 2000
	}
	r := &run{
		targetAll: req.TargetAll,
		radius:    req.Radius,
		exclude:   map[int32]bool{},
	}
	// 取一次数据快照，整个规划过程都用它，避免中途被热重载换掉
	st := p.h.Get()

	// 起终点 60 米内的点位无法避让（你本来就要进出这里）
	for _, i := range st.NearbyAny(req.Start, EdgeExM) {
		r.exclude[i] = true
	}
	for _, i := range st.NearbyAny(req.End, EdgeExM) {
		r.exclude[i] = true
	}

	// 起终点附近半径内的红点：提示用户这些避不开
	edgeRed := p.edgeRed(st, req)

	// 第 0 条：基准路线（不避让）
	base, err := p.drive(ctx, req.Start, req.End, "", req.Strategy)
	if err != nil {
		return nil, fmt.Errorf("基准算路失败: %w", err)
	}
	r.calls++
	baseNear := st.FindNear(base.Poly, req.Radius, r.exclude)
	if baseNear == nil {
		baseNear = []int32{} // 保证序列化成 [] 而不是 null
	}
	basePlan := Plan{
		Label: "不避让（基准）", Dist: base.Distance, Dur: base.Duration,
		Poly: base.Poly, Near: baseNear, Red: r.countRed(baseNear, st),
		Areas: []Area{}, // 显式空切片，避免序列化成 null
	}

	plans := []Plan{basePlan}
	areas := []Area{}
	committed := map[int32]bool{}
	cur := basePlan
	var lastErr error

	prevKey := float64(cur.Red)*1e7 + cur.Dist
	stall := 0

	for round := 1; round <= MaxRounds; round++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		// 1. 当前路线半径内、尚未被覆盖的目标点位
		var nearIdx []int32
		for _, i := range st.FindNear(cur.Poly, req.Radius, r.exclude) {
			if !committed[i] && p.isTarget(st, r, i) {
				nearIdx = append(nearIdx, i)
			}
		}
		if len(nearIdx) == 0 {
			break
		}
		room := MaxAreas - len(areas)
		if room <= 0 {
			break
		}

		// 2. 按离路线由近到远排序后聚团
		withD := make([]store.NearHit, 0, len(nearIdx))
		for _, i := range nearIdx {
			withD = append(withD, store.NearHit{Idx: i, Dist: geo.MinDistToPoly(st.Pos[i], cur.Poly)})
		}
		sort.Slice(withD, func(a, b int) bool { return withD[a].Dist < withD[b].Dist })
		order := make([]int32, len(withD))
		for i, o := range withD {
			order[i] = o.Idx
		}

		add := p.clusterAdaptive(st, order, req.Radius, room)
		if len(add) == 0 {
			break
		}
		if len(add) > room {
			add = add[:room]
		}
		for _, a := range add {
			for _, m := range a.Members {
				committed[m] = true
			}
		}
		areas = append(areas, add...)

		// 3. 带避让区重算
		res, err := p.drive(ctx, req.Start, req.End, avoidStr(areas), req.Strategy)
		r.calls++
		if err != nil {
			lastErr = err
			areas = areas[:len(areas)-len(add)] // 回滚本轮新增的区域
			break
		}
		near := st.FindNear(res.Poly, req.Radius, r.exclude)
		if near == nil {
			near = []int32{} // 保证序列化成 [] 而不是 null
		}
		cur = Plan{
			Label:  fmt.Sprintf("避让 %d 个点", len(committed)),
			Dist:   res.Distance,
			Dur:    res.Duration,
			Poly:   res.Poly,
			Near:   near,
			Red:    r.countRed(near, st),
			Areas:  append([]Area{}, areas...),
			Rounds: round,
		}
		plans = append(plans, cur)

		if cur.Red == 0 {
			break // 红点已清零，收工
		}
		key := float64(cur.Red)*1e7 + cur.Dist
		if key >= prevKey {
			stall++
			if stall >= 5 {
				break
			}
		} else {
			stall = 0
		}
		prevKey = key
	}

	out := &Result{
		Radius:    req.Radius,
		TargetAll: req.TargetAll,
		Baseline:  basePlan,
		Plans:     pareto(plans),
		EdgeRed:   edgeRed,
		Calls:     r.calls,
	}
	if lastErr != nil {
		out.Warning = "部分轮次算路失败：" + lastErr.Error()
	}
	return out, nil
}

func (p *Planner) edgeRed(st *store.Store, req Request) []EdgeRed {
	out := make([]EdgeRed, 0, 16)
	for i := range st.Cameras {
		if st.Cameras[i].Type != RedType {
			continue
		}
		ds := geo.DistM(st.Pos[i], req.Start)
		de := geo.DistM(st.Pos[i], req.End)
		m := math.Min(ds, de)
		if m > req.Radius {
			continue
		}
		where := "起点"
		if de < ds {
			where = "终点"
		}
		out = append(out, EdgeRed{Idx: int32(i), Dist: m, Where: where})
	}
	sort.Slice(out, func(a, b int) bool { return out[a].Dist < out[b].Dist })
	return out
}

func (p *Planner) drive(ctx context.Context, a, b [2]float64, av string, strategy int) (*amap.Path, error) {
	type res struct {
		p   *amap.Path
		err error
	}
	ch := make(chan res, 1)
	go func() {
		pp, err := p.am.Driving(a, b, av, strategy)
		ch <- res{pp, err}
	}()
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case v := <-ch:
		return v.p, v.err
	}
}

/* ---------------- 聚团与避让区 ---------------- */

// bboxAround 生成一个把所有成员点包住、并外扩 R 米的矩形，
// 这样框内任意点位到路线的距离都 ≥ R。
func (p *Planner) bboxAround(st *store.Store, members []int32, R float64) Area {
	x0, y0 := math.MaxFloat64, math.MaxFloat64
	x1, y1 := -math.MaxFloat64, -math.MaxFloat64
	for _, m := range members {
		c := st.Pos[m]
		x0 = math.Min(x0, c[0])
		x1 = math.Max(x1, c[0])
		y0 = math.Min(y0, c[1])
		y1 = math.Max(y1, c[1])
	}
	pLat := geo.MetersToLat(R)
	pLng := geo.MetersToLng(R, (y0+y1)/2)
	return Area{
		Poly: [][2]float64{
			{x0 - pLng, y0 - pLat},
			{x1 + pLng, y0 - pLat},
			{x1 + pLng, y1 + pLat},
			{x0 - pLng, y1 + pLat},
		},
		Members: append([]int32{}, members...),
	}
}

// cluster 贪心聚团：按 order 顺序取锚点，吸收 clusterR 米内的其它点。
func (p *Planner) cluster(st *store.Store, order []int32, R, clusterR float64, maxRegions int) []Area {
	used := make(map[int32]bool, len(order))
	out := make([]Area, 0, maxRegions)
	for _, i := range order {
		if used[i] {
			continue
		}
		if len(out) >= maxRegions {
			break
		}
		members := []int32{i}
		used[i] = true
		for _, j := range order {
			if used[j] {
				continue
			}
			if geo.DistM(st.Pos[i], st.Pos[j]) <= clusterR {
				members = append(members, j)
				used[j] = true
			}
		}
		out = append(out, p.bboxAround(st, members, R))
	}
	return out
}

// clusterAdaptive 逐步放大聚团半径，直到区域数装得下 room 个。
// 这是突破高德 32 个避让区上限的关键。
func (p *Planner) clusterAdaptive(st *store.Store, order []int32, R float64, room int) []Area {
	for _, step := range ClusterSteps {
		if c := p.cluster(st, order, R, step, room+1); len(c) <= room {
			return c
		}
	}
	return p.cluster(st, order, R, 1e9, room)
}

// avoidStr 拼成高德要求的 avoidpolygons 字符串。
func avoidStr(areas []Area) string {
	if len(areas) == 0 {
		return ""
	}
	parts := make([]string, 0, len(areas))
	for _, a := range areas {
		pts := make([]string, 0, len(a.Poly))
		for _, q := range a.Poly {
			pts = append(pts, strconv.FormatFloat(q[0], 'f', 6, 64)+","+strconv.FormatFloat(q[1], 'f', 6, 64))
		}
		parts = append(parts, strings.Join(pts, ";"))
	}
	return strings.Join(parts, "|")
}

/* ---------------- 帕累托筛选 ---------------- */

// pareto 从全部轮次里挑出「红点更少且里程更短」的最优集合，压缩到最多 MaxPlans 个。
func pareto(plans []Plan) []Plan {
	n := len(plans)
	keep := make([]int, 0, n)
	for i := 0; i < n; i++ {
		dominated := false
		for j := 0; j < n; j++ {
			if i == j {
				continue
			}
			a, b := plans[j], plans[i]
			if a.Red <= b.Red && a.Dist <= b.Dist && (a.Red < b.Red || a.Dist < b.Dist) {
				dominated = true
				break
			}
		}
		if !dominated {
			keep = append(keep, i)
		}
	}
	sort.Slice(keep, func(a, b int) bool { return plans[keep[a]].Dist < plans[keep[b]].Dist })

	// 里程几乎相同的只留红点最少的那个
	uniq := make([]int, 0, len(keep))
	for _, i := range keep {
		dup := -1
		for k, u := range uniq {
			if math.Abs(plans[u].Dist-plans[i].Dist) < 1 {
				dup = k
				break
			}
		}
		if dup < 0 {
			uniq = append(uniq, i)
		} else if plans[i].Red < plans[uniq[dup]].Red {
			uniq[dup] = i
		}
	}

	// 超过 MaxPlans 时保留首尾 + 均匀取中间
	if len(uniq) > MaxPlans {
		mid := uniq[1 : len(uniq)-1]
		need := MaxPlans - 2
		picked := []int{uniq[0], uniq[len(uniq)-1]}
		if need > 0 && len(mid) > 0 {
			step := float64(len(mid)) / float64(need)
			for k := 0; k < need; k++ {
				picked = append(picked, mid[int(float64(k)*step)])
			}
		}
		seen := map[int]bool{}
		out := make([]int, 0, MaxPlans)
		for _, i := range picked {
			if !seen[i] {
				seen[i] = true
				out = append(out, i)
			}
		}
		sort.Slice(out, func(a, b int) bool { return plans[out[a]].Dist < plans[out[b]].Dist })
		uniq = out
	}

	res := make([]Plan, 0, len(uniq))
	for _, i := range uniq {
		res = append(res, plans[i])
	}
	return res
}
