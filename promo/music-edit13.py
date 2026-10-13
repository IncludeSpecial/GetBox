"""Phonk-style placeholder track for the 1.3 edit (edit13.html): 130 bpm, A minor.

Bars 1-2 filtered cowbell intro with a riser and a one-beat silence before
the drop; bars 3-6 drop (cowbell riff, distorted 808 with glides, hard kick,
clap on 2 and 4); bars 7-8 half-time break; bars 9-12 second drop with hat
rolls; then a final hit and the 808 ringing out.
"""
import os
import wave

import numpy as np

SR, BPM = 44100, 130
B = 60 / BPM
BAR = 4 * B
DROP1, BREAK, DROP2, OUTRO = 2 * BAR, 6 * BAR, 8 * BAR, 12 * BAR
DUR = OUTRO + 2.6 * B * 2
N = int(SR * DUR)
t = np.arange(N) / SR
L = np.zeros(N)
R = np.zeros(N)
rng = np.random.default_rng(7)


def hz(n):
    return 440 * 2 ** ((n - 69) / 12)


def lowpass(x, cutoff):
    cutoff = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = (1 - a[i]) * x[i] + a[i] * acc
        y[i] = acc
    return y


def place(buf, start, sig, gain=1.0):
    s = int(round(start * SR))
    e = min(s + len(sig), len(buf))
    if 0 <= s < len(buf):
        buf[s:e] += sig[: e - s] * gain


def both(start, sig, gain=1.0, pan=0.0):
    place(L, start, sig, gain * (1 - pan))
    place(R, start, sig, gain * (1 + pan))


def section(at):
    if at < DROP1:
        return 'intro'
    if at < BREAK:
        return 'drop'
    if at < DROP2:
        return 'break'
    if at < OUTRO:
        return 'drop2'
    return 'outro'


def silent(at):
    """The one-beat (or half-beat) gaps right before each drop and the outro hit."""
    return (DROP1 - B <= at < DROP1) or (DROP2 - B / 2 <= at < DROP2) or (OUTRO - B / 2 <= at < OUTRO)


# ---------- sounds ----------
def cowbell(note, length=0.32):
    tt = np.arange(int(length * SR)) / SR
    f = hz(note)
    sq = np.sign(np.sin(2 * np.pi * f * tt)) + 0.8 * np.sign(np.sin(2 * np.pi * f * 1.48 * tt))
    env = np.exp(-tt * 11) * (1 - np.exp(-tt * 900))
    return lowpass(sq * env, 3800) * 0.5


def kick():
    tt = np.arange(int(0.35 * SR)) / SR
    f = 45 + 160 * np.exp(-tt * 30)
    return np.tanh(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 7) * 2.5)


def clap():
    tt = np.arange(int(0.25 * SR)) / SR
    env = sum(np.exp(-np.clip(tt - d, 0, None) * 45) * (tt >= d) for d in (0, 0.009, 0.019, 0.03))
    return np.tanh(lowpass(rng.standard_normal(len(tt)), 3200) * env * 2)


def hat(length=0.04, decay=120):
    tt = np.arange(int(length * SR)) / SR
    return np.diff(rng.standard_normal(len(tt) + 1)) * np.exp(-tt * decay)


def crash(length=1.8):
    tt = np.arange(int(length * SR)) / SR
    return np.diff(rng.standard_normal(len(tt) + 1)) * np.exp(-tt * 2.2)


def bass808(n0, n1, length, glide=0.12):
    """Sine 808 with a click, a pitch glide from n0 to n1 at the end, and saturation."""
    tt = np.arange(int(length * SR)) / SR
    f = np.full(len(tt), hz(n0))
    g0 = max(0.0, length - glide)
    k = np.clip((tt - g0) / glide, 0, 1)
    f = hz(n0) * (hz(n1) / hz(n0)) ** k
    f = f * (1 + 0.8 * np.exp(-tt * 60))
    s = np.sin(2 * np.pi * np.cumsum(f) / SR)
    env = np.minimum(1, tt * 200) * np.exp(-tt * 0.9)
    return np.tanh(s * env * 3.0) * 0.9


K, CL = kick(), clap()

