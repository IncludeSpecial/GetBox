"""Music for synth13.html: synthwave, 96 BPM, A minor (Am – F – C – G).

Intro (0–8): pad and a filtered arpeggio opening up, a riser into the logo.
Drop (8): the logo lands — big hit, half-time groove while it holds.
Monitor (12–44): full groove — kick, gated-reverb snare, octave bass, arpeggio with
ping-pong delay; a lead from 20; tape-glitch bursts on every screen change.
Outro (44): hit with the flash, lighter groove, the last A minor chord rings out.
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from synth import (Mix, SR, adsr, hat, hz, kick, lowpass, noise_sweep, ping_pong, reverb, rng, saw, sine,  # noqa: E402
                   snare, square, supersaw, svf, tt, write)

BPM = 96
B = 60 / BPM
DUR = 52 * B + 1.5
m = Mix(DUR)
pads = m.bus()
synths = m.bus()
drums = m.bus()

CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]  # Am F C G
ROOTS = [33, 29, 36, 31]


def at(b):
    return b * B


def chord_idx(b):
    return int(b // 4) % 4


# --- pad: wide detuned saws, filter opens through the intro ---
for bar in range(0, 52, 4):
    length = 4 * B + 0.3
    notes = CHORDS[chord_idx(bar)] if bar < 44 else CHORDS[0]
    sig = sum(supersaw(n, length, voices=6, spread=0.22) for n in notes + [notes[0] - 12]) / 4
    cut = 600 + (2600 if bar >= 8 else 2600 * (bar + np.linspace(0, 4, len(sig))) / 8)
    sig = lowpass(sig, cut) * adsr(length, 0.25, 1, 0.9, 0.3)
    pads.add(at(bar), sig, 0.32 if bar < 44 else 0.0)
end_len = DUR - at(44)
final = sum(supersaw(n, end_len, voices=6, spread=0.22) for n in (45, 57, 60, 64, 69)) / 5
pads.add(at(44), lowpass(final, 2800) * adsr(end_len, 0.02, 2, 0.6, 1.6), 0.4)

# --- arpeggio: sixteenths, up-down through the chord ---
def arp_note(note, length, cutoff):
    t = tt(length)
    sig = square(hz(note), length, 0.3) * 0.6 + saw(hz(note + 0.04), length) * 0.4
    return lowpass(sig, cutoff * (0.4 + 0.6 * np.exp(-t * 20))) * np.exp(-t * 14) * (1 - np.exp(-t * 800))


arp = np.zeros(m.n)
for i in range(int(44 * 4)):
    b = i / 4
    ch = CHORDS[chord_idx(b)]
    seq = [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[0] + 24, ch[2] + 12, ch[1] + 12, ch[0] + 12, ch[1] + 12]
    cutoff = 700 + 3800 * min(1, b / 8)
    sig = arp_note(seq[i % 8], 0.2, cutoff)
    s = int(at(b) * SR)
    arp[s:s + len(sig)] += sig[: m.n - s] * (0.55 if b >= 12 else 0.4)
al, ar = ping_pong(arp, B * 0.75, 0.4)
synths.L += al * 0.3
synths.R += ar * 0.3

# --- bass: octave eighths from the drop ---
def bass(note, length):
    t = tt(length)
    sig = saw(hz(note), length) + 0.6 * square(hz(note - 0.03), length)
    return lowpass(sig, 300 + 1400 * np.exp(-t * 16)) * adsr(length, 0.003, 0.1, 0.7, 0.03)


for i in range(8 * 2, 48 * 2):
    b = i / 2
    if 8 <= b < 12 and i % 2:      # half-time while the logo holds
        continue
    root = ROOTS[chord_idx(b)] if b < 44 else ROOTS[0]
    synths.add(at(b), bass(root + (12 if i % 2 else 0), B * 0.45), 0.42)

# --- lead from 20: a simple hook, vibrato and delay ---
def lead(note, length):
    t = tt(length)
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.5 * t) * np.clip((t - 0.15) * 4, 0, 1)
    f = hz(note) * vib
    sig = saw(f, length) * 0.6 + saw(f * 1.004, length) * 0.4
    return lowpass(sig, 3200) * adsr(length, 0.02, 0.3, 0.75, 0.12)


HOOK = [(0, 76, 1.5), (1.5, 74, 0.5), (2, 72, 1), (3, 74, 1),          # over Am
        (4, 72, 1.5), (5.5, 69, 0.5), (6, 72, 2),                       # over F
        (8, 67, 1.5), (9.5, 69, 0.5), (10, 72, 1), (11, 74, 1),         # over C
        (12, 71, 2), (14, 74, 1), (15, 79, 1)]                           # over G
lead_buf = np.zeros(m.n)
for start in (20, 36):
    for off, n, ln in HOOK:
        b = start + off
        if b >= 44:
            break
        sig = lead(n, ln * B)
        s = int(at(b) * SR)
        lead_buf[s:s + len(sig)] += sig[: m.n - s]
ll, lr = ping_pong(lead_buf, B * 0.75, 0.35)
synths.L += ll * 0.22
synths.R += lr * 0.22
# Final lead note over the outro chord.
synths.add(at(44), lead(81, 4 * B), 0.2)

# --- drums ---
def gated_snare():
    body = snare(0.3, tone=180, noise_decay=14, color=6000)
    t = tt(0.3)
    gate = np.where(t < 0.2, 1.0, np.exp(-(t - 0.2) * 60))
    room = lowpass(rng.standard_normal(len(t)), 5000) * gate * 0.55
    return body + room


def tom(note, length=0.35):
    t = tt(length)
    f = hz(note) * (1 + 0.6 * np.exp(-t * 20))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 8)


K, S = kick(0.5, punch=90, low=48, decay=7), gated_snare()
for b in range(8, 52):
    full = 12 <= b < 44
    if b < 12:                          # half-time under the logo
        if b % 4 == 0:
            drums.add(at(b), K, 0.9)
        if b % 4 == 2:
            drums.add(at(b), S, 0.55)
        continue
    if b % 2 == 0:
        drums.add(at(b), K, 0.85 if full else 0.7)
    else:
        drums.add(at(b), S, 0.5 if full else 0.4)
    if full or b < 48:
        drums.add(at(b), hat(0.05, decay=70), 0.1, pan=0.2)
        drums.add(at(b + 0.5), hat(0.08, decay=40), 0.14, pan=0.2)

# Tom fills before the screen changes.
for b in (19, 27, 35, 43):
    for k, n in enumerate((50, 47, 43, 40)):
        drums.add(at(b + k * 0.25), tom(n), 0.35, pan=0.4 - k * 0.25)

# Drop on 8: crash + low boom; riser into it.
drums.add(at(6), noise_sweep(2 * B, 300, 12000), 0.35)
crash = lowpass(rng.standard_normal(int(3 * SR)), 11000) * np.exp(-tt(3) * 1.6)
for b in (8, 12, 44):
    drums.add(at(b), crash, 0.16)
    drums.add(at(b), kick(1.2, punch=60, low=38, decay=2.5), 0.7)
drums.add(at(42.6), noise_sweep(1.4 * B, 400, 10000), 0.3)

# Tape glitch bursts on the screen changes (and small zaps on the theme cuts).
def glitch(length=0.28):
    t = tt(length)
    n = rng.standard_normal(len(t))
    crushed = np.round(n * 3) / 3
    tone = np.sign(np.sin(2 * np.pi * np.cumsum(900 * np.exp(-t * 9)) / SR))
    return svf(crushed * 0.6 + tone * 0.4, 2500, q=3, mode='bp') * np.exp(-t * 8)


for b in (12.6, 20, 28, 36):
    drums.add(at(b) - 0.08, glitch(), 0.3, pan=rng.uniform(-0.3, 0.3))
for b in (38, 39, 40, 41):
    drums.add(at(b) - 0.03, glitch(0.1), 0.16)
# Neon flicker hums when captions switch on.
for b in (12, 20, 28, 36):
    hum = np.sin(2 * np.pi * 120 * tt(0.5)) * (np.sin(2 * np.pi * 14 * tt(0.5)) > 0) * np.exp(-tt(0.5) * 6)
    drums.add(at(b), lowpass(hum, 1200), 0.05)

# Sidechain the pads and synths under the kick.
duck = np.ones(m.n)
for b in range(8, 52):
    if (b < 12 and b % 4 == 0) or (b >= 12 and b % 2 == 0):
        s = int(at(b) * SR)
        ln = min(int(B * SR), m.n - s)
        duck[s:s + ln] = np.minimum(duck[s:s + ln], 1 - 0.45 * np.exp(-np.arange(ln) / SR * 9))
for bus in (pads, synths):
    bus.L *= duck
    bus.R *= duck

wl, wr = reverb(pads.L + synths.L, pads.R + synths.R, seconds=3.2, damp=4500, predelay=0.03)
pads.L += wl * 0.35
pads.R += wr * 0.35
dl, dr = reverb(drums.L, drums.R, seconds=1.4, damp=5000)
drums.L += dl * 0.12
drums.R += dr * 0.12
for bus in (pads, synths, drums):
    bus.to_master()

write(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'music-synth13.wav'), m.L, m.R, fade_out=1.8)
