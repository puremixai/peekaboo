# -*- coding: utf-8 -*-
"""抓取 jinjing365.com 每个点位的「车主评论」。

评论不在详情页 HTML 里，而是由两段脚本异步加载：
  详情页:  <div id="commentlist">评论加载中...</div>
           <script src="/plug/comment/comment.asp?id=6845"></script>
  comment.asp 只返回一段 JS 辅助函数（所有 id 都一样），真正的列表由它再发一次请求：
  POST /plug/comment/commentList.asp?id=<id>&page=<n>

评论列表 HTML 结构：
  <div class="clistbox">
    <div class="line1"><span>发表于：2026/1/17 22:23:51</span> 评论者：津A  </div>
    <div class="line2">修路全拆了，放心走</div>
  </div>
  <div class="pages"><a href="javascript:pager(5000,2)">末页</a></div>   ← 末页页码
无评论时整页返回：还没有评论！

每页 20 条；末页页码从 .pages 里的 pager(id,N) 取最大值。

输出 comments.json：{ "<id>": [[ "2026/1/17 22:23:51", "津A", "修路全拆了，放心走" ], ...] }
只记录有评论的 id。支持断点续抓。
"""
import json, os, re, time, html as htmllib, threading
import requests
from requests.adapters import HTTPAdapter
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, 'comments.json')
FAIL = os.path.join(BASE, 'comments_failed.json')

WORKERS = 8
TIMEOUT = 25
RETRY = 4
PAGE_LIMIT = 30          # 防御：单个点位最多翻这么多页

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Content-Type': 'application/x-www-form-urlencoded;',
      'Accept-Language': 'zh-CN,zh;q=0.9'}

RE_BOX = re.compile(
    r'<div class="clistbox">\s*'
    r'<div class="line1"><span>发表于：(?P<t>.*?)</span>\s*评论者：(?P<who>.*?)\s*</div>\s*'
    r'<div class="line2">(?P<txt>.*?)</div>', re.S)
RE_LASTPAGE = re.compile(r'pager\(\s*\d+\s*,\s*(\d+)\s*\)')

lock = threading.Lock()
_tl = threading.local()


def session():
    s = getattr(_tl, 's', None)
    if s is None:
        s = requests.Session()
        s.headers.update(UA)
        ad = HTTPAdapter(pool_connections=WORKERS * 2, pool_maxsize=WORKERS * 2, max_retries=0)
        s.mount('https://', ad)
        s.mount('http://', ad)
        _tl.s = s
    return s


def clean(s):
    """把评论正文里的 HTML 片段转成纯文本。"""
    if not s:
        return ''
    s = re.sub(r'<br\s*/?>', '\n', s, flags=re.I)
    s = re.sub(r'<[^>]+>', '', s)
    s = htmllib.unescape(s)
    s = s.replace('\u00a0', ' ')
    return re.sub(r'[ \t]+', ' ', s).strip()


def parse_page(txt):
    """返回 (评论列表, 末页页码)。"""
    items = []
    for m in RE_BOX.finditer(txt):
        body = clean(m.group('txt'))
        who = clean(m.group('who'))
        if not body and not who:
            continue
        items.append([clean(m.group('t')), who, body])
    last = 1
    nums = RE_LASTPAGE.findall(txt)
    if nums:
        last = max(int(n) for n in nums)
    return items, last


def fetch_page(cid, page):
    url = f'https://www.jinjing365.com/plug/comment/commentList.asp?id={cid}&page={page}'
    s = session()
    last = 'unknown'
    for attempt in range(RETRY):
        try:
            r = s.post(url, timeout=TIMEOUT)
            return r.text, None
        except Exception as e:
            last = f'{type(e).__name__}: {e}'
            time.sleep(0.5 * (attempt + 1))
    return None, last


def fetch_one(cid):
    """抓一个点位的全部评论页。"""
    all_items = []
    txt, err = fetch_page(cid, 1)
    if err:
        return cid, {'error': err}
    items, last = parse_page(txt)
    all_items += items
    if last > PAGE_LIMIT:
        last = PAGE_LIMIT
    for p in range(2, last + 1):
        t2, err2 = fetch_page(cid, p)
        if err2:
            return cid, {'error': err2, 'partial': all_items}
        more, _ = parse_page(t2)
        if not more:
            break
        all_items += more
    return cid, {'comments': all_items}


def main():
    cams = json.load(open(os.path.join(BASE, 'cameras.json'), encoding='utf-8'))
    ids = sorted({int(re.search(r'(\d+)', c['href']).group(1)) for c in cams})
    print(f'待抓取评论的点位：{len(ids)} 个', flush=True)

    result = {}
    if os.path.exists(OUT):
        result = json.load(open(OUT, encoding='utf-8'))
        print(f'已有缓存：{len(result)} 个点位有评论', flush=True)

    todo = [i for i in ids if str(i) not in result]
    print(f'本次需检查：{len(todo)} 个点位', flush=True)
    if not todo:
        print('已全部完成')
        return

    failed, done = {}, 0
    n_cm = 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(fetch_one, i): i for i in todo}
        for fut in as_completed(futs):
            cid, info = fut.result()
            with lock:
                if 'error' in info:
                    failed[str(cid)] = info['error']
                    if info.get('partial'):
                        result[str(cid)] = info['partial']
                        n_cm += len(info['partial'])
                else:
                    if info['comments']:
                        result[str(cid)] = info['comments']
                        n_cm += len(info['comments'])
                done += 1
                if done % 200 == 0 or done == len(todo):
                    el = time.time() - t0
                    rate = done / el if el else 0
                    eta = (len(todo) - done) / rate if rate else 0
                    print(f'  {done}/{len(todo)}  用时 {el/60:.1f}min  速度 {rate:.1f}/s  '
                          f'预计剩余 {eta/60:.1f}min  有评论点位 {len(result)}  失败 {len(failed)}',
                          flush=True)
                    json.dump(result, open(OUT, 'w', encoding='utf-8'),
                              ensure_ascii=False, separators=(',', ':'))

    json.dump(result, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    if failed:
        json.dump(failed, open(FAIL, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    total = sum(len(v) for v in result.values())
    print(f'完成：有评论点位 {len(result)} / {len(ids)} | 评论总数 {total} | '
          f'失败 {len(failed)} | 大小 {os.path.getsize(OUT)/1024/1024:.2f} MB', flush=True)


if __name__ == '__main__':
    main()
