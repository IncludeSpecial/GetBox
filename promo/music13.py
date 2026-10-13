"""Procedural 45 s track for the GetBox 1.3 promo (promo13.html): 120 bpm.

Sections follow the storyboard: filtered intro with a pulse (0-10 s),
drop 1 at 0:10 under the theme / accent / views / updates scenes, a one-beat
stop for the rollback (0:29.5), the rapid-fire features montage with a hit
on every cut (0:32-0:40), a filtered breakdown for the suggestions scene
(0:40-0:44), drop 2 at 0:44 for the fan, and a ringing final chord.
Scene sound effects (click, dings, whooshes, reverse cymbal) sit on the
same beats as the picture.
"""
import os
import wave

import numpy as np

SR, BPM = 44100, 120
B = 60 / BPM
BAR = 4 * B
DUR = 53.0
N = int(SR * DUR)
t = np.arange(N) / SR
L = np.zeros(N)
R = np.zeros(N)
rng = np.random.default_rng(13)

DROP1, STOP, FEATS, BREAK, DROP2, END = 10.0, 29.5, 32.0, 40.0, 44.0, 49.0


def hz(n):
    return 440 * 2 ** ((n - 69) / 12)


def lowpass(x, cutoff):
    """One-pole low-pass; cutoff may be a scalar or a per-sample array."""
    cutoff = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = (1 - a[i]) * x[i] + a[i] * acc
        y[i] = acc
    return y


def place(buf, start, sig, gain=1.0):
    s = int(start * SR)
    e = min(s + len(sig), len(buf))
    if 0 <= s < len(buf):
        buf[s:e] += sig[: e - s] * gain


def both(start, sig, gain=1.0, pan=0.0):
    place(L, start, sig, gain * (1 - pan))
    place(R, start, sig, gain * (1 + pan))


def full_beat(at):
    """Where the full groove plays: both drops, minus the rollback stop."""
    return (DROP1 <= at < BREAK and not (STOP <= at < STOP + B)) or (DROP2 <= at < END)


# Am – F – C – G, one chord per bar.
CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]

pump = np.ones(N)
for i in range(int(DUR / B)):
    at = i * B
    if full_beat(at):
        s = int(at * SR)
        e = min(s + int(B * SR), N)
        x = np.arange(e - s) / SR
        pump[s:e] = 1 - 0.6 * np.exp(-x * 14)

# Pad: detuned saw stack; the filter opens through the intro and closes in the breakdown.
pad = np.zeros(N)
for bar in range(int(DUR / BAR) + 1):
    chord = CHORDS[bar % 4] if bar * BAR < END else [57, 64, 69]
    s, e = int(bar * BAR * SR), min(int((bar + 1) * BAR * SR + 0.3 * SR), N)
    if s >= N:
        break
    tt = t[s:e] - t[s]
    for note in chord:
        for det in (-0.14, 0.0, 0.14):
            f = hz(note + det)
            pad[s:e] += sum(np.sin(2 * np.pi * f * k * tt + det * k) / k for k in range(1, 7)) * 0.03
cut = np.select(
    [t < DROP1, (t >= BREAK) & (t < DROP2)],
    [250 + 2600 * (t / DROP1) ** 2, 500 + 2200 * ((t - BREAK) / (DROP2 - BREAK)) ** 3],
    3200,
)
pad = lowpass(pad, cut) * pump * np.where(t >= END, 1.7, 1.0)
L += pad
R += pad

