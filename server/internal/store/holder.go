package store

import "sync/atomic"

// Holder 用一个原子指针持有当前数据集，支持运行期整体替换。
//
// 为什么不是给 Store 加锁：数据是「整体替换」而不是「就地修改」的，
// 读方拿到指针后可以完全无锁地使用（因为那份数据不会再变），
// 换数据时只是原子地换一个指针。这样热路径（避让规划要跑几十次空间查询）
// 一次锁都不用加。
type Holder struct {
	p atomic.Pointer[Store]
}

// NewHolder 创建持有者。
func NewHolder(s *Store) *Holder {
	h := &Holder{}
	h.p.Store(s)
	return h
}

// Get 返回当前数据集。返回的 *Store 视为只读。
func (h *Holder) Get() *Store { return h.p.Load() }

// Replace 原子替换数据集。
func (h *Holder) Replace(s *Store) { h.p.Store(s) }
