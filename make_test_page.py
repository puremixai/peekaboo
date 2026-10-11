# -*- coding: utf-8 -*-
"""用合成小数据集生成测试页，专门验证弹窗的三种状态：
  A 正常有截图  B 正常无截图  C 原站详情页已失效
不依赖完整抓取结果，可随时运行。
"""
import json, os, re

BASE = os.path.dirname(os.path.abspath(__file__))
tpl = open(os.path.join(BASE, 'app_template.html'), encoding='utf-8').read()

# 取真实存在、且已验证过的三个点位（保证截图 URL 可访问）
CAMERAS = [
    [116.360827, 40.079540, '2', '【测试A】有截图 · 石景山区 古城南街与人民渠路交口 北向南',
     '2026/10/8', '', 6845],
    [116.399771, 40.158950, '2', '【测试B】无截图 · 测试点位', '2024/5/1', '', 3000],
    [116.380000, 40.120000, '6', '【测试C】原站详情页已失效', '2021/1/1', '', 6014],
]
DETAILS = {
    '6845': ['2026/10/8 23:34:43',
             [['/upload/image/20261008/17914737236510847.jpg', '古城西街与人民渠路交口.jpg']]],
    '3000': ['2024/5/1 08:12:00', []],
    '6014': 1,
}

out = tpl.replace('/*__CAMERA_DATA__*/', json.dumps(CAMERAS, ensure_ascii=False, separators=(',', ':')))
out = re.sub(r'/\*__ICONS__\*/', '{}', out)
out = out.replace('/*__DETAILS__*/', json.dumps(DETAILS, ensure_ascii=False, separators=(',', ':')))

# 用占位图标（避免依赖 build_app 生成）
out = out.replace("var ICONS = {};", "var ICONS = {};")

dst = os.path.join(BASE, '_test_states.html')
open(dst, 'w', encoding='utf-8').write(out)
print('已生成:', dst, os.path.getsize(dst), 'bytes')
