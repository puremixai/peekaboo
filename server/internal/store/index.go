package store

import (
	"math"

	"github.com/puremixai/beijing-camera-nav/server/internal/geo"
)

// NearHit 表示「某个点位距目标多远」。
type NearHit struct {
	Idx  int32   `json:"i"`
	Dist float64 `json:"d"`
}

// FindNear 返回折线 poly 两侧 r 米内的全部点位下标。
//
// 这是避让算法的核心热点：一次规划要调用几十次，每次要遍历上千条线段。
// 做法与前端旧版一致——按线段包围盒去空间网格里取候选，再做精确的点线距离，
// 把 O(点×线段) 降到 O(候选点×线段)。
//
// exclude 中的下标会被跳过（起终点附近的点位本来就无法避让）。
func (s *Store) FindNear(poly [][2]float64, r float64, exclude map[int32]bool) []int32 {
	if len(poly) < 2 {
		return nil
	}
	seen := make([]int32, len(s.Cameras)) // 0=未访问，1=已命中
	out := make([]int32, 0, 64)
	dLat := geo.MetersToLat(r)

	for si := 0; si+1 < len(poly); si++ {
		a, b := poly[si], poly[si+1]
		lat0 := (a[1] + b[1]) / 2
		dLng := geo.MetersToLng(r, lat0)

		i0 := int32(math.Floor((math.Min(a[0], b[0]) - dLng) / cellSize))
		i1 := int32(math.Floor((math.Max(a[0], b[0]) + dLng) / cellSize))
		j0 := int32(math.Floor((math.Min(a[1], b[1]) - dLat) / cellSize))
		j1 := int32(math.Floor((math.Max(a[1], b[1]) + dLat) / cellSize))

		for i := i0; i <= i1; i++ {
			for j := j0; j <= j1; j++ {
				for _, idx := range s.grid[cellKey(i, j)] {
					if seen[idx] == 1 {
						continue
					}
					if exclude != nil && exclude[idx] {
						continue
					}
					// 必须确认确实在 r 米内才标记 seen，
					// 否则会被同格的其它线段提前占用而漏检（旧版踩过这个坑）
					if geo.DistPointSeg(s.Pos[idx], a, b) <= r {
						seen[idx] = 1
						out = append(out, idx)
					}
				}
			}
		}
	}
	return out
}

// NearbyByType 返回距某点 r 米内、且类型等于 wantType 的全部点位及距离。
// 用于提示用户起终点附近无法避让的点位。
func (s *Store) NearbyByType(p [2]float64, r float64, wantType string) []NearHit {
	out := make([]NearHit, 0, 8)
	for i := range s.Cameras {
		if s.Cameras[i].Type != wantType {
			continue
		}
		if d := geo.DistM(s.Pos[i], p); d <= r {
			out = append(out, NearHit{Idx: int32(i), Dist: d})
		}
	}
	return out
}

// NearbyAny 返回距某点 r 米内的全部点位下标（不分类型），用于排除起终点附近点位。
func (s *Store) NearbyAny(p [2]float64, r float64) []int32 {
	out := make([]int32, 0, 8)
	for i := range s.Cameras {
		if geo.DistM(s.Pos[i], p) <= r {
			out = append(out, int32(i))
		}
	}
	return out
}
