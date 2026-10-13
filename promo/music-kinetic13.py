"""Music for kinetic13.html: minimal house, 124 BPM, F minor (Fm – Db – Ab – Eb).

Follows the cut list in beats: a stab per chore word (0–5), a hit on «Хватит.» (6),
a riser into the name (8), the groove from the catalog on (16), a breakdown while the
checksum types out (32–40) with a stamp hit, the groove back for updates and themes
(40–56), and a final chord for the call to action (56). Every red wipe gets a swoosh.
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from synth import (Mix, SR, adsr, clap, hat, hz, kick, lowpass, noise_sweep, ping_pong, reverb, rng, saw,  # noqa: E402
                   sine, supersaw, svf, swoosh, tt, write)

BPM = 124
B = 60 / BPM
DUR = 64 * B + 1.6
m = Mix(DUR)
music = m.bus()   # chords, bass, plucks: ducked by the kick and sent to the reverb
drums = m.bus()

CHORDS = [[53, 56, 60], [49, 53, 56], [44, 48, 51], [51, 55, 58]]  # Fm Db Ab Eb
ROOTS = [41, 37, 44, 39]
WIPES = [8, 16, 24, 32, 40, 48, 56]


def at(b):
    return b * B


def chord_at(b):
    return (int(b // 4) - 2) % 4


def stab(notes, length=0.28, cutoff=2400):
    sig = sum(supersaw(n, length, voices=3, spread=0.1) for n in notes) / len(notes)
    return lowpass(sig, cutoff) * adsr(length, 0.003, 0.08, 0.35, 0.05)


def pluck(note, length=0.35, bright=4000):
    sig = saw(hz(note), length) + 0.5 * saw(hz(note + 12.05), length)
    t = tt(length)
    return lowpass(sig, 300 + bright * np.exp(-t * 18)) * np.exp(-t * 9) * (1 - np.exp(-t * 900))


def bass(note, length):
    t = tt(length)
    sig = sine(hz(note), length) + 0.35 * np.tanh(saw(hz(note), length) * 2)
    return lowpass(sig, 900) * adsr(length, 0.004, 0.12, 0.6, 0.03) * (1 - np.exp(-t * 400))


# --- 0–8: the chores, one stab per word, «Хватит.» on 6 ---
WORD_NOTES = [[53, 60, 65], [51, 58, 63], [53, 60, 65], [51, 58, 63], [49, 56, 61], [48, 55, 60]]
for i, notes in enumerate(WORD_NOTES):
    music.add(at(i), stab(notes, 0.34), 0.5, pan=-0.2 if i % 2 else 0.2)
    drums.add(at(i), kick(0.25, punch=80, low=60, decay=14), 0.45)
    drums.add(at(i), hat(0.05), 0.12)
music.add(at(6), stab([41, 53, 56, 60, 65], 1.2, cutoff=3200), 0.75)
drums.add(at(6), kick(0.6), 0.95)
drums.add(at(6), clap(0.4), 0.45)
drums.add(at(6), lowpass(rng.standard_normal(int(1.4 * SR)), 9000) * np.exp(-tt(1.4) * 3.2), 0.12)

# --- swooshes under every red wipe (the cut lands at 55 % of the swoosh) ---
for w in WIPES:
    drums.add(at(w) - 0.55 * B * 1.6, swoosh(B * 1.6, center=0.55), 0.22)
drums.add(at(7), noise_sweep(B, 400, 9000), 0.25)

# --- grooves ---
GROOVE = [(8, 32), (40, 60)]
def in_groove(b):
    return any(a <= b < z for a, z in GROOVE)


kick_times = []
for b in range(8, 60):
    if in_groove(b):
        drums.add(at(b), kick(), 0.85)
        kick_times.append(at(b))
for b in range(8, 60):
    if not in_groove(b):
        continue
    if b >= 12 and b % 2 == 1:
        drums.add(at(b), clap(), 0.32)
    drums.add(at(b + 0.5), hat(0.16, decay=18), 0.16, pan=0.15)      # open hat on the off-beat
    if b >= 16:
        for k in (0.25, 0.75):
            drums.add(at(b + k), hat(0.04, decay=90), 0.07, pan=-0.25)
    if b >= 44:
        drums.add(at(b + 0.125), hat(0.03, decay=120), 0.04, pan=0.3)
    # Bass on the off-beat eighths.
    root = ROOTS[chord_at(b)]
    music.add(at(b + 0.5), bass(root, B * 0.45), 0.55)
    if b % 4 == 3:
        music.add(at(b + 0.75), bass(root + 12, B * 0.22), 0.3)

# Stabs on a syncopated figure, every bar from the catalog on.
FIG = [0, 0.75, 1.5, 2.5, 3.25]
for bar in range(16, 32, 4):
    for k in FIG:
        music.add(at(bar + k), stab([n + 12 for n in CHORDS[chord_at(bar)]], 0.22), 0.3, pan=0.25 if k % 1 else -0.25)
for bar in range(40, 56, 4):
    for k in FIG:
        music.add(at(bar + k), stab([n + 12 for n in CHORDS[chord_at(bar)]], 0.22, cutoff=3200), 0.32, pan=0.25 if k % 1 else -0.25)

# Letters of GETBOX: ascending plucks on eighths (8.5 … 11), the subtitle on 12.
for k, n in enumerate([65, 68, 72, 75, 77, 80]):
    music.add(at(8.5 + k * 0.5), pluck(n), 0.32, pan=-0.3 + k * 0.12)
music.add(at(12), stab([53, 60, 65, 68], 0.6, cutoff=3000), 0.4)

# Chips and highlights in the feature scenes: small blips.
for f in (16, 24, 40):
    for k in range(4 if f == 16 else 3):
        music.add(at(f + 1 + k * 0.5), pluck(77 + [0, 3, 7, 10][k], 0.18, 6000), 0.18)
for b in (24 + 1.6, 24 + 4.6, 40 + 1.6, 40 + 4.6):
    music.add(at(b), sine(hz(84), 0.12) * np.exp(-tt(0.12) * 30), 0.12)

# --- 32–40: breakdown under the checksum ---
pad_len = 8 * B + 0.5
pad = sum(supersaw(n, pad_len, voices=5, spread=0.16) for n in (41, 53, 56, 60, 63)) / 5
sweep = 300 + 2600 * np.clip(np.linspace(0, 1, len(pad)), 0, 1) ** 2
pad = svf(pad, sweep, q=1.6) * adsr(pad_len, 0.8, 1, 0.9, 0.4)
music.add(at(32), pad, 0.45)
for i in range(int((37.2 - 33) * 4)):                     # typing ticks, sixteenths
    b = 33 + i / 4
    tick = lowpass(rng.standard_normal(int(0.02 * SR)), 7000) * np.exp(-tt(0.02) * 300)
    drums.add(at(b), tick, 0.09 * rng.uniform(0.6, 1.0), pan=rng.uniform(-0.4, 0.4))
drums.add(at(37.5), kick(0.7, punch=140, low=40, decay=5), 1.0)   # the stamp
drums.add(at(37.5), clap(0.4, color=2000), 0.5)
music.add(at(37.5), stab([41, 53, 60, 65], 0.9, cutoff=2600), 0.55)
drums.add(at(38), noise_sweep(2 * B, 300, 10000), 0.3)
for k in range(8):                                        # snare roll into the drop
    drums.add(at(39 + k / 8), clap(0.1), 0.1 + k * 0.03)

# Theme changes (49 … 53): a shutter click with each cut.
for b in range(49, 54):
    drums.add(at(b), lowpass(rng.standard_normal(int(0.03 * SR)), 6000) * np.exp(-tt(0.03) * 160), 0.25)

# --- 56: call to action, the last chord rings out ---
end_len = DUR - at(56)
final = sum(supersaw(n, end_len, voices=5, spread=0.14) for n in (41, 53, 56, 60, 67)) / 5
final = lowpass(final, 2400) * adsr(end_len, 0.01, 1.5, 0.55, 1.4)
music.add(at(56), final, 0.55)
drums.add(at(56), lowpass(rng.standard_normal(int(2.5 * SR)), 10000) * np.exp(-tt(2.5) * 2.2), 0.14)
pl, pr = ping_pong(pluck(77, 0.4), B * 0.75, 0.5)
music.add(at(57), (pl, pr), 0.2)

# Sidechain: the music ducks under every kick.
duck = np.ones(m.n)
for k in kick_times:
    s = int(k * SR)
    seg_len = min(int(B * SR), m.n - s)
    duck[s:s + seg_len] = np.minimum(duck[s:s + seg_len], 1 - 0.55 * np.exp(-np.arange(seg_len) / SR * 12))
music.L *= duck
music.R *= duck

wl, wr = reverb(music.L, music.R, seconds=1.8, damp=5000)
music.L += wl * 0.22
music.R += wr * 0.22
dl, dr = reverb(drums.L, drums.R, seconds=0.9, damp=6000)
drums.L += dl * 0.08
drums.R += dr * 0.08
music.to_master(1.0)
drums.to_master(1.0)

write(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'music-kinetic13.wav'), m.L, m.R, fade_out=1.4)
