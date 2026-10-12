#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
生成「安卓版扫码下载」卡片 qr-apk-download.png（工作区根）。

铁律：
  * 二维码指向固定 tag `android-latest` + 固定文件名 `GameLife.apk`
    → 链接永久有效、永远指向最新版，出新包不用换码。
  * 卡片上印的「版本号 / 体积」是静态文字，会随发版过期 —— 所以本脚本
    默认从 GitHub API 拉**当前 android-latest 的真实资产**，不写死。
  * 生成后必须用 pyzbar 从「最终 PNG」把码解回来比对 URL（--verify-only 或默认都做）。
  * 二维码 1:1 贴入白卡，不做缩放（缩放会让码静默失效，肉眼看不出来）。

用法：
    python tools/gen-qr-apk.py                 # 自动拉版本/体积，重绘卡片
    python tools/gen-qr-apk.py --size 5.4MB    # 离线时手工指定体积
    python tools/gen-qr-apk.py --check         # 只解码现有 PNG 校验，不重绘
"""
import argparse
import io
import json
import os
import sys
import urllib.request

import qrcode
from PIL import Image, ImageDraw, ImageFont
from pyzbar.pyzbar import decode as qr_decode

# ---- 常量 ----------------------------------------------------------------
APK_URL = ("https://github.com/zhangjunzhe349-coder/game-life"
           "/releases/download/android-latest/GameLife.apk")
API_URL = ("https://api.github.com/repos/zhangjunzhe349-coder/game-life"
           "/releases/tags/android-latest")

# 工作区根（本脚本在 game-life/tools/ 下 → 上溯两级）
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "..", "qr-apk-download.png"))

W, H = 900, 1372
BG = (8, 9, 13)
SIGNAL = (60, 232, 176)      # #3ce8b0 顶线与副标题
TXT = (233, 237, 246)        # #e9edf6 主文字
DIM = (146, 156, 180)        # #929cb4 次级文字
FAINT = (110, 118, 138)      # 脚注
AMBER = (255, 194, 75)       # #ffc24b 提醒
RULE = (42, 47, 61)          # 分隔线
PACKAGE = "com.jayzen.gamelife"

FONT_REG = "C:/Windows/Fonts/msyh.ttc"
FONT_BOLD = "C:/Windows/Fonts/msyhbd.ttc"


def font(bold: bool, size: int):
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size)


def centered(draw, y, text, f, fill):
    """按真实像素宽度居中绘制一行，y 为这行的顶部。"""
    w = draw.textbbox((0, 0), text, font=f)[2]
    draw.text(((W - w) // 2, y), text, font=f, fill=fill)


def fetch_latest():
    """从 GitHub API 取 android-latest 的版本名与资产体积；失败返回 (None, None)。"""
    try:
        req = urllib.request.Request(API_URL, headers={"User-Agent": "gen-qr"})
        tok = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
        if tok:
            req.add_header("Authorization", f"token {tok}")
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.load(r)
        ver = None
        for src in (data.get("name") or "", data.get("body") or ""):
            for part in src.replace("·", " ").replace("\n", " ").split():
                if part.lower().startswith("v") and part[1:2].isdigit():
                    ver = part
                    break
            if ver:
                break
        assets = {a["name"]: a["size"] for a in data.get("assets", [])}
        size = assets.get("GameLife.apk")
        return ver, size
    except Exception as e:  # noqa: BLE001
        print(f"[warn] 拉取 GitHub 失败：{e}", file=sys.stderr)
        return None, None


def human_mb(nbytes):
    """与卡片既有口径一致，按 MiB 取一位小数。"""
    return f"{nbytes / 1048576:.1f} MB"


def build(ver_text, size_text):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    # 顶部信号线
    d.rectangle([0, 0, W, 6], fill=SIGNAL)

    # 标题区
    centered(d, 88, "GAME LIFE", font(True, 76), TXT)
    centered(d, 190, "安卓版 · 扫码下载安装包", font(False, 31), SIGNAL)
    d.line([96, 258, W - 96, 258], fill=RULE, width=1)

    # 二维码（1:1，不缩放）
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_Q, border=3)
    qr.add_data(APK_URL)
    qr.make(fit=True)
    total_modules = qr.modules_count + 2 * qr.border
    box = max(1, (708 - 96) // total_modules)
    qr.box_size = box
    qr_img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    qs = qr_img.size[0]

    card_w, card_h = qs + 96, qs + 96
    cx0, cy0 = (W - card_w) // 2, 300
    d.rounded_rectangle([cx0, cy0, cx0 + card_w, cy0 + card_h], radius=30, fill=(255, 255, 255))
    img.paste(qr_img, (cx0 + 48, cy0 + 48))

    y = cy0 + card_h + 46
    centered(d, y, f"Game Life · {ver_text}", font(True, 35), TXT)
    y += 56
    centered(d, y, f"{size_text} · 安卓 7.0 及以上 · 完全离线可用", font(False, 28), DIM)
    y += 42
    centered(d, y, f"包名 {PACKAGE} · 签名固定", font(False, 28), DIM)
    y += 44
    centered(d, y, "装过旧版可直接覆盖升级，数据不丢", font(False, 28), AMBER)

    y += 58
    d.line([96, y, W - 96, y], fill=RULE, width=1)
    y += 26
    for line in (
        "扫码后选「用浏览器打开」→ 点下载 → 安装时允许「未知来源」",
        "提示无法下载 = 手机连不上 GitHub，可改用电脑下载后传手机",
        "此码固定指向最新版，以后更新扫同一张即可",
    ):
        centered(d, y, line, font(False, 23), FAINT)
        y += 34

    img.save(OUT)
    return qs, box


def verify():
    found = [x.data.decode("utf-8") for x in qr_decode(Image.open(OUT))]
    ok = found == [APK_URL]
    print(f"[verify] 解码结果 = {found}")
    print(f"[verify] 目标 URL  = {APK_URL}")
    print("[verify] " + ("OK 码与链接一致" if ok else "!! 不一致，重绘失败"))
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只解码现有 PNG，不重绘")
    ap.add_argument("--size", help="离线时手工指定体积，如 5.4MB")
    ap.add_argument("--version", help="离线时手工指定版本，如 v1.9.0")
    a = ap.parse_args()

    if a.check:
        sys.exit(0 if verify() else 1)

    ver, nbytes = fetch_latest()
    ver_text = a.version or ver or "v1.9.0"
    if a.size:
        size_text = a.size
    elif nbytes:
        size_text = human_mb(nbytes)
    else:
        size_text = "5.4 MB"

    qs, box = build(ver_text, size_text)
    print(f"[build] 版本 {ver_text} · 体积 {size_text} · 二维码 {qs}px（box={box}，1:1 无缩放）")
    print(f"[build] 已写出 {OUT}")
    sys.exit(0 if verify() else 1)


if __name__ == "__main__":
    main()
