#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""============================================================
 Game Life · 抠图（ISNet / U2Net ONNX 本地推理）
 ------------------------------------------------------------
 背景是花床单 + 被子边 + 木地板（不是白底），泛洪吃白用不了；
 GrabCut 只能把轮廓抠个大概，贴边的床单条 / 小花老是留在蒙版里。
 改用分割模型：**ISNet general-use**（rembg 同款权重，178MB，Apache-2.0）。
 模型文件在项目根的 `.models/`（不入 git），下载方式见 README「衣橱换素材」。

 推理参数与 rembg 保持一致：RGB / 1024×1024 / mean 0.5 / std 1.0，
 输出取 `output_image`（1×1×1024×1024），归一化后取 0.5 为阈值。

 用法：
   python tools/matte-ai.py --src ../新衣 --out ../新衣/_cut
   python tools/matte-ai.py --src ../新衣 --out ../新衣/_cut --only 03
============================================================ """

import os
import sys
import argparse

import numpy as np
import cv2

CANVAS = 512
MODEL_SIZE = 1024
BOXES = {
    'top':    (0.88, 0.94),
    'bottom': (0.70, 0.92),
    'shoes':  (0.88, 0.58),
    'bag':    (0.80, 0.88),
    'glass':  (0.90, 0.42),
}
SLOT_OF = {'01': 'top', '02': 'top', '03': 'top', '04': 'bottom', '05': 'top'}
# 输出文件名直接用衣橱 id，build-wardrobe.py 的追加清单按同一套 key 取图
KEY_OF = {'01': 'w42', '02': 'w43', '03': 'w44', '04': 'w45', '05': 'w46'}

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MODEL = os.path.join(os.path.dirname(ROOT), '.models', 'isnet-general-use.onnx')


def imread_u(p):
    return cv2.imdecode(np.fromfile(p, dtype=np.uint8), cv2.IMREAD_COLOR)


def imwrite_u(p, img):
    ok, buf = cv2.imencode(os.path.splitext(p)[1] or '.png', img)
    if not ok:
        raise IOError('encode failed: %s' % p)
    buf.tofile(p)


def predict(sess, bgr):
    """返回与原图同尺寸的 0~255 alpha"""
    h, w = bgr.shape[:2]
    s = MODEL_SIZE / float(max(h, w))
    nw, nh = int(round(w * s)), int(round(h * s))
    resized = cv2.resize(bgr, (nw, nh), interpolation=cv2.INTER_AREA)
    canvas = np.zeros((MODEL_SIZE, MODEL_SIZE, 3), np.uint8)
    ox, oy = (MODEL_SIZE - nw) // 2, (MODEL_SIZE - nh) // 2
    canvas[oy:oy + nh, ox:ox + nw] = resized

    x = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    x = (x - 0.5) / 1.0
    x = np.transpose(x, (2, 0, 1))[None]

    out = sess.run(['output_image'], {'input_image': x})[0][0, 0]
    out = (out - out.min()) / max(1e-6, out.max() - out.min())
    m = (out[oy:oy + nh, ox:ox + nw] * 255).astype(np.uint8)
    return cv2.resize(m, (w, h), interpolation=cv2.INTER_LINEAR)


def clean(alpha, thresh=160, min_area=0.008):
    """阈值 → 去小碎块 → 补内部小洞 → 按画幅比例收缩（去「衣服与床单混色」的绿边）→ 羽化"""
    m = np.where(alpha > thresh, 255, 0).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))

    h, w = m.shape
    n, lb, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    if n > 1:
        keep = np.zeros_like(m)
        for i in range(1, n):
            if stats[i, cv2.CC_STAT_AREA] >= min_area * w * h:
                keep[lb == i] = 255
        m = keep

    ff = m.copy()
    m2 = np.zeros((h + 2, w + 2), np.uint8)
    cv2.floodFill(ff, m2, (0, 0), 255)
    m = cv2.bitwise_or(m, cv2.bitwise_not(ff))

    # 混色边宽度随画幅走：2132px 的原图上「1px 腐蚀」等于没做，
    # 牛仔裤那圈绿边就是这么留下来的。
    # 混色边实测宽 8~12px（2132px 原图）—— JPEG 色度下采样会把床单的薄荷色
    # 渗进衣服边缘两三个像素，缩到 512 卡片上就是一整圈绿边。
    k = max(7, int(round(w / 150.0)))
    if k % 2 == 0:
        k += 1
    m = cv2.erode(m, np.ones((k, k), np.uint8))
    # ⚠ 不要把模型的高置信 alpha 再 max 回来 —— 那会把刚腐蚀掉的
    # 「衣服与床单混色」的绿边原样复活（牛仔裤实测踩过）。
    return cv2.GaussianBlur(m, (0, 0), max(0.8, k * 0.45))


# ------------------------------------------------------------
# 备选通道：种子点 GrabCut（浅灰针织衫那种「衣服与床单同色」的，模型会判错）
# ------------------------------------------------------------
SEEDS = {
    '03': {
        'bg': [(0.03, 0.25), (0.05, 0.60), (0.50, 0.955), (0.95, 0.25),
               (0.95, 0.62), (0.02, 0.04), (0.97, 0.04), (0.12, 0.95)],
        'fg': [(0.48, 0.35), (0.30, 0.55), (0.66, 0.55), (0.48, 0.80)],
    },
}


def grabcut_alpha(bgr, spec, work_w=1000, iters=8):
    h, w = bgr.shape[:2]
    sc = min(1.0, work_w / float(w))
    sw, sh = int(w * sc), int(h * sc)
    small = cv2.resize(bgr, (sw, sh), interpolation=cv2.INTER_AREA)

    band = max(6, int(round(min(sw, sh) * 0.02)))
    gc = np.full((sh, sw), cv2.GC_PR_BGD, np.uint8)
    gc[int(sh * .10):int(sh * .90), int(sw * .10):int(sw * .90)] = cv2.GC_PR_FGD
    gc[:band, :] = cv2.GC_BGD
    gc[-band:, :] = cv2.GC_BGD
    gc[:, :band] = cv2.GC_BGD
    gc[:, -band:] = cv2.GC_BGD
    r = max(8, int(min(sw, sh) * 0.022))
    for (x, y) in spec['bg']:
        cv2.circle(gc, (int(x * sw), int(y * sh)), r, cv2.GC_BGD, -1)
    for (x, y) in spec['fg']:
        cv2.circle(gc, (int(x * sw), int(y * sh)), int(r * 1.2), cv2.GC_FGD, -1)

    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    cv2.grabCut(small, gc, None, bgd, fgd, iters, cv2.GC_INIT_WITH_MASK)

    fg = np.where((gc == cv2.GC_FGD) | (gc == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    # ⚠ 顺序：闭运算补缺口 → 色板剔花 → 取最大块。
    #   反过来（先剔花再闭运算）会把刚剔掉的花又桥接回来，正面反复修不掉。
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((21, 21), np.uint8))

    # 先用「本体色板」把贴边的花剔掉 —— 花与衣服色差极大，
    # 但闭运算补缺口时又会把它们连回来，所以色板要在这里先过一遍。
    lab = cv2.cvtColor(small, cv2.COLOR_BGR2LAB).astype(np.float32)
    cy0, cy1 = int(sh * 0.30), int(sh * 0.70)
    cx0, cx1 = int(sw * 0.30), int(sw * 0.70)
    core = (cv2.erode(fg, np.ones((45, 45), np.uint8)) > 127)
    core[:cy0] = False
    core[cy1:] = False
    core[:, :cx0] = False
    core[:, cx1:] = False
    if core.sum() > 500:
        pts = lab[core]
        crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 0.5)
        _, lb2, cen = cv2.kmeans(pts, 4, None, crit, 3, cv2.KMEANS_PP_CENTERS)
        cnt = np.bincount(lb2.flatten(), minlength=len(cen))
        cen = cen[cnt >= 0.05 * len(pts)]
        d = np.min(np.stack([np.linalg.norm(lab - c.reshape(1, 1, 3), axis=2) for c in cen]), axis=0)
        fg = np.where(d < 34, fg, 0).astype(np.uint8)

    # 只留最大一块
    n, lb, stats, cent = cv2.connectedComponentsWithStats(fg, 8)
    if n > 1:
        best = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        fg = np.where(lb == best, 255, 0).astype(np.uint8)

    # 补洞（衣服内部的暗部）
    ff = fg.copy()
    m2 = np.zeros((sh + 2, sw + 2), np.uint8)
    cv2.floodFill(ff, m2, (0, 0), 255)
    holes = cv2.bitwise_not(ff)
    if holes.any():
        nh, hl, hstats, _ = cv2.connectedComponentsWithStats(holes, 8)
        for i in range(1, nh):
            if hstats[i, cv2.CC_STAT_AREA] > 0.02 * sw * sh:
                continue
            fg = np.where(hl == i, 255, fg).astype(np.uint8)

    k = max(3, int(round(sw / 380.0)))
    if k % 2 == 0:
        k += 1
    fg = cv2.erode(fg, np.ones((k, k), np.uint8))
    soft = cv2.GaussianBlur(fg, (0, 0), max(0.8, k * 0.45))
    return cv2.resize(soft, (w, h), interpolation=cv2.INTER_LINEAR)


# 手工轮廓：浅灰针织衫与浅薄荷床单在 Lab 里只差 ~30，模型与阈值都判不准，
# 直接给一圈近似的衣形多边形当「必然前景 / 必然背景」，再让 GrabCut 贴边精修。
POLY = {
    '03': [(0.330, 0.042), (0.400, 0.032), (0.500, 0.028), (0.600, 0.032),
           (0.665, 0.046), (0.705, 0.086), (0.758, 0.160), (0.792, 0.300),
           (0.806, 0.500), (0.800, 0.660), (0.800, 0.800), (0.752, 0.886),
           (0.620, 0.906), (0.500, 0.912), (0.380, 0.906), (0.262, 0.886),
           (0.202, 0.800), (0.176, 0.660), (0.168, 0.500), (0.176, 0.320),
           (0.202, 0.180), (0.244, 0.090), (0.292, 0.050)],
}


def polygon_alpha(bgr, pts, work_w=1000, iters=8, dist_t=46):
    h, w = bgr.shape[:2]
    sc = min(1.0, work_w / float(w))
    sw, sh = int(w * sc), int(h * sc)
    small = cv2.resize(bgr, (sw, sh), interpolation=cv2.INTER_AREA)
    poly = np.array([[int(x * sw), int(y * sh)] for (x, y) in pts], np.int32)

    gc = np.full((sh, sw), cv2.GC_BGD, np.uint8)
    cv2.fillPoly(gc, [poly], cv2.GC_PR_FGD)
    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    cv2.grabCut(small, gc, None, bgd, fgd, iters, cv2.GC_INIT_WITH_MASK)

    fg = np.where((gc == cv2.GC_FGD) | (gc == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))

    # 色板收紧：把 GrabCut 贴着轮廓吃进来的床单一角剔掉
    lab = cv2.cvtColor(small, cv2.COLOR_BGR2LAB).astype(np.float32)
    core = cv2.erode(fg, np.ones((41, 41), np.uint8)) > 127
    if core.sum() > 500:
        pts_lab = lab[core]
        crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 0.5)
        _, lb2, cen = cv2.kmeans(pts_lab, 4, None, crit, 3, cv2.KMEANS_PP_CENTERS)
        cnt = np.bincount(lb2.flatten(), minlength=len(cen))
        cen = cen[cnt >= 0.05 * len(pts_lab)]
        d = np.min(np.stack([np.linalg.norm(lab - c.reshape(1, 1, 3), axis=2) for c in cen]), axis=0)
        fg = np.where(d < dist_t, fg, 0).astype(np.uint8)

    n, lb, stats, _ = cv2.connectedComponentsWithStats(fg, 8)
    if n > 1:
        best = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        fg = np.where(lb == best, 255, 0).astype(np.uint8)

    ff = fg.copy()
    m2 = np.zeros((sh + 2, sw + 2), np.uint8)
    cv2.floodFill(ff, m2, (0, 0), 255)
    holes = cv2.bitwise_not(ff)
    if holes.any():
        nh, hl, hstats, _ = cv2.connectedComponentsWithStats(holes, 8)
        for i in range(1, nh):
            if hstats[i, cv2.CC_STAT_AREA] > 0.02 * sw * sh:
                continue
            fg = np.where(hl == i, 255, fg).astype(np.uint8)

    k = max(3, int(round(sw / 420.0)))
    if k % 2 == 0:
        k += 1
    fg = cv2.erode(fg, np.ones((k, k), np.uint8))
    soft = cv2.GaussianBlur(fg, (0, 0), max(0.8, k * 0.45))
    return cv2.resize(soft, (w, h), interpolation=cv2.INTER_LINEAR)


def normalize(rgba, slot):
    a = rgba[:, :, 3]
    ys, xs = np.where(a > 12)
    if len(xs) == 0:
        return None, None
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    cut = rgba[y0:y1, x0:x1]
    ch, cw = cut.shape[:2]
    tw, th = BOXES.get(slot, BOXES['top'])
    s = min(tw * CANVAS / float(cw), th * CANVAS / float(ch))
    nw, nh = max(1, int(round(cw * s))), max(1, int(round(ch * s)))
    cut = cv2.resize(cut, (nw, nh), interpolation=cv2.INTER_AREA)
    out = np.zeros((CANVAS, CANVAS, 4), np.uint8)
    out[(CANVAS - nh) // 2:(CANVAS - nh) // 2 + nh,
        (CANVAS - nw) // 2:(CANVAS - nw) // 2 + nw] = cut
    return out, (cw, ch, s)


def main():
    import onnxruntime as ort

    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--only', default='')
    args = ap.parse_args()

    if not os.path.exists(MODEL):
        print('! 缺模型：%s' % MODEL)
        print('  下载（GitHub API 通道）：')
        print('  curl -sL -H "Authorization: token $(gh auth token)" -H "Accept: application/octet-stream" \\')
        print('    "https://api.github.com/repos/danielgatis/rembg/releases/assets/101375543" \\')
        print('    -o ".models/isnet-general-use.onnx"')
        sys.exit(1)

    sess = ort.InferenceSession(MODEL, providers=['CPUExecutionProvider'])
    src, out = os.path.abspath(args.src), os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)
    only = [x.strip() for x in args.only.split(',') if x.strip()]

    files = sorted(f for f in os.listdir(src)
                   if f.lower().endswith(('.jpg', '.jpeg', '.png')) and not f.startswith('_'))
    for f in files:
        key = f[:2]
        if only and key not in only:
            continue
        bgr = imread_u(os.path.join(src, f))
        if bgr is None:
            print('! 读不出来：%s' % f)
            continue
        if key in POLY:
            alpha = polygon_alpha(bgr, POLY[key])
            chan = 'polygon'
        elif key in SEEDS:
            alpha = grabcut_alpha(bgr, SEEDS[key])
            chan = 'grabcut'
        else:
            alpha = clean(predict(sess, bgr))
            chan = 'isnet'
        print('  · 通道 %s' % chan)
        rgba = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGBA)
        rgba[:, :, 3] = alpha
        img, info = normalize(rgba, SLOT_OF.get(key, 'top'))
        if img is None:
            print('! %s 抠完是空的' % f)
            continue
        base = KEY_OF.get(key, os.path.splitext(f)[0])
        imwrite_u(os.path.join(out, base + '.png'), img)
        a3 = (img[:, :, 3:4] / 255.0)
        comp = (cv2.cvtColor(img, cv2.COLOR_RGBA2BGR) * a3 + 55 * (1 - a3)).astype(np.uint8)
        imwrite_u(os.path.join(out, base + '-check.png'), comp)
        print('✓ %-12s 主体 %4dx%-4d 缩放 %.2f 画布占比 %.1f%%'
              % (base, info[0], info[1], info[2], 100.0 * (img[:, :, 3] > 12).mean()))


if __name__ == '__main__':
    main()
