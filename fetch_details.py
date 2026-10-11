# -*- coding: utf-8 -*-
"""抓取 jinjing365.com 每个点位的详情页信息。

详情页结构（/content/?<id>.html）：
  <span class="STYLE100">名称---更新时间：2026/10/8 23:34:43</span>
  <img src="/upload/image/20261008/xxx.jpg" title="图片标题.jpg" />

输出 details.json： { "<id>": {"t": "2026/10/8 23:34:43", "imgs": [["/upload/image/..jpg", "标题"], ...]} }

关于速度：该站由单核 IIS 承载，服务端限流，实测并发 4/8/16 吞吐都锁定在
约 1.2~1.5 页/秒（约 0.7s 服务端渲染耗时 × 1 核）。加大并发无收益，只会
增加被截断的概率。因此这里用 6 并发 + 完整页校验 + 重试。

关于失效页：原站自身存在失效链接——首页 LabelsData 里仍挂着已删除点位的
href，但详情页返回 HTTP 200 + 一段 306 字节的 "页面不存在,稍后将自动返回…"。
这类页是**终止状态，重试无意义**，标记为 missing。

校验规则：
  "页面不存在"            → missing（终止）
  含 class="STYLE100" 且含 </html> → 完整页
  其余                    → 真截断（服务器提前关连接），重试

支持断点续抓：已存在的 id 会跳过。
"""
import json, os, re, time, threading
import requests
from requests.adapters import HTTPAdapter
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = os.path.dirname(os.path.abspath(__file__))
SITE = 'https://www.jinjing365.com'
OUT = os.path.join(BASE, 'details.json')
FAIL = os.path.join(BASE, 'details_failed.json')

WORKERS = 6
TIMEOUT = 30
RETRY = 6

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9'}

RE_HEAD = re.compile(r'<span class="STYLE100">(.*?)</span>', re.S)
RE_IMG = re.compile(r'<img\s+src="(/upload/image/[^"]+)"(?:\s+title="([^"]*)")?', re.I)

lock = threading.Lock()
_tl = threading.local()


def session():
    """每个线程独立 session（服务器 Connection: close，复用无收益，但省去重复建 header）。"""
    s = getattr(_tl, 's', None)
    if s is None:
        s = requests.Session()
        s.headers.update(UA)
        ad = HTTPAdapter(pool_connections=WORKERS * 2, pool_maxsize=WORKERS * 2, max_retries=0)
        s.mount('https://', ad)
        s.mount('http://', ad)
        _tl.s = s
    return s


def parse(html):
    """返回 (状态, 精确更新时间, [[图片路径, 图片标题], ...])。

    状态：'ok' 完整页 / 'missing' 原站页面不存在 / None 残缺需重试
    """
    if '页面不存在' in html:
        return 'missing', None, []
    if 'class="STYLE100"' not in html or '</html>' not in html.lower():
        return None, None, None    # 残缺页，交给上层重试
    t = None
    m = RE_HEAD.search(html)
    if m:
        txt = re.sub(r'<[^>]+>', '', m.group(1)).strip()
        mm = re.search(r'更新时间[:：]\s*(.+)$', txt)
        if mm:
            t = mm.group(1).strip()
    imgs = [[p, (ti or '')] for p, ti in RE_IMG.findall(html)]
    return 'ok', t, imgs


def fetch_one(cid):
    url = f'{SITE}/content/?{cid}.html'
    s = session()
    last = 'unknown'
    for attempt in range(RETRY):
        try:
            html = s.get(url, timeout=TIMEOUT).content.decode('utf-8', 'ignore')
            st, t, imgs = parse(html)
            if st == 'missing':
                return cid, {'missing': True}
            if st == 'ok':
                return cid, {'t': t, 'imgs': imgs}
            last = f'truncated({len(html)}B)'
        except Exception as e:
            last = f'{type(e).__name__}: {e}'
        time.sleep(0.6 * (attempt + 1))
    return cid, {'error': last}


def main():
    cams = json.load(open(os.path.join(BASE, 'cameras.json'), encoding='utf-8'))
    ids = sorted({int(re.search(r'(\d+)', c['href']).group(1)) for c in cams})
    print(f'待抓取详情页：{len(ids)} 个', flush=True)

    result = {}
    if os.path.exists(OUT):
        result = json.load(open(OUT, encoding='utf-8'))
        print(f'已有缓存：{len(result)} 条，续抓剩余部分', flush=True)

    todo = [i for i in ids if str(i) not in result]
    print(f'本次需抓取：{len(todo)} 个', flush=True)
    if not todo:
        print('已全部完成')
        return

    failed, done, trunc, missing = {}, 0, 0, 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(fetch_one, i): i for i in todo}
        for fut in as_completed(futs):
            cid, info = fut.result()
            with lock:
                if info.get('missing'):
                    result[str(cid)] = {'missing': 1}
                    missing += 1
                elif 'error' in info:
                    failed[str(cid)] = info['error']
                    if 'truncated' in info['error']:
                        trunc += 1
                else:
                    result[str(cid)] = {'t': info['t'], 'imgs': info['imgs']}
                done += 1
                if done % 100 == 0 or done == len(todo):
                    el = time.time() - t0
                    rate = done / el if el else 0
                    eta = (len(todo) - done) / rate if rate else 0
                    print(f'  {done}/{len(todo)}  用时 {el/60:.1f}min  速度 {rate:.2f}/s  '
                          f'预计剩余 {eta/60:.1f}min  失效 {missing}  失败 {len(failed)}', flush=True)
                    json.dump(result, open(OUT, 'w', encoding='utf-8'),
                              ensure_ascii=False, separators=(',', ':'))

    json.dump(result, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    if failed:
        json.dump(failed, open(FAIL, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print(f'失败 {len(failed)} 个（其中截断 {trunc} 个），已写入 details_failed.json', flush=True)

    have_img = sum(1 for v in result.values() if v.get('imgs'))
    have_t = sum(1 for v in result.values() if v.get('t'))
    print(f'完成：共 {len(result)} 条 | 有精确时间 {have_t} | 有截图 {have_img} | '
          f'原站已失效 {missing} | 大小 {os.path.getsize(OUT)/1024/1024:.1f} MB', flush=True)


if __name__ == '__main__':
    main()
