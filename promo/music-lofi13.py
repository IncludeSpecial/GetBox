"""Music for lofi13.html: lo-fi hip hop, 82 BPM, Fmaj7 – Em7 – Dm7 – Cmaj7.

Electric piano and vinyl from the start; typewriter clicks follow every typed line on
screen; the beat (swung, low-passed) enters when the first polaroid drops (8); pencil
ticks for the checklist (19–23); card flicks as the theme photos are dealt (33–37);
the drums stop for the ending (40) and the last chord rings out over the record.
The whole music bus wobbles slightly, like a worn tape.
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from synth import (Mix, SR, adsr, hat, hz, kick, lowpass, highpass, reverb, rng, sine, snare, tt, vinyl, write)  # noqa: E402

BPM = 82
B = 60 / BPM
DUR = 48 * B + 1.6
m = Mix(DUR)
keys = m.bus()
drums = m.bus()
fx = m.bus()

CHORDS = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]]  # Fmaj7 Em7 Dm7 Cmaj7
ROOTS = [41, 40, 38, 36]
SWING = 0.62   # where the off-beat sixteenth lands inside each eighth


def at(b):
    return b * B


def chord_idx(b):
    return int(b // 4) % 4


def ep(note, length, vel=1.0, decay=1.1):
    """Electric piano: FM tine over a soft sine, slow tremolo."""
    t = tt(length)
    f = hz(note)
    index = 1.6 * np.exp(-t * 7) * vel
    tone = np.sin(2 * np.pi * f * t + index * np.sin(2 * np.pi * f * t))
    tone += 0.25 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 3)
    env = (1 - np.exp(-t * 300)) * np.exp(-t * (decay + 0.002 * f))
    trem = 1 + 0.12 * np.sin(2 * np.pi * 4.2 * t)
    return tone * env * trem * vel


# --- chords: each bar played on 1 and pushed on the "and" of 2 ---
for bar in range(0, 48, 4):
    if bar >= 40:
        break
    ch = CHORDS[chord_idx(bar)]
    for k, (off, ln, vel) in enumerate(((0, 2.4, 0.9), (1.5 + (SWING - 0.5) * 0.5, 2.6, 0.6))):
        for j, n in enumerate(ch):
            keys.add(at(bar + off) + j * 0.012, ep(n, ln * B, vel), 0.13, pan=-0.3 + j * 0.2)
# Final chord: Fmaj9, rolled.
for j, n in enumerate((41, 53, 57, 60, 64, 67)):
    keys.add(at(40) + j * 0.05, ep(n, DUR - at(40), 0.9, decay=0.3), 0.17, pan=-0.3 + j * 0.12)

# --- a soft top line from the first polaroid on ---
MELODY = [(0, 76), (1, 72), (1.5, 74), (2.5, 72),
          (4, 74), (5, 71), (6, 67),
          (8, 72), (9, 69), (9.5, 72), (10.5, 74),
          (12, 71), (13, 67), (14.5, 64)]
for start in (16, 32):
    for off, n in MELODY:
        b = start + off
        if b < 40:
            keys.add(at(b), ep(n, 1.4 * B, 0.7), 0.09, pan=0.25)

# --- bass ---
for bar in range(8, 40, 4):
    root = ROOTS[chord_idx(bar)]
    for off, ln in ((0, 1.4), (1.5 + (SWING - 0.5) * 0.5, 0.4), (2, 1.6), (3.5, 0.4)):
        sig = sine(hz(root), ln * B) + 0.15 * sine(hz(root + 12), ln * B)
        keys.add(at(bar + off), sig * adsr(ln * B, 0.01, 0.3, 0.7, 0.05), 0.3)

# --- drums: swung, dusty ---
K = lowpass(kick(0.4, punch=70, low=52, decay=9, click=0.2), 3000)
S = lowpass(snare(0.28, tone=200, noise_decay=20, color=3500), 4500)


def swing_pos(i):
    """Sixteenth i of a beat (0–3) → beat offset with swing."""
    return (i // 2) * 0.5 + (SWING * 0.5 if i % 2 else 0)


for b in range(8, 40):
    bb = b % 4
    if bb == 0:
        drums.add(at(b), K, 0.75)
        drums.add(at(b + swing_pos(3)), K, 0.4)
    if bb == 2:
        drums.add(at(b + 0.5), K, 0.6)
    if bb in (1, 3):
        drums.add(at(b) + 0.012, S, 0.42)          # a touch late, laid back
    for i in range(4):
        vel = (0.09, 0.04, 0.07, 0.035)[i] * rng.uniform(0.8, 1.1)
        drums.add(at(b + swing_pos(i)), hat(0.05, decay=70, color=7000), vel, pan=0.2)
# The ending keeps a soft pulse while the last lines type out.
for b in range(40, 46):
    drums.add(at(b + 0.5), hat(0.04, decay=80, color=7000), 0.04, pan=0.2)
    if b % 2 == 0:
        drums.add(at(b), K, 0.35)
# A soft hat and a shaker in the intro, so the typing has a pulse under it.
for b in range(4, 8):
    drums.add(at(b + 0.5), hat(0.04, decay=80, color=7000), 0.04, pan=0.2)

# --- sound effects in sync with the picture ---
def tw_click():
    t = tt(0.03)
    return highpass(rng.standard_normal(len(t)), 1500) * np.exp(-t * 220) + np.sin(2 * np.pi * 1800 * t) * np.exp(-t * 300) * 0.3


def type_line(text, start_b, cps, gain=0.05):
    for i, ch in enumerate(text):
        if ch != ' ':
            fx.add(at(start_b + (i + 1) / cps) + rng.uniform(-0.004, 0.004), tw_click(), gain * rng.uniform(0.7, 1.1), pan=0.1)


type_line('сегодня:', 1.2, 12)
for i, s in enumerate(['браузер', 'музыка', 'редактор кода', 'игры']):
    type_line(s, 2.4 + i * 1.1, 14, 0.04)
type_line('Новый компьютер.', 1.5, 9, 0.06)
type_line('Что ставим первым?', 4, 9, 0.06)
for a, s in ((8, 'getbox — магазин программ для windows'), (16, 'целый набор — одной кнопкой'),
             (24, 'обновления напомнят о себе сами'), (32, 'под любое настроение'), (40, 'всё готово. можно работать')):
    type_line(s, a + 0.6, 16, 0.035)
type_line('бесплатно · для windows 10 и 11', 40.6 + 1.6, 16, 0.035)
type_line('github.com/IncludeSpecial/GetBox', 40.6 + 3.6, 18, 0.035)


def paper_drop():
    t = tt(0.35)
    thud = np.sin(2 * np.pi * 90 * t) * np.exp(-t * 25)
    rustle = lowpass(highpass(rng.standard_normal(len(t)), 800), 5000) * np.exp(-t * 12) * 0.5
    return thud + rustle


for b in (0.3, 8, 16, 24):                     # note and polaroids land
    fx.add(at(b + 0.6), paper_drop(), 0.3)
for b in (15.6, 23.6, 31.6):                   # previous polaroid slides away
    t = tt(0.5)
    fx.add(at(b), lowpass(highpass(rng.standard_normal(len(t)), 1200), 4000) * np.sin(np.pi * t / t[-1]) * 0.6, 0.12, pan=0.4)
for i in range(4):                             # pencil checks
    for k, (d, ln) in enumerate(((0, 0.09), (0.12, 0.2))):
        t = tt(ln)
        scratch = highpass(rng.standard_normal(len(t)), 2500) * (0.6 + 0.4 * np.sin(2 * np.pi * 40 * t)) * np.sin(np.pi * t / t[-1])
        fx.add(at(19 + i * 1.2) + d, scratch, 0.06)
for i in range(5):                             # cards dealt
    t = tt(0.12)
    flick = highpass(rng.standard_normal(len(t)), 2000) * np.exp(-t * 40)
    fx.add(at(33 + i) - 0.05, flick, 0.18, pan=-0.3 + i * 0.15)
    fx.add(at(33 + i) + 0.05, paper_drop() * 0.5, 0.18)
fx.add(at(40.6), paper_drop() * 1.4, 0.35)    # the logo stamp

# --- tape wobble on the music, then a warm low-pass ---
n = m.n
tvec = np.arange(n) / SR
wob = (0.0018 * np.sin(2 * np.pi * 0.55 * tvec) + 0.0006 * np.sin(2 * np.pi * 3.1 * tvec)) * SR
idx = np.clip(np.arange(n) - 120 - wob, 0, n - 1)
for bus in (keys,):
    bus.L = np.interp(idx, np.arange(n), bus.L)
    bus.R = np.interp(idx, np.arange(n), bus.R)
    bus.L = lowpass(bus.L, 5200)
    bus.R = lowpass(bus.R, 5200)
wl, wr = reverb(keys.L, keys.R, seconds=2.4, damp=3500, predelay=0.025)
keys.L += wl * 0.3
keys.R += wr * 0.3
drums.L = lowpass(drums.L, 7000)
drums.R = lowpass(drums.R, 7000)
dl, dr = reverb(drums.L, drums.R, seconds=0.8, damp=4000)
drums.L += dl * 0.1
drums.R += dr * 0.1

crackle = vinyl(DUR, density=9)
fx.add(0, crackle, 0.5)
fx.add(0, crackle[::-1].copy(), 0.35, pan=0.6)
for bus in (keys, drums, fx):
    bus.to_master()

write(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'music-lofi13.wav'), m.L, m.R, fade_in=0.4, fade_out=2.2, drive=1.05)
