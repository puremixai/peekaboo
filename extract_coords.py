# -*- coding: utf-8 -*-
"""
从 jinjing365.com 首页的 LabelsData 数组中提取全部点位坐标数据。
输入: index.html（原站首页快照；不在版本库中，缺失时会自动从原站下载）
输出: cameras.json / cameras.csv

说明：index.html 是第三方网站的整站镜像，其中还带有原站自己的高德 Key，
      因此不纳入版本库。本脚本在文件缺失时会自动抓取一份到本地。
"""
import re
import json
import csv
import os

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, "index.html")
HOMEPAGE = "https://www.jinjing365.com/index.asp"

if not os.path.exists(SRC):
    print("未找到 index.html，正在从原站下载…")
    import urllib.request
    req = urllib.request.Request(HOMEPAGE, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read().decode("utf-8", "ignore")
    with open(SRC, "w", encoding="utf-8", newline="\n") as f:
        f.write(data)
    print("已保存 index.html：%.1f KB" % (len(data.encode("utf-8")) / 1024))

with open(SRC, "r", encoding="utf-8", errors="ignore") as f:
    html = f.read()

# 1. 截取 LabelsData = [ ... ]; 代码块
start = html.find("var LabelsData")
start = html.find("[", start)
# 从 start 开始做括号配对，找到数组结尾
depth = 0
end = None
in_str = False
quote = ""
i = start
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
            in_str = True
            quote = c
        elif c == "[":
            depth += 1
        elif c == "]":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    i += 1

block = html[start:end]
print("LabelsData 代码块长度:", len(block))

# 2. 按对象切分：每个 { ... }
objs = re.findall(r"\{[^{}]*\}", block, flags=re.S)
print("对象数量:", len(objs))

records = []
for o in objs:
    name = re.search(r"name\s*:\s*'([^']*)'", o)
    pos = re.search(r"position\s*:\s*\[\s*([\-\d.]+)\s*,\s*([\-\d.]+)\s*\]", o)
    aa = re.search(r"aa\s*:\s*'([^']*)'", o)
    tm = re.search(r"time\s*:\s*'([^']*)'", o)
    et = re.search(r"edittime\s*:\s*'([^']*)'", o)
    href = re.search(r"href\s*:\s*'([^']*)'", o)
    if not (name and pos):
        continue
    lng, lat = float(pos.group(1)), float(pos.group(2))
    records.append({
        "name": name.group(1).strip(),
        "lng": lng,          # 高德/GCJ-02 经度
        "lat": lat,          # 高德/GCJ-02 纬度
        "aa": aa.group(1) if aa else "",
        "time": tm.group(1) if tm else "",
        "edittime": et.group(1) if et else "",
        "href": href.group(1) if href else "",
    })

# 去重（同名同坐标）
seen = set()
uniq = []
for r in records:
    key = (r["name"], r["lng"], r["lat"])
    if key in seen:
        continue
    seen.add(key)
    uniq.append(r)

print("有效记录:", len(records), " 去重后:", len(uniq))

# 3. 输出 JSON
with open(os.path.join(BASE, "cameras.json"), "w", encoding="utf-8") as f:
    json.dump(uniq, f, ensure_ascii=False, indent=2)

# 4. 输出 CSV (UTF-8 BOM, 方便 Excel 打开)
with open(os.path.join(BASE, "cameras.csv"), "w", encoding="utf-8-sig", newline="") as f:
    w = csv.writer(f)
    w.writerow(["序号", "名称", "经度(GCJ-02)", "纬度(GCJ-02)", "类型aa", "更新时间time", "编辑时间edittime", "详情链接href"])
    for idx, r in enumerate(uniq, 1):
        w.writerow([idx, r["name"], r["lng"], r["lat"], r["aa"], r["time"], r["edittime"],
                    "https://www.jinjing365.com" + r["href"] if r["href"] else ""])

# 5. 统计
from collections import Counter
aa_cnt = Counter(r["aa"] for r in uniq)
time_cnt = Counter(r["time"] for r in uniq)
print("类型分布:", dict(aa_cnt))
print("更新时间 TOP5:", time_cnt.most_common(5))
print("完成: cameras.json / cameras.csv")
