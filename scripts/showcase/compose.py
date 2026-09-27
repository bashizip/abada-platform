"""Composes recorded takes into the final showcase video.

Camera, cursor and click effects are rendered here at the output frame rate
from the timeline written by record.mjs, so they stay smooth regardless of the
capture rate. Output frames are piped to ffmpeg.

Usage: python compose.py <takeDir> <cardsDir> <out.mp4>
"""
import bisect
import json
import math
import os
import subprocess
import sys

import cv2
import numpy as np

TAKE, CARDS, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
FPS = 60
W, H = 1920, 1080
# The captured screen sits in a window above the caption strip.
WIN_X, WIN_Y, WIN_W, WIN_H = 176, 34, 1568, 882
RADIUS = 14
CAM_DUR = 0.95       # seconds for a camera move
MAX_ZOOM = 2.1
FADE = 0.35          # caption fade
XFADE = 0.45         # segment cross-dissolve
EMERALD = (153, 211, 52)  # BGR


def ease(t):
    t = min(1.0, max(0.0, t))
    return 4 * t ** 3 if t < 0.5 else 1 - pow(-2 * t + 2, 3) / 2


def smooth(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def load_rgba(path):
    return cv2.imread(path, cv2.IMREAD_UNCHANGED)


# ---------------------------------------------------------------- static layers
background = cv2.imread(os.path.join(CARDS, 'background.png'))
intro = cv2.imread(os.path.join(CARDS, 'intro.png'))
outro = cv2.imread(os.path.join(CARDS, 'outro.png'))
captions = json.load(open(os.path.join(CARDS, 'captions.json')))
caption_layers = []
for i in range(len(captions)):
    img = load_rgba(os.path.join(CARDS, f'caption-{i}.png'))
    caption_layers.append((img[:, :, :3].astype(np.float32), img[:, :, 3:4].astype(np.float32) / 255))

# Rounded window mask and soft drop shadow.
mask = np.zeros((WIN_H, WIN_W), np.uint8)
cv2.rectangle(mask, (RADIUS, 0), (WIN_W - RADIUS, WIN_H), 255, -1)
cv2.rectangle(mask, (0, RADIUS), (WIN_W, WIN_H - RADIUS), 255, -1)
for cx, cy in [(RADIUS, RADIUS), (WIN_W - RADIUS - 1, RADIUS), (RADIUS, WIN_H - RADIUS - 1), (WIN_W - RADIUS - 1, WIN_H - RADIUS - 1)]:
    cv2.circle(mask, (cx, cy), RADIUS, 255, -1, cv2.LINE_AA)
win_alpha = (mask.astype(np.float32) / 255)[:, :, None]
shadow = np.zeros((H, W), np.float32)
shadow[WIN_Y + 18:WIN_Y + WIN_H + 18, WIN_X:WIN_X + WIN_W] = mask / 255
shadow = cv2.GaussianBlur(shadow, (0, 0), 28) * 0.75
stage = (background.astype(np.float32) * (1 - shadow[:, :, None])).astype(np.float32)
border = np.zeros((WIN_H, WIN_W), np.uint8)
cv2.drawContours(border, cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[0], -1, 255, 1, cv2.LINE_AA)
border_alpha = (border.astype(np.float32) / 255 * 0.14)[:, :, None]


def make_cursor(scale=4):
    """macOS-style arrow, rendered large for clean downsampling."""
    pts = np.array([[0, 0], [0, 17], [4.2, 13.2], [7, 19.6], [9.6, 18.5], [6.9, 12.3], [12.3, 12.3]], np.float32)
    s = 2.2 * scale
    pad = 6 * scale
    size = int(26 * s)
    p = (pts * s + pad).astype(np.int32)
    # Soft drop shadow below the arrow.
    shadow = np.zeros((size, size), np.uint8)
    cv2.fillPoly(shadow, [p + np.int32([0, 2 * scale])], 110, cv2.LINE_AA)
    shadow = cv2.GaussianBlur(shadow, (0, 0), 3 * scale)
    # White outline around a dark body.
    outline = np.zeros((size, size), np.uint8)
    cv2.fillPoly(outline, [p], 255, cv2.LINE_AA)
    cv2.polylines(outline, [p], True, 255, int(2.6 * scale), cv2.LINE_AA)
    inner = np.zeros((size, size), np.uint8)
    cv2.fillPoly(inner, [p], 255, cv2.LINE_AA)
    inner = cv2.erode(inner, np.ones((int(1.6 * scale), int(1.6 * scale)), np.uint8))
    body = (inner.astype(np.float32) / 255)[:, :, None]
    color = 255 * (1 - body) + 14 * body
    color[outline == 0] = 0
    img = np.zeros((size, size, 4), np.uint8)
    img[:, :, :3] = color.astype(np.uint8)
    img[:, :, 3] = np.maximum(shadow, outline)
    return img, pad  # hotspot at (pad, pad)


CURSOR_IMG, CURSOR_HOT = make_cursor()
CURSOR_SCALE = 4


def draw_cursor(frame, x, y, size=1.0):
    k = size / CURSOR_SCALE * 1.05
    M = np.float32([[k, 0, x - CURSOR_HOT * k], [0, k, y - CURSOR_HOT * k]])
    w = int(CURSOR_IMG.shape[1] * k) + 4
    h = int(CURSOR_IMG.shape[0] * k) + 4
    x0, y0 = int(x - CURSOR_HOT * k) - 2, int(y - CURSOR_HOT * k) - 2
    M[0, 2] -= x0
    M[1, 2] -= y0
    spr = cv2.warpAffine(CURSOR_IMG, M, (w, h), flags=cv2.INTER_AREA if k < 1 else cv2.INTER_LINEAR)
    fx0, fy0, fx1, fy1 = max(WIN_X, x0), max(WIN_Y, y0), min(WIN_X + WIN_W, x0 + w), min(WIN_Y + WIN_H, y0 + h)
    if fx1 <= fx0 or fy1 <= fy0:
        return
    s = spr[fy0 - y0:fy1 - y0, fx0 - x0:fx1 - x0].astype(np.float32)
    a = s[:, :, 3:4] / 255
    roi = frame[fy0:fy1, fx0:fx1]
    roi[:] = roi * (1 - a) + s[:, :, :3] * a


def draw_ripple(frame, x, y, age):
    d = 0.5
    if age < 0 or age > d:
        return
    p = age / d
    r = 10 + 30 * ease(p)
    alpha = 0.55 * (1 - p)
    pad = int(r + 6)
    x0, y0 = int(x) - pad, int(y) - pad
    size = 2 * pad
    layer = np.zeros((size * 4, size * 4), np.uint8)
    cv2.circle(layer, (int((x - x0) * 4), int((y - y0) * 4)), int(r * 4), 255, 10, cv2.LINE_AA)
    cv2.circle(layer, (int((x - x0) * 4), int((y - y0) * 4)), int(r * 4 * 0.9), 70, -1, cv2.LINE_AA)
    layer = cv2.resize(layer, (size, size), interpolation=cv2.INTER_AREA).astype(np.float32) / 255 * alpha
    fx0, fy0, fx1, fy1 = max(WIN_X, x0), max(WIN_Y, y0), min(WIN_X + WIN_W, x0 + size), min(WIN_Y + WIN_H, y0 + size)
    if fx1 <= fx0 or fy1 <= fy0:
        return
    a = layer[fy0 - y0:fy1 - y0, fx0 - x0:fx1 - x0, None]
    roi = frame[fy0:fy1, fx0:fx1]
    roi[:] = roi * (1 - a) + np.float32(EMERALD) * a


# ---------------------------------------------------------------- takes
class Take:
    def __init__(self, name):
        self.dir = os.path.join(TAKE, name)
        d = json.load(open(os.path.join(self.dir, 'timeline.json')))
        self.vw, self.vh = d['viewport']['width'], d['viewport']['height']
        self.frames = d['frames']
        self.ft = [f['t'] for f in self.frames]
        ev = d['events']
        self.marks = {e['label']: e['t'] for e in ev if e['kind'] == 'mark'}
        cur = [e for e in ev if e['kind'] == 'cursor']
        self.ct = [e['t'] for e in cur]
        self.cxy = [(e['x'], e['y']) for e in cur]
        self.clicks = [e for e in ev if e['kind'] == 'click']
        self.speeds = [(e['t'], e['v']) for e in ev if e['kind'] == 'speed']
        self.captions = [e for e in ev if e['kind'] == 'caption']
        self.cam_events = [e for e in ev if e['kind'] == 'camera']
        self._cache_i, self._cache_img = -1, None
        self._build_camera()

    def full(self):
        return (self.vw / 2, self.vh / 2, self.vw)

    def normalize(self, rect):
        x, y, w, h = rect['x'], rect['y'], rect['w'], rect['h']
        aspect = self.vw / self.vh
        if w / h < aspect:
            w = h * aspect
        w = min(self.vw, max(self.vw / MAX_ZOOM, w))
        h = w / aspect
        cx = min(self.vw - w / 2, max(w / 2, x + rect['w'] / 2))
        cy = min(self.vh - h / 2, max(h / 2, y + rect['h'] / 2))
        return (cx, cy, w)

    def _build_camera(self):
        self.cam_moves = []  # (t0, from, to)
        for e in self.cam_events:
            target = self.full() if e.get('full') else self.normalize(e['rect'])
            start = self.camera_at(e['t'])
            self.cam_moves.append((e['t'], start, target))

    def camera_at(self, t):
        state = self.full()
        for t0, a, b in self.cam_moves:
            if t < t0:
                break
            k = ease((t - t0) / CAM_DUR)
            aw, bw = math.log(a[2]), math.log(b[2])
            state = (a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, math.exp(aw + (bw - aw) * k))
        return state

    def speed_at(self, t):
        v, prev_v, t_change = 1.0, 1.0, -1e9
        for ts, sv in self.speeds:
            if ts > t:
                break
            prev_v, v, t_change = v, sv, ts
        k = smooth((t - t_change) / 0.4)
        return prev_v + (v - prev_v) * k

    def cursor_at(self, t):
        i = bisect.bisect_right(self.ct, t)
        if i == 0:
            return self.cxy[0] if self.cxy else (self.vw / 2, self.vh / 2)
        if i >= len(self.ct):
            return self.cxy[-1]
        t0, t1 = self.ct[i - 1], self.ct[i]
        k = (t - t0) / (t1 - t0) if t1 > t0 else 1
        (x0, y0), (x1, y1) = self.cxy[i - 1], self.cxy[i]
        return (x0 + (x1 - x0) * k, y0 + (y1 - y0) * k)

    def frame_at(self, t):
        i = max(0, bisect.bisect_right(self.ft, t) - 1)
        if i != self._cache_i:
            self._cache_img = cv2.imread(os.path.join(self.dir, self.frames[i]['file']))
            self._cache_i = i
        return self._cache_img

    def caption_state(self, t):
        """(index, opacity) of the caption visible at t."""
        cur, t_on, t_off = None, None, None
        for e in self.captions:
            if e['t'] > t:
                break
            if e.get('off'):
                if cur is not None:
                    t_off = e['t']
            else:
                cur, t_on, t_off = e, e['t'], None
        if cur is None:
            return None, 0
        idx = next(i for i, c in enumerate(captions) if c['text'] == cur['text'])
        if t_off is not None:
            op = 1 - smooth((t - t_off) / FADE)
        else:
            op = smooth((t - t_on) / FADE)
        return idx, op

    def times(self, start, end):
        t = self.marks[start]
        end_t = self.marks[end]
        out = []
        while t < end_t:
            out.append(t)
            t += self.speed_at(t) / FPS
        return out


def render_screen(take, t):
    src = take.frame_at(t)
    sh, sw = src.shape[:2]
    dpr = sw / take.vw
    cx, cy, cw = take.camera_at(t)
    k = WIN_W / (cw * dpr)                    # source px -> window px
    x0 = (cx - cw / 2) * dpr
    y0 = (cy - cw * take.vh / take.vw / 2) * dpr
    if k < 1:
        small = cv2.resize(src, (round(sw * k), round(sh * k)), interpolation=cv2.INTER_AREA)
        kx = small.shape[1] / sw
        M = np.float32([[k / kx, 0, -x0 * k], [0, k / kx, -y0 * k]])
        win = cv2.warpAffine(small, M, (WIN_W, WIN_H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    else:
        M = np.float32([[k, 0, -x0 * k], [0, k, -y0 * k]])
        win = cv2.warpAffine(src, M, (WIN_W, WIN_H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    frame = stage.copy()
    roi = frame[WIN_Y:WIN_Y + WIN_H, WIN_X:WIN_X + WIN_W]
    roi[:] = roi * (1 - win_alpha) + win.astype(np.float32) * win_alpha
    roi[:] = roi * (1 - border_alpha) + 255 * border_alpha
    # Cursor and click ripple, mapped through the camera.
    css_to_out = WIN_W / cw
    ox = WIN_X - (cx - cw / 2) * css_to_out
    oy = WIN_Y - (cy - cw * take.vh / take.vw / 2) * css_to_out
    zoom = take.vw / cw
    for c in take.clicks:
        draw_ripple(frame, ox + c['x'] * css_to_out, oy + c['y'] * css_to_out, t - c['t'])
    px, py = take.cursor_at(t)
    press = min((abs(t - c['t']) for c in take.clicks), default=9)
    dip = 1 - 0.14 * max(0, 1 - press / 0.12)
    draw_cursor(frame, ox + px * css_to_out, oy + py * css_to_out, (0.95 + 0.18 * (zoom - 1)) * dip)
    idx, op = take.caption_state(t)
    if idx is not None and op > 0:
        rgb, a = caption_layers[idx]
        a = a * op
        shift = int(round((1 - op) * 10))
        cap = np.roll(rgb, shift, axis=0)
        a = np.roll(a, shift, axis=0)
        frame[:] = frame * (1 - a) + cap * a
    return frame


# ---------------------------------------------------------------- edit
takes = {n: Take(n) for n in ('alice', 'bob')}
EDL = [
    ('card', intro, 2.6),
    ('rec', 'alice', 's1', 'e1'),
    ('rec', 'bob', 's2', 'e2'),
    ('rec', 'alice', 's3', 'e3'),
    ('card', outro, 3.6),
]

ff = subprocess.Popen([
    'ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-tune', 'animation',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-movflags', '+faststart', OUT], stdin=subprocess.PIPE)

prev_last = None
count = 0
for seg in EDL:
    if seg[0] == 'card':
        gen = (seg[1].astype(np.float32) for _ in range(int(seg[2] * FPS)))
    else:
        take = takes[seg[1]]
        gen = (render_screen(take, t) for t in take.times(seg[2], seg[3]))
    n_x = int(XFADE * FPS)
    last = None
    for i, frame in enumerate(gen):
        if prev_last is not None and i < n_x:
            k = smooth((i + 1) / (n_x + 1))
            frame = prev_last * (1 - k) + frame * k
        out = np.clip(frame, 0, 255).astype(np.uint8)
        ff.stdin.write(out.tobytes())
        last = frame
        count += 1
        if count % 300 == 0:
            print(f'{count / FPS:.1f}s rendered', flush=True)
    prev_last = last
ff.stdin.close()
ff.wait()
print(f'done: {count} frames, {count / FPS:.1f}s -> {OUT}')
