"""Calm corporate track for corp13.html: 100 bpm, C - G - Am - F, 50 s.

Soft piano arpeggios and a warm pad from the start; a light kick enters with
the solution (0:10.2), claps and a shaker with the feature section (0:15.6),
a gentle lift into the summary (0:39.6) and a resolving C chord for the call
to action.
"""
import os
import wave

import numpy as np

SR, BPM = 44100, 100
B = 60 / BPM
BAR = 4 * B
DUR = 50.0
N = int(SR * DUR)
t = np.arange(N) / SR
L = np.zeros(N)
R = np.zeros(N)
rng = np.random.default_rng(3)
SOLUTION, FEATURES, SUMMARY, CTA = 10.2, 15.6, 39.6, 44.4


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


def piano(note, length=1.6):
    tt = np.arange(int(length * SR)) / SR
    f = hz(note)
    tone = sum(np.sin(2 * np.pi * f * k * tt) * a * np.exp(-tt * (1.6 + k * 0.9)) for k, a in ((1, 1), (2, .45), (3, .22), (4, .1)))
    return tone * (1 - np.exp(-tt * 300))


CHORDS = [[48, 55, 60, 64], [43, 55, 59, 62], [45, 57, 60, 64], [41, 57, 60, 65]]  # C G Am F
END_BAR = int(CTA / BAR)

# Pad: soft sine stack per bar, swelling in.
pad = np.zeros(N)
for bar in range(int(DUR / BAR) + 1):
    chord = CHORDS[bar % 4] if bar < END_BAR else [48, 55, 60, 64]
    s, e = int(bar * BAR * SR), min(int((bar + 1) * BAR * SR + 0.4 * SR), N)
    if s >= N:
        break
    tt = t[s:e] - t[s]
    env = np.minimum(1, tt / 0.6) * np.minimum(1, (tt[-1] - tt) / 0.4 + 0.001)
    for n in chord[1:]:
        for det in (-0.06, 0.06):
            pad[s:e] += np.sin(2 * np.pi * hz(n + det) * tt) * env * 0.025
pad = lowpass(pad, 1800) * np.clip(t / 3, 0, 1)
L += pad
R += pad

# Piano: 8th-note arpeggio, a melody note on bar starts from the solution on.
for i in range(int(CTA / (B / 2))):
    at = i * B / 2
    chord = CHORDS[int(at // BAR) % 4]
    seq = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[3] + 12, chord[2] + 12, chord[1] + 12, chord[2] + 12, chord[3] + 12]
    both(at, piano(seq[i % 8], 1.2), 0.07, pan=0.25 if i % 2 else -0.25)
    if at >= SOLUTION and i % 8 == 0:
        both(at, piano(chord[3] + 24, 2.4), 0.06)
for n in (48, 55, 60, 64, 67, 72):  # final chord
    both(CTA, piano(n, DUR - CTA), 0.09)


def kick():
    tt = np.arange(int(0.3 * SR)) / SR
    f = 50 + 70 * np.exp(-tt * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 9)


def clap():
    tt = np.arange(int(0.2 * SR)) / SR
    env = sum(np.exp(-np.clip(tt - d, 0, None) * 55) * (tt >= d) for d in (0, 0.01, 0.02))
    return lowpass(rng.standard_normal(len(tt)), 2600) * env


def shaker():
    tt = np.arange(int(0.08 * SR)) / SR
    return np.diff(rng.standard_normal(len(tt) + 1)) * np.exp(-tt * 50) * (1 - np.exp(-tt * 200))


K, C = kick(), clap()
for i in range(int(CTA / B)):
    at = i * B
    if at >= SOLUTION:
        if i % 2 == 0:
            both(at, K, 0.32)
    if at >= FEATURES:
        if i % 2 == 1:
            both(at, C, 0.08)
        for k in range(4):
            both(at + k * B / 4, shaker(), 0.012 if k % 2 else 0.02, pan=0.35)

# Soft chimes on section changes.
for at in (4.8, SOLUTION, FEATURES, 21.6, 27.6, 33.6, SUMMARY):
    tt = np.arange(int(1.4 * SR)) / SR
    chime = (np.sin(2 * np.pi * hz(84) * tt) + 0.4 * np.sin(2 * np.pi * hz(91) * tt)) * np.exp(-tt * 3)
    both(at, chime, 0.035)
# Swell into the summary.
tt = np.arange(int(1.6 * SR)) / SR
swell = lowpass(rng.standard_normal(len(tt)), 300 + 3000 * (tt / tt[-1]) ** 2) * (tt / tt[-1]) ** 2
both(SUMMARY - 1.6, swell, 0.08)

fade = np.ones(N)
fade[-int(2.5 * SR):] = np.linspace(1, 0, int(2.5 * SR))
fade[:int(0.3 * SR)] = np.linspace(0, 1, int(0.3 * SR))
L = np.tanh(L * 1.1) * fade
R = np.tanh(R * 1.1) * fade
peak = max(np.abs(L).max(), np.abs(R).max())
L, R = L / peak * 0.85, R / peak * 0.85
pcm = (np.stack([L, R], 1) * 32767).astype('<i2')
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'music-corp13.wav')
with wave.open(out, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(out, round(DUR, 2), 's')
