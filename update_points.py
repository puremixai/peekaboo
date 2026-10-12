# -*- coding: utf-8 -*-
"""更新点位数据：重新抓原站首页 → 解析 → 与现有 cameras.json 对比 → 报告变更 → 写入。

用法：
    python update_points.py                # 抓线上首页并更新
    python update_points.py --dry-run      # 只对比报告，不写任何文件
    python update_points.py --html x.html  # 用本地 HTML（离线调试 / 复现问题）

变更历史追加到 changes.json（每次一条），便于前端或人工追溯"什么时候多了/少了哪个摄像头"。

为什么点位数据用「整体替换」而不是增量：
原站首页内联了全部点位的权威列表，重新抓一次就是全量快照，不存在增量对不上的问题。
详情页与评论按 href 里的 id 挂载，新增点位只要补抓对应 id 即可，旧条目的 id 不变、无需重抓。
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime

import pointlib

CHANGES = os.path.join(pointlib.DATA_DIR, "changes.json")
MAX_HISTORY = 200  # changes.json 最多保留多少条记录


def load_changes():
    if os.path.exists(CHANGES):
        try:
            with open(CHANGES, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            print("[warn] changes.json 解析失败，将重新开始记录", file=sys.stderr)
    return []


def save_changes(history):
    tmp = CHANGES + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(history[-MAX_HISTORY:], f, ensure_ascii=False, indent=1)
    os.replace(tmp, CHANGES)


def brief(rec, key=None):
    bits = [rec.get("name", "?")]
    if rec.get("aa"):
        bits.append(f"类型{rec['aa']}")
    if rec.get("lng") is not None:
        bits.append(f"{rec['lng']:.6f},{rec['lat']:.6f}")
    if key is not None:
        bits.append(f"id={key}")
    return "  ".join(bits)


def main():
    ap = argparse.ArgumentParser(description="更新进京证摄像头点位数据")
    ap.add_argument("--dry-run", action="store_true", help="只对比并报告，不写文件")
    ap.add_argument("--html", help="改用本地 HTML 文件，不联网")
    args = ap.parse_args()

    t0 = time.time()

    # ---------- 1. 取最新首页 ----------
    if args.html:
        print(f"读取本地 HTML：{args.html}")
        with open(args.html, encoding="utf-8", errors="ignore") as f:
            html = f.read()
    else:
        print(f"下载首页：{pointlib.HOMEPAGE}")
        try:
            html = pointlib.fetch_homepage()
        except Exception as e:
            print(f"✘ 下载失败：{e}", file=sys.stderr)
            print("  网络不通时可先用 --html 指定本地快照，或稍后重试。", file=sys.stderr)
            return 1
        # 顺手更新本地缓存，extract_coords.py 会用到
        with open(pointlib.CACHE_HTML, "w", encoding="utf-8", newline="\n") as f:
            f.write(html)

    # ---------- 2. 解析 ----------
    try:
        raw, latest = pointlib.parse_labels(html)
    except ValueError as e:
        print(f"✘ 解析失败：{e}", file=sys.stderr)
        return 1
    print(f"解析出 {len(raw)} 条记录，去重后 {len(latest)} 个点位")

    # 兜底：解析结果明显异常时不要覆盖已有数据（避免站点改版把数据洗掉）
    old = pointlib.load_cameras()
    if old and len(latest) < len(old) * 0.5:
        print(f"✘ 解析出的点位只有 {len(latest)} 个，不足现有的 50%（{len(old)} 个）。", file=sys.stderr)
        print("  站点可能改版了，已中止以免覆盖正常数据。", file=sys.stderr)
        return 1

    # ---------- 3. 对比 ----------
    added, removed, changed = pointlib.diff_cameras(old, latest)

    print()
    print("=" * 60)
    if old is None:
        print(f"首次提取：{len(latest)} 个点位")
    else:
        print(f"当前 {len(old)} 个 → 最新 {len(latest)} 个"
              f"（{'净增' if len(latest) >= len(old) else '净减'} {abs(len(latest) - len(old))}）")
        print(f"新增 {len(added)} · 删除 {len(removed)} · 修改 {len(changed)}")

        if added:
            print(f"\n新增 {len(added)} 个：")
            for r in added:
                print(f"  + {brief(r, pointlib.point_key(r))}")
        if removed:
            print(f"\n删除 {len(removed)} 个：")
            for r in removed:
                print(f"  - {brief(r, pointlib.point_key(r))}")
        if changed:
            print(f"\n修改 {len(changed)} 个：")
            for c in changed:
                detail = "，".join(f"{k}: {v[0]!r} → {v[1]!r}" for k, v in c["fields"].items())
                print(f"  ~ {c['name']} (id={c['key']}) {detail}")
    print("=" * 60)

    no_change = old is not None and not (added or removed or changed)
    if no_change:
        print("\n点位数据没有变化。")
    if args.dry_run:
        print("\n--dry-run：未写入任何文件。")
        return 0
    if no_change:
        return 0

    # ---------- 4. 写入 ----------
    pointlib.save_cameras(latest)
    print(f"\n✔ 已写入 {pointlib.CAMERAS}（{len(latest)} 个点位）")

    history = load_changes()
    history.append({
        "at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "source": args.html or pointlib.HOMEPAGE,
        "before": len(old) if old else 0,
        "after": len(latest),
        "added": [{"id": pointlib.point_key(r), "name": r["name"], "lng": r["lng"],
                   "lat": r["lat"], "aa": r["aa"]} for r in added],
        "removed": [{"id": pointlib.point_key(r), "name": r["name"], "aa": r["aa"]} for r in removed],
        "changed": [{"id": c["key"], "name": c["name"],
                     "fields": {k: v for k, v in c["fields"].items()}} for c in changed],
    })
    save_changes(history)
    print(f"✔ 变更记录已追加到 {os.path.basename(CHANGES)}（共 {len(history)} 条）")

    # ---------- 5. 提示后续步骤 ----------
    if added:
        print("\n下一步：补抓新增点位的详情与评论（脚本会自动跳过已有的）")
        print("  python fetch_details.py")
        print("  python fetch_comments.py")
    if removed:
        print("\n提示：被删除点位的详情与评论仍留在 details.json / comments.json 中，")
        print("      它们不会再被引用，可以忽略；想清理就重跑一次上面的两个脚本。")
    print("\n最后让服务重新加载数据（不用重启容器）：")
    print("  curl -X POST http://localhost:8080/api/admin/reload")

    print(f"\n完成，用时 {time.time() - t0:.1f} 秒")
    return 0


if __name__ == "__main__":
    sys.exit(main())
