# -*- coding: utf-8 -*-
"""点位数据的共用逻辑：抓首页、解析 LabelsData、读写 cameras.json、做版本对比。

原站首页把全部点位内联在一个 JS 数组里：
    var LabelsData = [ { name:'...', position:[lng,lat], aa:'2', time:'...',
                         edittime:'', href:'/content/?6845.html', icon:... }, ... ]

这是点位数据的**唯一权威来源**，所以更新模型就是「重新抓一次首页、重新解析、整体替换」——
不需要增量拉取，也不会有对不上的问题。

详情页（details.json）和评论（comments.json）按 href 里的 id 挂载，
新增点位只要补抓对应 id 即可，旧条目的 id 不变、无需重抓。
"""
import json
import os
import re
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
# 数据统一放在 data/ 下：这样 docker compose 可以整目录挂载（./data:/app/data），
# 更新数据时宿主机改完文件容器立刻可见，不用重新构建镜像。
# 注意必须挂目录而不是单个文件——save_cameras 用的是 os.replace 原子替换，
# 会换掉 inode，文件级 bind mount 会一直指向旧 inode。
DATA_DIR = os.path.join(BASE, "data")
HOMEPAGE = "https://www.jinjing365.com/index.asp"
CACHE_HTML = os.path.join(BASE, "index.html")
CAMERAS = os.path.join(DATA_DIR, "cameras.json")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

HREF_ID_RE = re.compile(r"/content/\?(\d+)\.html")


def fetch_homepage(timeout=60):
    """下载原站首页。"""
    req = urllib.request.Request(HOMEPAGE, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "ignore")


def parse_labels(html):
    """从首页 HTML 里解析出全部点位记录。"""
    start = html.find("var LabelsData")
    if start < 0:
        raise ValueError("首页里找不到 LabelsData，站点结构可能变了")
    start = html.find("[", start)

    # 括号配对找出数组结尾（字符串里的括号不算）
    depth, end, in_str, quote, i = 0, None, False, "", start
    while i < len(html):
        c = html[i]
        if in_str:
            if c == "\\":
                i += 2
                continue
            if c == quote:
                in_str = False
        else:
            if c in ("'", '"'):
                in_str, quote = True, c
            elif c == "[":
                depth += 1
            elif c == "]":
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
        i += 1
    if end is None:
        raise ValueError("LabelsData 数组没有正常闭合")

    block = html[start:end]
    records = []
    for o in re.findall(r"\{[^{}]*\}", block, flags=re.S):
        name = re.search(r"name\s*:\s*'([^']*)'", o)
        pos = re.search(r"position\s*:\s*\[\s*([\-\d.]+)\s*,\s*([\-\d.]+)\s*\]", o)
        if not (name and pos):
            continue
        aa = re.search(r"aa\s*:\s*'([^']*)'", o)
        tm = re.search(r"time\s*:\s*'([^']*)'", o)
        et = re.search(r"edittime\s*:\s*'([^']*)'", o)
        href = re.search(r"href\s*:\s*'([^']*)'", o)
        records.append({
            "name": name.group(1).strip(),
            "lng": float(pos.group(1)),
            "lat": float(pos.group(2)),
            "aa": aa.group(1) if aa else "",
            "time": tm.group(1) if tm else "",
            "edittime": et.group(1) if et else "",
            "href": href.group(1) if href else "",
        })

    # 同名同坐标去重（原站偶有重复）
    seen, uniq = set(), []
    for r in records:
        k = (r["name"], r["lng"], r["lat"])
        if k in seen:
            continue
        seen.add(k)
        uniq.append(r)
    return records, uniq


def point_key(rec):
    """点位的主键：优先用详情页 id（href 里的数字），它是原站的稳定标识。"""
    m = HREF_ID_RE.search(rec.get("href") or "")
    if m:
        return int(m.group(1))
    # 极少数没有 href 的，退化成「名称+坐标」
    return f"{rec.get('name')}@{rec.get('lng')},{rec.get('lat')}"


def load_cameras(path=CAMERAS):
    """读取现有的 cameras.json；不存在返回 None。"""
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_cameras(records, path=CAMERAS):
    """写回 cameras.json（先写临时文件再替换，避免中途失败留下半个文件）。"""
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def diff_cameras(old, new):
    """对比新旧点位，返回 (新增, 删除, 变更)。

    变更只比较业务字段；href 变了会被当成「删除 + 新增」，因为详情页 id 变了。
    """
    FIELDS = ("name", "lng", "lat", "aa", "time", "edittime")
    old_map = {point_key(r): r for r in (old or [])}
    new_map = {point_key(r): r for r in new}

    added = [new_map[k] for k in new_map if k not in old_map]
    removed = [old_map[k] for k in old_map if k not in new_map]
    changed = []
    for k in new_map:
        if k not in old_map:
            continue
        a, b = old_map[k], new_map[k]
        d = {f: [a.get(f), b.get(f)] for f in FIELDS if a.get(f) != b.get(f)}
        if d:
            changed.append({"key": k, "name": b["name"], "fields": d})
    return added, removed, changed
