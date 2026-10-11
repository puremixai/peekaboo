# -*- coding: utf-8 -*-
"""生成图标 + 注入坐标数据，产出最终单文件应用。

用法：
  python build_app.py                     # 默认读 details.json，输出正式文件名
  python build_app.py <details> <out>     # 指定详情数据与输出路径（便于用快照做回归测试）

高德 Key 不进版本库：
  模板里写的是占位符 __AMAP_KEY__，构建时从同目录的 amap_key.txt（已在 .gitignore 中）
  读取真实 Key 注入。若该文件不存在，则保留占位符 YOUR_AMAP_KEY，构建出的页面
  会提示需要填入自己的 Key。可参考 amap_key.txt.example 新建。
"""
import json, os, re, sys, zlib, struct, base64

BASE = os.path.dirname(os.path.abspath(__file__))
DETAILS_PATH = sys.argv[1] if len(sys.argv) > 1 else 'details.json'
OUT_PATH = sys.argv[2] if len(sys.argv) > 2 else '北京进京摄像头避让导航.html'

# ---- 高德 Key：优先本地 amap_key.txt，缺失则用占位符 ----
AMAP_KEY = ''
_keyfile = os.path.join(BASE, 'amap_key.txt')
if os.path.exists(_keyfile):
    AMAP_KEY = open(_keyfile, encoding='utf-8').read().strip()
if not AMAP_KEY:
    AMAP_KEY = 'YOUR_AMAP_KEY'
    print('！未找到 amap_key.txt，已使用占位符 YOUR_AMAP_KEY（页面会提示填入 Key）')
else:
    print('高德 Key：已从 amap_key.txt 注入（%s…%s）' % (AMAP_KEY[:6], AMAP_KEY[-4:]))

HREF_RE = re.compile(r'^/content/\?(\d+)\.html$')


def content_id(href):
    """把 /content/?6845.html 转成 6845，便于压缩体积。"""
    m = HREF_RE.match(href or '')
    return int(m.group(1)) if m else 0

def make_dot(hexcolor, size, border=None):
    """生成圆形点位 PNG 的 data URI。"""
    r = int(hexcolor[1:3],16); g = int(hexcolor[3:5],16); b = int(hexcolor[5:7],16)
    if border:
        br=int(border[1:3],16); bg=int(border[3:5],16); bb=int(border[5:7],16)
    c = size/2.0
    r_in = c-2.2          # 填充半径
    r_out = c-0.4         # 外圈半径
    raw = bytearray()
    for y in range(size):
        raw.append(0)     # filter type 0
        for x in range(size):
            d = ((x-c+0.5)**2 + (y-c+0.5)**2) ** 0.5
            if d <= r_in:   px=(r,g,b,255)
            elif d <= r_out: px=(br,bg,bb,255) if border else (255,255,255,255)
            else:           px=(0,0,0,0)
            raw += bytes(px)
    def chunk(t,d):
        return struct.pack('>I',len(d))+t+d+struct.pack('>I', zlib.crc32(t+d)&0xffffffff)
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')
    return 'data:image/png;base64,' + base64.b64encode(png).decode()

ICONS = {
    '1':     make_dot('#1e88e5', 14),
    '2':     make_dot('#e53935', 14),
    '4':     make_dot('#fb8c00', 14),
    '5':     make_dot('#43a047', 14),
    '6':     make_dot('#8e24aa', 14),
    'avoid': make_dot('#ffd400', 22, border='#7a5c00'),
    'near':  make_dot('#ff6d00', 21, border='#7a3000'),
}

data = json.load(open(os.path.join(BASE, 'cameras.json'), encoding='utf-8'))
# [经度, 纬度, 类型aa, 名称, 更新时间, 修改时间, 原站详情ID]
arr = [[r['lng'], r['lat'], r['aa'], r['name'], r['time'],
        r.get('edittime') or '', content_id(r.get('href'))] for r in data]

# 详情页抓取结果，紧凑表示：
#   [ "2026/10/8 23:34:43", [["/upload/image/..jpg","标题"], ...] ]  = 正常
#   1                                                              = 原站详情页已失效
details = {}
missing = 0
dpath = os.path.join(BASE, DETAILS_PATH)
if os.path.exists(dpath):
    raw_det = json.load(open(dpath, encoding='utf-8'))
    for cid, v in raw_det.items():
        if v.get('missing'):
            details[cid] = 1
            missing += 1
            continue
        t = v.get('t') or ''
        imgs = [[p, ti] for p, ti in (v.get('imgs') or [])]
        if t or imgs:
            details[cid] = [t, imgs]
print('详情页数据: %d 条（带截图 %d 条 · 原站已失效 %d 条）' % (
    len(details), sum(1 for v in details.values() if v != 1 and v[1]), missing))

tpl = open(os.path.join(BASE, 'app_template.html'), encoding='utf-8').read()
assert '/*__CAMERA_DATA__*/' in tpl and '/*__ICONS__*/' in tpl
assert '__AMAP_KEY__' in tpl, '模板缺少 __AMAP_KEY__ 占位符'
out = tpl.replace('__AMAP_KEY__', AMAP_KEY)
out = out.replace('/*__CAMERA_DATA__*/', json.dumps(arr, ensure_ascii=False, separators=(',',':')))
out = out.replace('/*__ICONS__*/', json.dumps(ICONS, ensure_ascii=False, separators=(',',':')))
out = out.replace('/*__DETAILS__*/', json.dumps(details, ensure_ascii=False, separators=(',',':')))

dst = os.path.join(BASE, OUT_PATH)
open(dst, 'w', encoding='utf-8').write(out)
print('已生成:', dst)
print('点位数:', len(arr), ' 文件大小: %.1f KB' % (os.path.getsize(dst)/1024))
