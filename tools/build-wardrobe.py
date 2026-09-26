#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""============================================================
 Game Life · 电子衣橱素材构建（唯一入口）
 ------------------------------------------------------------
 输入：项目根目录的 `白底图/`（41 张衣服平铺白底照，仓库外，不入 git）
 输出：
   assets/wardrobe/       透明底 WebP  ← 唯一上线素材（深色界面上悬浮展示）
   js/wardrobe-data.js    单品清单（GL.WARDROBE_LIB），UI 只消费不硬编码
 调试：加 --white 才额外输出白底版到 assets/wardrobe-white/（仅供对比，不参与上线）

 处理链：
   1. 抠底   从四边泛洪（背景是纯白 255），只吃「与边缘连通」的白色 →
             衣服内部的白色（logo / 高光）不会被误吃。
   2. 去噪   蒙版在下采样尺度上跑中值滤波，消掉孤立的白点。
   3. 回正   **只对鞋子**。上衣 / 下装 / 配饰一律不转（见 DESKEW_SLOTS）：
             鞋子实测多为侧躺竖图 → 强制横向，再用「鞋底是直线」的判据
             纠正「正了但倒着」的（见 sole_span）。
   4. 归一   按类别把主体缩放进统一画布的目标框，使同类衣物视觉大小一致。
   5. 导出   透明 WebP + 清单 JS。

 关键约定：**换素材后必须重跑并目检成品图** ——
   回正与鞋底判据都是启发式，能自动判对 40 件不代表第 41 件也对。

 用法：
   python tools/build-wardrobe.py            # 全量构建
   python tools/build-wardrobe.py --probe    # 只打印每件的回正角度与尺寸，不写文件
   python tools/build-wardrobe.py --only 37,38,41   # 只处理指定编号（调试用）
