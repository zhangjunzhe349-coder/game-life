#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
生成「安卓版扫码下载」卡片 qr-apk-download.png（工作区根）。

铁律：
  * 二维码指向固定 tag `android-latest` + 固定文件名 `GameLife.apk`
    → 链接永久有效、永远指向最新版，出新包不用换码。
  * 卡片上印的「版本号 / 体积」是静态文字，会随发版过期 —— 所以本脚本
    默认从 GitHub API 拉**当前 android-latest 的真实资产**，不写死。
  * 生成时把版本 / 体积 / sha256 写进 **PNG 的 tEXt 块**（`gamelife.version` 等），
    于是图片自己就能回答「我是按哪个版本画的」`--check` 拿它跟线上对账，
    不一致直接退出码 1 —— 这就是「卡片会不会又印成旧版」的自动闸门。
  * 二维码 1:1 贴入白卡，不做缩放（缩放会让码静默失效，肉眼看不出来）。

用法：
    python tools/gen-qr-apk.py                 # 自动拉版本/体积，重绘卡片
    python tools/gen-qr-apk.py --check         # 码 + 卡片版本 vs 线上，全部对账
    python tools/gen-qr-apk.py --size 5.4MB    # 离线时手工指定体积
    python tools/gen-qr-apk.py --version v1.10.1 --size 5.4MB   # 完全离线重绘
"""
import argparse
import datetime
import json
import os
import re
import sys
import urllib.request

import qrcode
from PIL import Image, ImageDraw, ImageFont
from PIL.PngImagePlugin import PngInfo
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

# PNG tEXt 键名（不要带空格/非 Latin 字符，tEXt 只保证 Latin-1）
META_VER = "gamelife.version"
META_SIZE = "gamelife.apk.bytes"
META_SHA = "gamelife.apk.sha256"
META_AT = "gamelife.generated_at"


def font(bold: bool, size: int):
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size)


def centered(draw, y, text, f, fill):
    """按真实像素宽度居中绘制一行，y 为这行的顶部。"""
    w = draw.textbbox((0, 0), text, font=f)[2]
    draw.text(((W - w) // 2, y), text, font=f, fill=fill)


def fetch_latest():
    """从 GitHub API 取 android-latest 的真实资产信息；失败返回 None。"""
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
        apk = next((a for a in data.get("assets", [])
                    if a.get("name") == "GameLife.apk"), {})
        digest = (apk.get("digest") or "").replace("sha256:", "") or None
        return {"version": ver, "size": apk.get("size"), "sha256": digest}
    except Exception as e:  # noqa: BLE001
        print(f"[warn] 拉取 GitHub 失败：{e}", file=sys.stderr)
        return None


def human_mb(nbytes):
    """与卡片既有口径一致，按 MiB 取一位小数。"""
    return f"{nbytes / 1048576:.1f} MB"


def ver_tuple(s):
    """把 'v1.10.1' 拆成 (1, 10, 1)；非数字段直接丢，只用于比较大小。"""
    return tuple(int(x) for x in re.findall(r"\d+", str(s or "")))


def build(ver_text, size_text, meta):
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

    # 版本指纹写进 PNG 自身：图片自己记得是按哪个版本画的
    txt = PngInfo()
    txt.add_text(META_VER, str(meta.get("version") or ver_text).lstrip("v"))
    if meta.get("size"):
        txt.add_text(META_SIZE, str(meta["size"]))
    if meta.get("sha256"):
        txt.add_text(META_SHA, str(meta["sha256"]))
    txt.add_text(META_AT, datetime.date.today().isoformat())

    img.save(OUT, pnginfo=txt)
    return qs, box


def decode_url(path=None):
    found = [x.data.decode("utf-8") for x in qr_decode(Image.open(path or OUT))]
    return found


def verify(path=None):
    """只验码：解回来的 URL 必须与 APK_URL 逐字相同。"""
    found = decode_url(path)
    ok = found == [APK_URL]
    print(f"[verify] 解码结果 = {found}")
    print(f"[verify] 目标 URL  = {APK_URL}")
    print("[verify] " + ("OK 码与链接一致" if ok else "!! 不一致，重绘失败"))
    return ok


def card_meta(path=None):
    """读 PNG 里埋的版本指纹；老图没有则为空 dict。"""
    with Image.open(path or OUT) as im:
        info = dict(im.info)
    return {
        "version": info.get(META_VER),
        "size": info.get(META_SIZE),
        "sha256": info.get(META_SHA),
        "at": info.get(META_AT),
    }


def check(path=None):
    """三重对账：码解回来对不对 / 卡片版本是否等于线上 / 体积是否等于线上。"""
    path = path or OUT
    print(f"[check] 文件 = {path}")
    if not os.path.exists(path):
        print("[check] !! 文件不存在")
        return False

    ok = verify(path)
    meta = card_meta(path)
    live = fetch_latest()

    if meta.get("version"):
        print(f"[check] 卡片自述 v{meta['version']} · 生成于 {meta.get('at') or '?'} "
              f"（{meta.get('size') or '?'} B / sha256 {(meta.get('sha256') or '?')[:12]}…）")
    else:
        print("[check] !! 这张图没有版本指纹（老图），无法判断是否过期 → 请重跑重绘")

    if not live:
        print("[check] ?? 取不到线上信息，只能确认码本身正确；无法判断卡片是否过期")
        return ok

    live_ver = (live.get("version") or "").lstrip("v")
    print(f"[check] 线上   v{live_ver}（{live.get('size')} B / "
          f"sha256 {(live.get('sha256') or '?')[:12]}…）")

    if not meta.get("version"):
        return False

    same_ver = ver_tuple(meta["version"]) == ver_tuple(live_ver)
    same_size = str(meta.get("size")) == str(live.get("size"))
    same_sha = (meta.get("sha256") or "") == (live.get("sha256") or "")

    if same_ver and same_sha:
        print("[check] OK 卡片与线上一致（版本 + sha256）")
        return ok
    if same_ver and not same_sha:
        print("[check] OK 版本一致；sha256 不同（Release 被原地替换过，卡片文字仍准确）")
        return ok
    if not same_ver:
        print(f"[check] !! 卡片过期：图上印 v{meta['version']}，线上已是 v{live_ver}")
    if not same_size:
        print(f"[check] !! 体积不符：卡片 {meta.get('size')} B，线上 {live.get('size')} B")
    print("[check] → 重跑 `python tools/gen-qr-apk.py` 即可")
    return False


def main():
    global OUT
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只对账（码 + 卡片版本 vs 线上），不重绘")
    ap.add_argument("--size", help="离线时手工指定体积，如 5.4MB")
    ap.add_argument("--version", help="离线时手工指定版本，如 v1.10.1")
    ap.add_argument("--out", help="输出路径（默认工作区根 qr-apk-download.png）")
    a = ap.parse_args()

    if a.out:
        OUT = os.path.abspath(a.out)

    if a.check:
        sys.exit(0 if check() else 1)

    live = fetch_latest() or {}
    ver_text = a.version or live.get("version") or "v1.10.1"
    if a.size:
        size_text = a.size
    elif live.get("size"):
        size_text = human_mb(live["size"])
    else:
        size_text = "5.4 MB"

    qs, box = build(ver_text, size_text, {
        "version": ver_text, "size": live.get("size"), "sha256": live.get("sha256"),
    })
    print(f"[build] 版本 {ver_text} · 体积 {size_text} · 二维码 {qs}px（box={box}，1:1 无缩放）")
    print(f"[build] 已写出 {OUT}")
    sys.exit(0 if check() else 1)


if __name__ == "__main__":
    main()
