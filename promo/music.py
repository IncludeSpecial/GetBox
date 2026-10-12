"""Procedural 40 s ambient bed for the GetBox promo (96 bpm, Am-F-C-G)."""
import numpy as np, wave

SR, DUR, BPM = 44100, 40.0, 96
BEAT = 60 / BPM
t = np.arange(int(SR * DUR)) / SR
L = np.zeros_like(t); R = np.zeros_like(t)

def hz(n): return 440 * 2 ** ((n - 69) / 12)
CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]  # Am F C G
BAR = 4 * BEAT
CHORD_LEN = 2 * BAR

def env(n, a, r):
    e = np.ones(n)
    a, r = int(a * SR), int(r * SR)
    e[:a] = np.linspace(0, 1, a); e[-r:] *= np.linspace(1, 0, r)
    return e

def lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x); acc = 0.0
    for i, v in enumerate(x):  # one-pole, fine for a 40 s render
        acc = (1 - a) * v + a * acc; y[i] = acc
    return y

# Pad: detuned saws (8 harmonics), slow swells per chord.
pad_l = np.zeros_like(t); pad_r = np.zeros_like(t)
n_chords = int(np.ceil(DUR / CHORD_LEN))
for c in range(n_chords):
    s, e = int(c * CHORD_LEN * SR), min(int((c + 1) * CHORD_LEN * SR + 0.6 * SR), len(t))
    tt = t[s:e] - t[s]
    chord = CHORDS[c % 4] if c < n_chords - 1 else [57, 60, 64, 69]
    for note in chord + [chord[0] - 12]:
        for det, side in ((-0.12, 'l'), (0.12, 'r')):
            f = hz(note + det)
            saw = sum(np.sin(2 * np.pi * f * k * tt) / k for k in range(1, 9))
            sig = saw * env(e - s, 1.2, 1.4) * 0.05
            (pad_l if side == 'l' else pad_r)[s:e] += sig
L += lowpass(pad_l, 1400); R += lowpass(pad_r, 1400)

def place(buf, start, sig, gain=1.0):
    s = int(start * SR); e = min(s + len(sig), len(buf))
    if s < len(buf): buf[s:e] += sig[: e - s] * gain

# Pluck arpeggio (8ths) from the first product shot until the trust cards.
ARP = (9.4, 34.6)
step = BEAT / 2
for i in range(int((ARP[1] - ARP[0]) / step)):
    at = ARP[0] + i * step
    chord = CHORDS[int(at // CHORD_LEN) % 4]
    seq = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[1] + 24]
    n = seq[i % 4]
    tt = np.arange(int(0.6 * SR)) / SR
    tone = (np.sin(2 * np.pi * hz(n) * tt) + 0.3 * np.sin(4 * np.pi * hz(n) * tt)) * np.exp(-tt * 7)
    pan = 0.35 if i % 2 else -0.35
    fade_in = min(1, (at - ARP[0]) / 2)
    place(L, at, tone, 0.075 * (1 - pan) * fade_in); place(R, at, tone, 0.075 * (1 + pan) * fade_in)

# Soft kick on beats, hats on off-beats.
rng = np.random.default_rng(7)
for i in range(int(DUR / BEAT)):
    at = i * BEAT
    if 9.4 <= at < 34.6:
        tt = np.arange(int(0.35 * SR)) / SR
        f = 45 + 70 * np.exp(-tt * 30)
        kick = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 9)
        place(L, at, kick, 0.33); place(R, at, kick, 0.33)
    if 15.0 <= at < 34.6:
        tt = np.arange(int(0.06 * SR)) / SR
        hat = np.diff(rng.standard_normal(len(tt) + 1)) * np.exp(-tt * 70)
        place(L, at + BEAT / 2, hat, 0.03); place(R, at + BEAT / 2, hat, 0.04)

# Riser into the outro.
rs, re_ = 37.0, 38.2
tt = np.arange(int((re_ - rs) * SR)) / SR
noise = lowpass(rng.standard_normal(len(tt)), 3000) * (tt / tt[-1]) ** 2 * 0.25
place(L, rs, noise); place(R, rs, noise)

master = env(len(t), 0.8, 2.2)
L *= master; R *= master
peak = max(np.abs(L).max(), np.abs(R).max())
L, R = L / peak * 0.85, R / peak * 0.85
pcm = (np.stack([L, R], 1) * 32767).astype('<i2')
with wave.open(__import__('os').path.join(__import__('os').path.dirname(__file__), 'music.wav'), 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('music.wav', len(t) / SR, 's')