# Cowbell riff, one bar long, A minor: (16th step, note).
RIFF = [(0, 81), (3, 81), (6, 84), (8, 81), (10, 79), (13, 76), (15, 79)]
RIFF_B = [(0, 81), (3, 81), (6, 84), (8, 86), (10, 84), (12, 83), (14, 79)]
for bar in range(int(OUTRO / BAR)):
    riff = RIFF_B if bar % 2 else RIFF
    for step, note in riff:
        at = bar * BAR + step * B / 4
        if silent(at):
            continue
        sec = section(at)
        g = {'intro': 0.10, 'drop': 0.16, 'break': 0.07, 'drop2': 0.17}[sec]
        both(at, cowbell(note), g, pan=0.15 if step % 2 else -0.15)

# Intro: the cowbells are muffled, opening up into the drop.
intro_cut = np.where(t < DROP1, 700 + 2800 * (t / DROP1) ** 2, 20000)
break_cut = np.where((t >= BREAK) & (t < DROP2), 900, 20000)
cut = np.minimum(intro_cut, break_cut)
L = lowpass(L, cut)
R = lowpass(R, cut)

# 808: roots per half bar (A, A, F, G), long notes gliding into the next root.
ROOTS = [33, 33, 29, 31]
for half in range(int(OUTRO / (BAR / 2))):
    at = half * BAR / 2
    sec = section(at)
    if sec in ('intro', 'outro') or silent(at):
        continue
    n0 = ROOTS[half % 4]
    n1 = ROOTS[(half + 1) % 4]
    both(at, bass808(n0, n1, BAR / 2 - 0.01), 0.55 if sec != 'break' else 0.45)

# Drums.
for i in range(int(OUTRO / (B / 4))):
    at = i * B / 4
    step = i % 16
    sec = section(at)
    if silent(at) or sec in ('intro', 'outro'):
        continue
    if sec == 'break':
        if step == 0:
            both(at, K, 0.6)
        if step == 8:
            both(at, CL, 0.35)
        if step % 4 == 2:
            both(at, hat(), 0.05, pan=0.3)
        continue
    if step in (0, 6, 10) or (sec == 'drop2' and step == 14):
        both(at, K, 0.7)
    if step in (4, 12):
        both(at, CL, 0.42)
    if sec == 'drop' and step % 2 == 0:
        both(at, hat(), 0.05, pan=-0.3 if step % 4 else 0.3)
    if sec == 'drop2':
        both(at, hat(), 0.045, pan=-0.3 if step % 2 else 0.3)
        bar_end = (i // 16 + 1) * 16 - 4
        if i >= bar_end:  # triplet roll into the next bar
            for k in range(3):
                both(at + k * B / 12, hat(0.03, 160), 0.04)

# Risers and impacts.
tt = np.arange(int((DROP1 - B - 0.4) * SR)) / SR
riser = lowpass(rng.standard_normal(len(tt)), 200 + 7000 * (tt / tt[-1]) ** 2) * (tt / tt[-1]) ** 2
both(0.4, riser, 0.3)
tt = np.arange(int((DROP2 - B / 2 - BREAK - BAR) * SR)) / SR
riser2 = lowpass(rng.standard_normal(len(tt)), 300 + 8000 * (tt / tt[-1]) ** 2) * (tt / tt[-1]) ** 2
both(BREAK + BAR, riser2, 0.3)
for at, g in ((DROP1, 0.16), (BREAK, 0.1), (DROP2, 0.18), (OUTRO, 0.18)):
    both(at, crash(), g)
    both(at, K, 0.8)
# Outro: final 808 ringing on A.
both(OUTRO, bass808(33, 33, DUR - OUTRO, 0.01), 0.6)
both(OUTRO, cowbell(81, 0.9), 0.18)

# Hard silence in the pre-drop gaps (tails included), with 5 ms fades.
mask = np.ones(N)
for a0, a1 in ((DROP1 - B, DROP1), (DROP2 - B / 2, DROP2), (OUTRO - B / 2, OUTRO)):
    s0, s1, f = int(a0 * SR), int(a1 * SR), int(0.005 * SR)
    mask[s0:s1] = 0
    mask[s0 - f:s0] = np.linspace(1, 0, f)
L *= mask
R *= mask

# Master: saturation, sidechain-ish duck under the kick is already in the 808 envelope; fade and normalise.
fade = np.ones(N)
fade[-int(1.0 * SR):] = np.linspace(1, 0, int(1.0 * SR))
L = np.tanh(L * 1.4) * fade
R = np.tanh(R * 1.4) * fade
peak = max(np.abs(L).max(), np.abs(R).max())
L, R = L / peak * 0.9, R / peak * 0.9
pcm = (np.stack([L, R], 1) * 32767).astype('<i2')
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'music-edit13.wav')
with wave.open(out, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(out, round(DUR, 2), 's')
