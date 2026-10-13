"""Tiny numpy synth shared by the style promos (kinetic13, synth13, lofi13).

Everything is generated: oscillators, drums, filters, a convolution reverb with a
synthetic impulse response. Output is 48 kHz stereo, the rate most players expect.
"""
import wave

import numpy as np

SR = 48000
rng = np.random.default_rng(13)


def hz(note):
    return 440.0 * 2 ** ((np.asarray(note, dtype=float) - 69) / 12)


def tt(length):
    return np.arange(int(length * SR)) / SR


class Mix:
    def __init__(self, duration):
        self.n = int(duration * SR)
        self.L = np.zeros(self.n)
        self.R = np.zeros(self.n)

    def add(self, start, sig, gain=1.0, pan=0.0):
        """Place a mono (or (L, R) tuple) signal at `start` seconds; pan -1 … 1."""
        s = int(round(start * SR))
        if s >= self.n:
            return
        if isinstance(sig, tuple):
            left, right = sig
        else:
            left = right = sig
        cut = 0 if s >= 0 else -s
        s = max(s, 0)
        e = min(s + len(left) - cut, self.n)
        if e <= s:
            return
        self.L[s:e] += left[cut:cut + e - s] * gain * min(1, 1 - pan)
        self.R[s:e] += right[cut:cut + e - s] * gain * min(1, 1 + pan)

    def bus(self):
        return Bus(self)


class Bus(Mix):
    """A sub-mix that can be processed (filtered, reverbed) before it joins the master."""

    def __init__(self, master):
        self.master = master
        self.n = master.n
        self.L = np.zeros(self.n)
        self.R = np.zeros(self.n)

    def to_master(self, gain=1.0):
        self.master.L += self.L * gain
        self.master.R += self.R * gain


# ---------- filters and effects ----------

def lowpass(x, cutoff):
    """One-pole lowpass; cutoff may be a per-sample array for sweeps."""
    cutoff = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    a = np.exp(-2 * np.pi * np.clip(cutoff, 5, SR / 2.2) / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = (1 - a[i]) * x[i] + a[i] * acc
        y[i] = acc
    return y


def highpass(x, cutoff):
    return x - lowpass(x, cutoff)


def svf(x, cutoff, q=0.7, mode='lp'):
    """Resonant state-variable filter (Chamberlin); cutoff may be an array."""
    cutoff = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    f = 2 * np.sin(np.pi * np.clip(cutoff, 20, SR / 6) / SR)
    damp = 1 / max(q, 0.5)
    low = band = 0.0
    out = np.empty_like(x)
    for i in range(len(x)):
        low += f[i] * band
        high = x[i] - low - damp * band
        band += f[i] * high
        out[i] = low if mode == 'lp' else band if mode == 'bp' else high
    return out


def _fft_convolve(x, ir):
    n = len(x) + len(ir) - 1
    size = 1 << (n - 1).bit_length()
    y = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)
    return y[:len(x)]


def reverb(L, R, seconds=2.2, damp=4000, predelay=0.02):
    """Stereo convolution reverb with a decaying-noise impulse response; returns the wet signal."""
    t = tt(seconds)
    env = np.exp(-t * 6.9 / seconds)
    pre = np.zeros(int(predelay * SR))
    irl = np.concatenate([pre, lowpass(rng.standard_normal(len(t)), damp) * env])
    irr = np.concatenate([pre, lowpass(rng.standard_normal(len(t)), damp) * env])
    irl /= np.sqrt(np.sum(irl ** 2))
    irr /= np.sqrt(np.sum(irr ** 2))
    return _fft_convolve(L, irl), _fft_convolve(R, irr)


def delay(x, seconds, feedback=0.4, taps=5):
    y = x.copy()
    d = int(seconds * SR)
    for k in range(1, taps + 1):
        if d * k >= len(x):
            break
        y[d * k:] += x[:-d * k] * feedback ** k
    return y


def ping_pong(x, seconds, feedback=0.45, taps=6):
    L, R = x.copy(), x.copy()
    d = int(seconds * SR)
    for k in range(1, taps + 1):
        if d * k >= len(x):
            break
        tgt = L if k % 2 == 0 else R
        tgt[d * k:] += x[:-d * k] * feedback ** k
    return L, R


# ---------- oscillators ----------

def phase(freq, length):
    freq = np.broadcast_to(np.asarray(freq, dtype=float), (int(length * SR),))
    return np.cumsum(freq) / SR


