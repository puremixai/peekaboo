// 几何工具：与前端旧版实现保持完全一致的近似算法，保证避让结果可复现。
//
// 距离用「等距圆柱近似」：在北京市区（约 40°N）误差 <0.1%，
// 但换到高纬度会变差——本项目只服务北京，够用。
package geo

import "math"

const (
	EarthR = 6371000.0 // 地球半径（米）
	D2R    = math.Pi / 180
)

// DistPointSeg 返回点 p 到线段 ab 的最短距离（米）。
func DistPointSeg(p, a, b [2]float64) float64 {
	lat0 := (a[1] + b[1]) / 2 * D2R
	kx := EarthR * math.Cos(lat0) * D2R
	ky := EarthR * D2R
	ax, ay := a[0]*kx, a[1]*ky
	bx, by := b[0]*kx, b[1]*ky
	px, py := p[0]*kx, p[1]*ky

	dx, dy := bx-ax, by-ay
	l2 := dx*dx + dy*dy
	t := 0.0
	if l2 > 0 {
		t = ((px-ax)*dx + (py-ay)*dy) / l2
	}
	if t < 0 {
		t = 0
	} else if t > 1 {
		t = 1
	}
	cx, cy := ax+t*dx, ay+t*dy
	return math.Hypot(px-cx, py-cy)
}

// DistM 返回两点间距离（米）。
func DistM(p, q [2]float64) float64 { return DistPointSeg(p, q, q) }

// MinDistToPoly 返回点到折线的最短距离（米）。
func MinDistToPoly(p [2]float64, poly [][2]float64) float64 {
	d := math.MaxFloat64
	for s := 0; s+1 < len(poly); s++ {
		if dd := DistPointSeg(p, poly[s], poly[s+1]); dd < d {
			d = dd
		}
	}
	return d
}

// MetersToLat 把米换算成纬度度数。
func MetersToLat(m float64) float64 { return m / 111320 }

// MetersToLng 把米换算成经度度数（按给定纬度收缩）。
func MetersToLng(m, lat float64) float64 {
	c := math.Cos(lat * D2R)
	if c < 0.2 {
		c = 0.2 // 与前端一致：避免高纬度除零/爆炸
	}
	return m / (111320 * c)
}