# Intro pulse: muted 8th-note synth on the root, also back for the end card.
for i in range(int(DUR / (B / 2))):
    at = i * B / 2
    if not (at < DROP1 or at >= END):
        continue
    root = CHORDS[int(at // BAR) % 4][0] - 12 if at < DROP1 else 45
    tt = np.arange(int(0.18 * SR)) / SR
    tone = np.sin(2 * np.pi * hz(root) * tt) * np.exp(-tt * 18)
    gain = 0.09 * (0.4 + 0.6 * min(1, at / 6)) if at < DROP1 else 0.07 * max(0, 1 - (at - END) / 3.5)
    both(at, tone, gain)

# Bass: root on 8ths in the drops.
bass = np.zeros(N)
for i in range(int(DUR / (B / 2))):
    at = i * B / 2
    if not full_beat(at):
        continue
    root = CHORDS[int(at // BAR) % 4][0] - 24
    tt = np.arange(int(B / 2 * SR)) / SR
    f = hz(root)
    saw = 2 * (tt * f - np.floor(tt * f + 0.5))
    place(bass, at, saw * np.exp(-tt * 3) * (1 if i % 2 else 0.8))
bass = lowpass(bass, 420) * pump
L += bass * 0.55
R += bass * 0.55

# Pluck arpeggio: 16ths in drop 1, a brighter lead an octave up in drop 2.
for i in range(int(DUR / (B / 4))):
    at = i * B / 4
    if not full_beat(at):
        continue
    chord = CHORDS[int(at // BAR) % 4]
    seq = [chord[0] + 12, chord[2] + 12, chord[1] + 24, chord[2] + 12, chord[0] + 24, chord[1] + 12]
    n = seq[i % len(seq)] + (12 if at >= DROP2 else 0)
    tt = np.arange(int(0.25 * SR)) / SR
    tone = (np.sin(2 * np.pi * hz(n) * tt) + 0.4 * np.sin(4 * np.pi * hz(n) * tt)) * np.exp(-tt * 14)
    both(at, tone, 0.05 if at < DROP2 else 0.065, pan=0.4 if i % 2 else -0.4)


def kick():
    tt = np.arange(int(0.32 * SR)) / SR
    f = 48 + 110 * np.exp(-tt * 38)
    return np.tanh(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 8) * 1.6)


def clap():
    tt = np.arange(int(0.22 * SR)) / SR
    env = sum(np.exp(-np.clip(tt - d, 0, None) * 60) * (tt >= d) for d in (0, 0.011, 0.023))
    return lowpass(rng.standard_normal(len(tt)), 2500) * env


def hat(length=0.05, decay=90):
    tt = np.arange(int(length * SR)) / SR
    return np.diff(rng.standard_normal(len(tt) + 1)) * np.exp(-tt * decay)


def crash():
    tt = np.arange(int(1.6 * SR)) / SR
    return np.diff(rng.standard_normal(len(tt) + 1)) * np.exp(-tt * 2.6)


def blip(f0, f1, length=0.12, decay=30):
    tt = np.arange(int(length * SR)) / SR
    f = f1 + (f0 - f1) * np.exp(-tt * 40)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * decay)


def ding(note):
    tt = np.arange(int(0.6 * SR)) / SR
    f = hz(note)
    return (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(2 * np.pi * 2.76 * f * tt)) * np.exp(-tt * 6)


def whoosh(length=0.28):
    tt = np.arange(int(length * SR)) / SR
    env = np.sin(np.pi * tt / length) ** 2
    return lowpass(rng.standard_normal(len(tt)), 600 + 5000 * tt / length) * env


K, C = kick(), clap()
for i in range(int(DUR / B)):
    at = i * B
    if 3.0 <= at < DROP1:  # hats come in with scene 02
        both(at + B / 2, hat(0.06, 60), 0.03, pan=0.2)
    if not full_beat(at):
        continue
    both(at, K, 0.55)
    if i % 2 == 1:
        both(at, C, 0.2)
    both(at + B / 2, hat(0.09, 40), 0.05, pan=0.2)
    both(at + B / 4, hat(), 0.022, pan=-0.3)
    both(at + 3 * B / 4, hat(), 0.022, pan=-0.3)

# 03 — click on «Установить», download riser, ding at 100 %, a beat of silence.
both(7.5, blip(2400, 900, 0.05, 80), 0.3)
tt = np.arange(int((DROP1 - 7.6) * SR)) / SR
riser = lowpass(rng.standard_normal(len(tt)), 200 + 6000 * (tt / tt[-1]) ** 2) * (tt / tt[-1]) ** 2
both(7.6, riser * (tt < (DROP1 - 7.6) - B), 0.32)
both(8.9, ding(84), 0.12)

# 04 — a stereo whoosh per theme change.
for k in range(5):
    tt = np.arange(int(0.28 * SR)) / SR
    w = whoosh()
    place(L, DROP1 + k * B - 0.05, w * np.linspace(1, 0.2, len(w)), 0.18)
    place(R, DROP1 + k * B - 0.05, w * np.linspace(0.2, 1, len(w)), 0.18)

# 05 — rising drops on each accent.
for k, f in enumerate((700, 900, 1150)):
    both(14.5 + k * B, blip(f * 1.6, f, 0.25, 12), 0.14)

# 06 — switch clicks.
for k in range(4):
    both(17.0 + k * B, blip(3000, 1500, 0.03, 120), 0.2)

# 07 — notification ping on the badge; 08 — three dings up.
both(21.6, ding(88), 0.13)
for k, n in enumerate((79, 83, 86)):
    both(25.8 + k * B, ding(n), 0.11)

# 09 — reverse cymbal into the stop, then the beat comes back.
rev = crash()[: int(0.9 * SR)][::-1]
both(STOP - 0.9, rev, 0.16)

# 10 — a whoosh and a snare hit on every feature cut.
for k in range(8):
    at = FEATS + k
    w = whoosh(0.22)
    place(L, at - 0.08, w * np.linspace(0.2, 1, len(w)), 0.16)
    place(R, at - 0.08, w * np.linspace(1, 0.2, len(w)), 0.16)
    both(at, C, 0.18)
    both(at, blip(1800 + 120 * k, 900, 0.06, 60), 0.08)

# 11 — pops on the chips, riser into drop 2.
for k in range(5):
    both(BREAK + 0.6 + k * B / 2, blip(1400, 800, 0.08, 40), 0.09, pan=-0.3 + 0.15 * k)
tt = np.arange(int(2.0 * SR)) / SR
riser2 = lowpass(rng.standard_normal(len(tt)), 300 + 7000 * (tt / tt[-1]) ** 2) * (tt / tt[-1]) ** 2
both(DROP2 - 2.0, riser2, 0.34)

# Crashes on the drops, the final hit and a ringing chord.
for at in (DROP1, DROP2):
    both(at, crash(), 0.14)
both(END, crash(), 0.15)
both(END, K, 0.6)
tt = np.arange(int((DUR - END) * SR)) / SR
for note in (45, 57, 64, 69):
    both(END, np.sin(2 * np.pi * hz(note) * tt) * np.exp(-tt * 0.55), 0.06)

fade = np.ones(N)
fade[-int(2.0 * SR):] = np.linspace(1, 0, int(2.0 * SR))
L = np.tanh(L * 1.2) * fade
R = np.tanh(R * 1.2) * fade
peak = max(np.abs(L).max(), np.abs(R).max())
L, R = L / peak * 0.89, R / peak * 0.89
pcm = (np.stack([L, R], 1) * 32767).astype('<i2')
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'music13.wav')
with wave.open(out, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(out, round(DUR, 2), 's')