def sine(freq, length):
    return np.sin(2 * np.pi * phase(freq, length))


def saw(freq, length):
    p = phase(freq, length)
    return 2 * (p - np.floor(p + 0.5))


def square(freq, length, width=0.5):
    p = phase(freq, length)
    return np.where((p % 1) < width, 1.0, -1.0)


def tri(freq, length):
    return 2 * np.abs(saw(freq, length)) - 1


def adsr(length, a=0.005, d=0.1, s=0.7, r=0.1):
    n = int(length * SR)
    t = np.arange(n) / SR
    env = np.where(t < a, t / max(a, 1e-6), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-6)))
    rel = int(r * SR)
    if rel and n > rel:
        env[-rel:] *= np.linspace(1, 0, rel)
    return env


def supersaw(note, length, voices=5, spread=0.12):
    out = np.zeros(int(length * SR))
    for k in range(voices):
        det = (k - (voices - 1) / 2) * spread / max(voices - 1, 1) * 2
        out += saw(hz(note + det), length) * (1 / voices)
    return out


# ---------- drums ----------

def kick(length=0.45, punch=110, low=46, decay=7.0, click=0.6):
    t = tt(length)
    f = low + punch * np.exp(-t * 28)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * decay)
    c = rng.standard_normal(len(t)) * np.exp(-t * 400) * click
    return np.tanh((body + c) * 1.4)


def snare(length=0.3, tone=190, noise_decay=18, color=5000):
    t = tt(length)
    body = np.sin(2 * np.pi * tone * t) * np.exp(-t * 25) * 0.6
    n = lowpass(rng.standard_normal(len(t)), color) * np.exp(-t * noise_decay)
    return body + n


def clap(length=0.25, color=2600):
    t = tt(length)
    env = sum(np.exp(-np.clip(t - d, 0, None) * 60) * (t >= d) for d in (0, 0.011, 0.022))
    env += np.exp(-np.clip(t - 0.03, 0, None) * 14) * (t >= 0.03) * 0.5
    return highpass(lowpass(rng.standard_normal(len(t)), color * 1.6), color * 0.4) * env


def hat(length=0.06, decay=60, color=9000):
    t = tt(length)
    n = rng.standard_normal(len(t))
    return highpass(n, color) * np.exp(-t * decay)


def noise_sweep(length, f0=300, f1=8000, rise=True):
    """Filtered-noise riser (or fall when rise=False)."""
    t = tt(length)
    k = t / t[-1]
    shape = k ** 2 if rise else (1 - k) ** 2
    cut = f0 + (f1 - f0) * (k ** 2 if rise else 1 - k)
    return lowpass(rng.standard_normal(len(t)), cut) * shape


def swoosh(length=0.5, center=0.5):
    """Band-passed noise that swells to `center` (0…1 of length) and falls away — a wipe."""
    t = tt(length)
    k = t / t[-1]
    env = np.where(k < center, (k / center) ** 2, ((1 - k) / (1 - center)) ** 1.5)
    cut = 500 + 7000 * np.where(k < center, k / center, (1 - k) / (1 - center))
    return svf(rng.standard_normal(len(t)), cut, q=2.5, mode='bp') * env


def vinyl(length, density=7, level=1.0):
    """Crackle and soft hiss of a record."""
    n = int(length * SR)
    out = lowpass(rng.standard_normal(n), 3500) * 0.02
    count = int(length * density)
    pos = rng.integers(0, n - 200, count)
    for p in pos:
        k = rng.uniform(0.2, 1.0)
        out[p:p + 60] += rng.standard_normal(60) * np.exp(-np.arange(60) / 8) * k
    return highpass(out, 600) * level


# ---------- output ----------

def write(path, L, R, fade_in=0.05, fade_out=2.0, drive=1.15, peak=0.89):
    n = len(L)
    env = np.ones(n)
    fi, fo = int(fade_in * SR), int(fade_out * SR)
    if fi:
        env[:fi] = np.linspace(0, 1, fi)
    if fo:
        env[-fo:] = np.linspace(1, 0, fo) ** 1.5
    L = np.tanh(L * drive) * env
    R = np.tanh(R * drive) * env
    m = max(np.abs(L).max(), np.abs(R).max(), 1e-9)
    L, R = L / m * peak, R / m * peak
    pcm = (np.stack([L, R], 1) * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(path, round(n / SR, 2), 's')
