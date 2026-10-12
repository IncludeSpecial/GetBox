"""Procedural 30 s track for the vertical Shorts cut: 128 bpm, drop on bar 3.

Sections follow promo/shorts.html: bars 1-2 filtered intro with a click per
popping dialog, riser, drop at bar 3, full beat to bar 13, crash on the scene
hits (bars 6, 10, 14) and a final hit with a ringing tail.
"""
import os
import wave

import numpy as np

SR, BPM = 44100, 128
B = 60 / BPM
BAR = 4 * B
DUR = 16 * BAR
N = int(SR * DUR)
t = np.arange(N) / SR
L = np.zeros(N)
R = np.zeros(N)
rng = np.random.default_rng(11)


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


# Am – F – C – G, one chord per bar.
CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]
DROP, END_BEAT = 2 * BAR, 13 * BAR

# Sidechain pump: every beat during the drop.
pump = np.ones(N)
for i in range(int(DUR / B)):
    at = i * B
    if DROP <= at < END_BEAT:
        s = int(at * SR)
        e = min(s + int(B * SR), N)
        x = np.arange(e - s) / SR
        pump[s:e] = 1 - 0.65 * np.exp(-x * 14)

# Pad: detuned supersaw, opening filter through the intro.
pad = np.zeros(N)
for bar in range(16):
    chord = CHORDS[bar % 4] if bar < 15 else [57, 64, 69]
    s, e = int(bar * BAR * SR), min(int((bar + 1) * BAR * SR + 0.3 * SR), N)
    tt = t[s:e] - t[s]
    for note in chord:
        for det in (-0.15, 0.0, 0.15):
            f = hz(note + det)
            pad[s:e] += sum(np.sin(2 * np.pi * f * k * tt + det * k) / k for k in range(1, 7)) * 0.03
cut = np.where(t < DROP, 300 + 2500 * (t / DROP) ** 2, 3200)
pad = lowpass(pad, cut) * pump * np.where(t >= END_BEAT, 1.6, 1.0)
L += pad
R += pad

# Bass: root on 8ths, saw through a low-pass, pumped.
bass = np.zeros(N)
for i in range(int(DUR / (B / 2))):
    at = i * B / 2
    if not (DROP <= at < END_BEAT):
        continue
    root = CHORDS[int(at // BAR) % 4][0] - 24
    tt = np.arange(int(B / 2 * SR)) / SR
    f = hz(root)
    saw = 2 * (tt * f - np.floor(tt * f + 0.5))
    bass_note = saw * np.exp(-tt * 3) * (1 if i % 2 else 0.8)
    place(bass, at, bass_note)
bass = lowpass(bass, 420) * pump
L += bass * 0.55
R += bass * 0.55

# Pluck lead: 16th arpeggio in the drop.
for i in range(int(DUR / (B / 4))):
    at = i * B / 4
    if not (DROP <= at < END_BEAT):
        continue
    chord = CHORDS[int(at // BAR) % 4]
    seq = [chord[0] + 12, chord[2] + 12, chord[1] + 24, chord[2] + 12, chord[0] + 24, chord[1] + 12]
    n = seq[i % len(seq)]
    tt = np.arange(int(0.25 * SR)) / SR
    tone = (np.sin(2 * np.pi * hz(n) * tt) + 0.4 * np.sin(4 * np.pi * hz(n) * tt)) * np.exp(-tt * 14)
    both(at, tone, 0.06, pan=0.4 if i % 2 else -0.4)

# Drums.
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


K, C = kick(), clap()
for i in range(int(DUR / B)):
    at = i * B
    if DROP <= at < END_BEAT:
        both(at, K, 0.55)
        if i % 2 == 1:
            both(at, C, 0.22)
        both(at + B / 2, hat(0.09, 40), 0.05, pan=0.2)
        both(at + B / 4, hat(), 0.025, pan=-0.3)
        both(at + 3 * B / 4, hat(), 0.025, pan=-0.3)

# Intro: a "pop" per dialog (beats 1–7) and a riser into the drop.
for i in range(1, 8):
    tt = np.arange(int(0.12 * SR)) / SR
    f = 900 + 500 * np.exp(-tt * 40)
    pop_ = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 30)
    both(i * B, pop_, 0.18, pan=0.3 if i % 2 else -0.3)
rs = BAR + B
tt = np.arange(int((DROP - rs) * SR)) / SR
riser = lowpass(rng.standard_normal(len(tt)), 200 + 6000 * (tt / tt[-1]) ** 2) * (tt / tt[-1]) ** 2
both(rs, riser, 0.35)

# Crashes on scene hits + the final hit.
for at in (DROP, 5 * BAR, 9 * BAR):
    both(at, crash(), 0.12)
fin = END_BEAT
both(fin, crash(), 0.16)
both(fin, K, 0.6)
tt = np.arange(int((DUR - fin) * SR)) / SR
for note in (45, 57, 64, 69):
    both(fin, np.sin(2 * np.pi * hz(note) * tt) * np.exp(-tt * 0.55), 0.06)

# Master: gentle saturation, short fade-out, normalise.
fade = np.ones(N)
fade[-int(1.2 * SR):] = np.linspace(1, 0, int(1.2 * SR))
L = np.tanh(L * 1.2) * fade
R = np.tanh(R * 1.2) * fade
peak = max(np.abs(L).max(), np.abs(R).max())
L, R = L / peak * 0.89, R / peak * 0.89
pcm = (np.stack([L, R], 1) * 32767).astype('<i2')
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'music-shorts.wav')
with wave.open(out, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(out, round(DUR, 2), 's')