============================================================ """

import os
import sys
import json
import argparse

from PIL import Image, ImageDraw, ImageFilter, ImageChops

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                       # game-life/
SRC_DIR = os.path.join(os.path.dirname(ROOT), '白底图')  # 项目根的白底图/
OUT_CUT = os.path.join(ROOT, 'assets', 'wardrobe')
OUT_WHT = os.path.join(ROOT, 'assets', 'wardrobe-white')
OUT_MANIFEST = os.path.join(ROOT, 'js', 'wardrobe-data.js')

CANVAS = 512           # 输出画布边长
WEBP_Q = 82
WEBP_METHOD = 4        # 0(快)~6(慢)。6 实测 4.2s/张、全量近 3 分钟，4 体积只大 ~2%
JPEG_Q = 86
WHITE_FLOOD = 16       # 泛洪阈值（背景纯白 255 → 吃掉 >= 239 的连通像素）
MASK_W = 480           # 蒙版工作宽度（越大越准、越慢；480 实测约 0.3s/张）

# 类别：目标框（画布占比）。同类走同一个框 → 「同类衣物视觉大小一致」。
# 用 min(tw*C/w, th*C/h) 缩放：宽主导的类目（上衣/鞋）取宽，高主导的（下装/包）取高。
BOXES = {
    'top':    (0.88, 0.94),
    'bottom': (0.70, 0.92),
    'shoes':  (0.88, 0.58),
    'bag':    (0.80, 0.88),
    'glass':  (0.90, 0.42),
}
# 鞋 / 配饰造型特殊，逐个给目标框（不按大类一刀切）
SPECIAL_BOX = {36: 'glass'}    # 36 = 墨镜（横向长条，不能按包的框缩放）

# ⚠ 回正**只对鞋子做**（见 build 内注释）。
# 用户 2026-09-26 明确要求：「所有衣服和裤子你都不用回正了，你回正反而会变得不正。」
# —— 这些平铺照本身是正的；最小外接矩形会被下摆 / 袖子 / 包带带偏，
# 算出 3~8° 的假倾斜，转完反而不正。
DESKEW_SLOTS = {'shoes'}

# 兜底的人工修正表（度，PIL 约定：正数=逆时针），叠加在自动回正之后。
# 目前为空 —— 41 件全部靠自动逻辑处理正确。若换素材后某一两件怎么算都不对，
# 就往这里塞一个角度，别去改通用逻辑。
ROTATE_FIX = {}

# ============================================================
# 41 件单品清单：编号 = 白底图/ 文件名排序位次（1-based）
# (编号, key, 名称, 部位, 框)
# ============================================================
ITEMS = [
    (1,  'w01', '棕色羽绒服',       'top',    'top'),
    (2,  'w02', '卡其拼黑连帽外套', 'top',    'top'),
    (3,  'w03', '米白印花卫衣',     'top',    'top'),
    (4,  'w04', '棕灰假两件短袖',   'top',    'top'),
    (5,  'w05', '棕色长袖针织衫',   'top',    'top'),
    (6,  'w06', '米白羽绒服',       'top',    'top'),
    (7,  'w07', '深灰水洗牛仔裤',   'bottom', 'bottom'),
    (8,  'w08', '军绿白拼接棒球夹克', 'top',  'top'),
    (9,  'w09', '黑色长袖衬衫',     'top',    'top'),
    (10, 'w10', '黑色印花卫衣',     'top',    'top'),
    (11, 'w11', '米色工装夹克',     'top',    'top'),
    (12, 'w12', '军绿冲锋衣',       'top',    'top'),
    (13, 'w13', '红黑格子衬衫',     'top',    'top'),
    (14, 'w14', '米色印花短袖',     'top',    'top'),
    (15, 'w15', '棕色短袖',         'top',    'top'),
    (16, 'w16', '酒红印花短袖',     'top',    'top'),
    (17, 'w17', '墨绿印花短袖',     'top',    'top'),
    (18, 'w18', '黑色短袖',         'top',    'top'),
    (19, 'w19', '卡其工装裤',       'bottom', 'bottom'),
    (20, 'w20', '黑色长袖上衣',     'top',    'top'),
    (21, 'w21', '棕色休闲裤',       'bottom', 'bottom'),
    (22, 'w22', '黑色短裤',         'bottom', 'bottom'),
    (23, 'w23', '浅色水洗牛仔裤',   'bottom', 'bottom'),
    (24, 'w24', '黑色夹克',         'top',    'top'),
    (25, 'w25', '黑色印花短袖',     'top',    'top'),
    (26, 'w26', '灰色运动裤',       'bottom', 'bottom'),
    (27, 'w27', '宝蓝短袖',         'top',    'top'),
    (28, 'w28', '深色水洗牛仔裤',   'bottom', 'bottom'),
    (29, 'w29', '浅蓝拼接外套',     'top',    'top'),
    (30, 'w30', '军绿短袖',         'top',    'top'),
    (31, 'w31', '米白拉链外套',     'top',    'top'),
    (32, 'w32', '灰色工装裤',       'bottom', 'bottom'),
    (33, 'w33', '红色双肩包',       'accessory', 'bag'),
    (34, 'w34', '军绿双肩包',       'accessory', 'bag'),
    (35, 'w35', '黑色斜挎包',       'accessory', 'bag'),
    (36, 'w36', '墨镜',             'accessory', 'glass'),
    (37, 'w37', '米白洞洞鞋',       'shoes',  'shoes'),
    (38, 'w38', '白黑运动鞋',       'shoes',  'shoes'),
    (39, 'w39', '黑色休闲鞋',       'shoes',  'shoes'),
    (40, 'w40', '黑白帆布鞋',       'shoes',  'shoes'),
    (41, 'w41', '灰白跑鞋',         'shoes',  'shoes'),
]


# ------------------------------------------------------------
# 1. 抠底：从四边泛洪，只吃与边缘连通的白色
# ------------------------------------------------------------
def alpha_mask(im):
    w, h = im.size
    sw = min(MASK_W, w)
    sh = max(1, int(h * sw / w))
    small = im.resize((sw, sh), Image.LANCZOS)
    gf = small.convert('L').copy()
    seeds = [(0, 0), (sw - 1, 0), (0, sh - 1), (sw - 1, sh - 1),
             (sw // 2, 0), (sw // 2, sh - 1), (0, sh // 2), (sw - 1, sh // 2)]
    for s in seeds:
        try:
            ImageDraw.floodfill(gf, s, 128, thresh=WHITE_FLOOD)
        except Exception:
            pass
    m = gf.point(lambda v: 0 if v == 128 else 255)
    m = m.filter(ImageFilter.MedianFilter(3))       # 去孤立噪点
    return m.resize((w, h), Image.LANCZOS)


# ------------------------------------------------------------
# 2. 回正：找让外接矩形面积最小的角度
# ------------------------------------------------------------
def deskew_angle(mask, rng=45.0, coarse=3.0, fine=0.5):
    w, h = mask.size
    sw = min(180, w)
    m = mask.resize((sw, max(1, int(h * sw / w))), Image.NEAREST)
    m = m.point(lambda v: 255 if v > 127 else 0)

    def area(a):
        r = m.rotate(a, resample=Image.NEAREST, expand=True, fillcolor=0)
        bb = r.getbbox()
        return 0 if bb is None else (bb[2] - bb[0]) * (bb[3] - bb[1])

    best, best_a = None, 0.0
    a = -rng
    while a <= rng + 1e-6:
        v = area(a)
        if best is None or v < best:
            best, best_a = v, a
        a += coarse
    a = best_a - coarse
    while a <= best_a + coarse + 1e-6:
        v = area(a)
        if v < best:
            best, best_a = v, a
        a += fine
    return round(best_a, 2), best


def base_area(mask):
    bb = mask.getbbox()
    return 0 if bb is None else (bb[2] - bb[0]) * (bb[3] - bb[1])


# ------------------------------------------------------------
# 3. 鞋底朝向：鞋底是条近乎笔直的线，鞋面不是
#    → 转成横向后，比较上/下边缘 y 值的方差，方差小的那侧才是鞋底。
#    实测 5 双鞋全判对（其中 w40 人眼都会看错，这条判据判对了）。
# ------------------------------------------------------------
def sole_span(mask, res=200):
    bb = mask.getbbox()
    if not bb:
        return None
    sub = mask.crop(bb)
    sw = min(res, sub.width)
    m = sub.resize((sw, max(1, int(sub.height * sw / sub.width))), Image.LANCZOS)
    m = m.point(lambda v: 255 if v > 127 else 0)
    px = m.load()
    W, H = m.size
    tops, bots = [], []
    for x in range(int(W * 0.22), int(W * 0.78)):
        ys = [y for y in range(H) if px[x, y] > 127]
        if ys:
            tops.append(ys[0])
            bots.append(ys[-1])
    if len(tops) < 10:
        return None

    def var(a):
        mu = sum(a) / len(a)
        return sum((v - mu) ** 2 for v in a) / len(a)
    return var(tops), var(bots)


# ------------------------------------------------------------
# 3. 归一：主体缩放进目标框，居中到正方画布
# ------------------------------------------------------------
def normalize(cut, box, canvas=CANVAS):
    bb = cut.getbbox()
    if bb is None:
        return Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
    sub = cut.crop(bb)
    tw, th = box[0] * canvas, box[1] * canvas
    s = min(tw / sub.width, th / sub.height)
    nw, nh = max(1, int(round(sub.width * s))), max(1, int(round(sub.height * s)))
    sub = sub.resize((nw, nh), Image.LANCZOS)
    out = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
    x = (canvas - nw) // 2
    y = int((canvas - nh) * 0.48)          # 略微上移，视觉居中
    out.paste(sub, (x, y), sub)
    return out


def dominant_color(cut, alpha_min=200):
    """主体像素的平均色。给矢量立绘当「这件衣服大概什么颜色」用（UI 只消费不硬编码）。"""
    small = cut.resize((64, 64), Image.LANCZOS)
    px = small.load()
    r = g = b = n = 0
    for y in range(64):
        for x in range(64):
            R, G, B, A = px[x, y]
            if A >= alpha_min:
                r += R; g += G; b += B; n += 1
    if not n:
        return '#5b6472'
    return '#%02x%02x%02x' % (r // n, g // n, b // n)


# ------------------------------------------------------------
# 主流程
# ------------------------------------------------------------
def build(only=None, probe=False, white=False):
    files = sorted(os.listdir(SRC_DIR))
    if not probe:
        os.makedirs(OUT_CUT, exist_ok=True)
        if white:
            os.makedirs(OUT_WHT, exist_ok=True)

    manifest = []
    for idx, key, name, slot, boxkey in ITEMS:
        if only and idx not in only:
            continue
        src = os.path.join(SRC_DIR, files[idx - 1])
        im = Image.open(src).convert('RGB')

        mask = alpha_mask(im)
        # ⚠ 只有鞋子回正。衣服 / 裤子 / 配饰一律不转（见文件头 DESKEW_SLOTS 的说明）。
        ang = deskew_angle(mask)[0] if slot in DESKEW_SLOTS else 0.0
        # 小幅倾斜才回正；角度太小就跳过，避免无谓重采样糊边
        extra = ROTATE_FIX.get(idx, 0)
        total = ang + extra
        if abs(total) >= 0.75:
            im = im.rotate(total, resample=Image.BICUBIC, expand=True,
                           fillcolor=(255, 255, 255))
            mask = mask.rotate(total, resample=Image.BICUBIC, expand=True, fillcolor=0)

        # 鞋类：实测多为侧躺竖图 → 先强制横向，再按鞋底判据纠正「正了但倒着」
        if slot == 'shoes':
            bb = mask.getbbox()
            if bb and (bb[3] - bb[1]) > (bb[2] - bb[0]):
                im = im.rotate(-90, resample=Image.BICUBIC, expand=True,
                               fillcolor=(255, 255, 255))
                mask = mask.rotate(-90, resample=Image.BICUBIC, expand=True, fillcolor=0)
            span = sole_span(mask)
            if span and span[1] > span[0]:
                im = im.rotate(180, resample=Image.BICUBIC, expand=True,
                               fillcolor=(255, 255, 255))
                mask = mask.rotate(180, resample=Image.BICUBIC, expand=True, fillcolor=0)

        cut = im.convert('RGBA')
        cut.putalpha(mask)
        box = SPECIAL_BOX.get(idx, boxkey)
        norm = normalize(cut, BOXES[box])

        if probe:
            bb = norm.getbbox()
            print(f"#{idx:<3} {key} {name:<16} 回正 {ang:>6.2f}°  "
                  f"框 {box:<6} 主体 {bb[2]-bb[0]}x{bb[3]-bb[1]}")
            continue

        # 统一出透明 WebP（方案 A，用户 2026-09-26 拍板）
        norm.save(os.path.join(OUT_CUT, key + '.webp'), 'WEBP',
                  quality=WEBP_Q, method=WEBP_METHOD)
        # 白底版仅调试对比用（--white），默认不出
        if white:
            wht = Image.new('RGB', norm.size, (255, 255, 255))
            wht.paste(norm, (0, 0), norm)
            wht.save(os.path.join(OUT_WHT, key + '.jpg'), 'JPEG',
                     quality=JPEG_Q, optimize=True, progressive=True)

        # box = 主体在 512 画布里的外接框 [x,y,w,h]，给矢量立绘做「贴到哪个部位」的换算用
        # img = **完整相对路径**，不要写成 'assets/wardrobe/' + id + '.webp' 去拼：
        #       tools/build-dist.js 靠扫 JS 里的字面量收集产物，拼接出来的路径它看不见，
        #       结果 dist/ 里没有图片、线上 404，而四层静态校验全是绿的（v1.8.0 实测踩过）。
        nb = norm.getbbox() or (0, 0, CANVAS, CANVAS)
        manifest.append({'id': key, 'name': name, 'slot': slot, 'cat': box,
                         'color': dominant_color(norm), 'box': list(nb),
                         'img': 'assets/wardrobe/%s.webp' % key})

    if probe:
        return

    if only:
        # --only 只重出图片；清单是全量的，缺项会写坏，所以这里不碰它
        print(f"OK  重建 {len(only)} 件（清单未重写）")
        return

    with open(OUT_MANIFEST, 'w', encoding='utf-8') as f:
        f.write('/* 由 tools/build-wardrobe.py 生成，请勿手改。\n'
                '   ⚠ 必须在 js/storage.js **之后**引入 —— GL 是 storage.js 建的，\n'
                '     本文件是裸 `GL.WARDROBE_LIB = …`，排在前面会 ReferenceError。\n'
                '   单品清单：id / name / slot(top|bottom|shoes|accessory) / cat(归一框)\n'
                '             color(主体平均色，矢量立绘用) / box(主体在 512 画布里的外接框)\n'
                '             img(单品的完整相对路径 —— **必须是字面量**，\n'
                '                 tools/build-dist.js 靠扫字面量收集产物，拼接的路径它看不见)\n'
                '   图片：assets/wardrobe/<id>.webp（512×512 透明底） */\n')
        f.write('GL.WARDROBE_LIB = ' + json.dumps(manifest, ensure_ascii=False,
                                                  indent=2) + ';\n')

    sz_cut = sum(os.path.getsize(os.path.join(OUT_CUT, f))
                 for f in os.listdir(OUT_CUT))
    print(f"OK  {len(manifest)} 件")
    print(f"  透明版 assets/wardrobe/  {sz_cut/1024:.0f} KB")
    print(f"  清单   js/wardrobe-data.js")


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--probe', action='store_true', help='只打印诊断，不写文件')
    ap.add_argument('--only', type=str, default='', help='只处理指定编号，逗号分隔')
    ap.add_argument('--white', action='store_true',
                    help='额外输出白底版（assets/wardrobe-white/，仅对比用，不参与上线）')
    a = ap.parse_args()
    only = {int(x) for x in a.only.split(',') if x.strip()} if a.only else None
    build(only=only, probe=a.probe, white=a.white)
