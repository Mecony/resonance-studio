/** Pure DSP shared by the worker and Node tests. No browser globals. */
export const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));

export function fftMagnitude(input) {
  const n = input.length;
  if (n < 2 || (n & (n - 1))) throw new Error('FFT size must be a power of two');
  const re = Float64Array.from(input), im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = -2 * Math.PI / len, wr0 = Math.cos(angle), wi0 = Math.sin(angle);
    for (let offset = 0; offset < n; offset += len) {
      let wr = 1, wi = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = offset + j, b = a + len / 2;
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const next = wr * wr0 - wi * wi0;
        wi = wr * wi0 + wi * wr0; wr = next;
      }
    }
  }
  const out = new Float32Array(n / 2 + 1);
  for (let k = 0; k < out.length; k++) out[k] = Math.hypot(re[k], im[k]) / n;
  return out;
}

function percentile(values, q = .95) {
  if (!values.length) return 0;
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
}

/** Centered Hann STFT. Bands store windowed spectral power, not calibrated SPL. */
export function analyzeAudio(samples, sampleRate, progress = () => {}) {
  if (!samples.length || !Number.isFinite(sampleRate) || sampleRate < 1000) throw new Error('Invalid audio');
  const fftSize = 2048, hop = Math.max(128, Math.round(sampleRate * .02322));
  const frames = Math.ceil(samples.length / hop) + 1, binCount = 64;
  const rms = new Float32Array(frames), low = new Float32Array(frames);
  const mid = new Float32Array(frames), high = new Float32Array(frames), onset = new Float32Array(frames);
  const spectrum = new Float32Array(frames * binCount), window = new Float32Array(fftSize);
  const buffer = new Float32Array(fftSize), waveform = new Float32Array(240);
  const previous = new Float32Array(fftSize / 2 + 1);
  const topFrequency = Math.min(12000, sampleRate / 2);
  for (let i = 0; i < fftSize; i++) window[i] = .5 - .5 * Math.cos(2 * Math.PI * i / (fftSize - 1));
  for (let b = 0; b < waveform.length; b++) {
    const start = Math.floor(b * samples.length / waveform.length);
    const end = Math.max(start + 1, Math.floor((b + 1) * samples.length / waveform.length));
    let sum = 0;
    for (let i = start; i < Math.min(end, samples.length); i++) sum += samples[i] ** 2;
    waveform[b] = Math.sqrt(sum / Math.max(1, Math.min(end, samples.length) - start));
  }
  for (let f = 0; f < frames; f++) {
    const start = f * hop - fftSize / 2;
    let sum = 0;
    for (let i = 0; i < fftSize; i++) {
      const x = samples[start + i] ?? 0;
      sum += x * x; buffer[i] = x * window[i];
    }
    rms[f] = Math.sqrt(sum / fftSize);
    const mags = fftMagnitude(buffer);
    let flux = 0;
    for (let k = 1; k < mags.length; k++) {
      const hz = k * sampleRate / fftSize, p = mags[k] ** 2;
      if (hz >= 40 && hz < 250) low[f] += p;
      else if (hz >= 250 && hz < 2000) mid[f] += p;
      else if (hz >= 2000 && hz <= Math.min(10000, sampleRate / 2)) high[f] += p;
      flux += Math.max(0, mags[k] - previous[k]); previous[k] = mags[k];
    }
    onset[f] = f ? flux : 0;
    for (let b = 0; b < binCount; b++) {
      const a = 40 * (topFrequency / 40) ** (b / binCount);
      const z = 40 * (topFrequency / 40) ** ((b + 1) / binCount);
      const ka = Math.max(1, Math.floor(a * fftSize / sampleRate));
      const kz = Math.min(mags.length - 1, Math.max(ka, Math.ceil(z * fftSize / sampleRate)));
      let power = 0;
      for (let k = ka; k <= kz; k++) power += mags[k] ** 2;
      spectrum[f * binCount + b] = Math.sqrt(power / Math.max(1, kz - ka + 1));
    }
    if (f % 80 === 0) progress(f / frames);
  }
  const rawRms = rms.slice();
  const smoothFrames = Math.max(1, Math.round(.06 / (hop / sampleRate)));
  for (const array of [low, mid, high]) for (let i = 0; i < array.length; i++) array[i] = Math.sqrt(array[i]);
  const bandScale = Math.max(percentile(low), percentile(mid), percentile(high)) || 1;
  for (const array of [rms, low, mid, high, onset]) {
    const isBand = array === low || array === mid || array === high;
    const scale = isBand ? bandScale : percentile(array) || 1;
    let value = 0;
    for (let i = 0; i < array.length; i++) {
      const target = clamp(array[i] / scale);
      value += (target - value) * (array === onset ? .65 : 1 / smoothFrames);
      array[i] = value;
    }
  }
  const spectrumScale = percentile(spectrum, .99) || 1;
  for (let i = 0; i < spectrum.length; i++) spectrum[i] = clamp(Math.sqrt(spectrum[i] / spectrumScale));
  const waveScale = Math.max(...waveform) || 1;
  for (let i = 0; i < waveform.length; i++) waveform[i] /= waveScale;
  progress(1);
  return { frames, hop, sampleRate, fftSize, binCount, rms, rawRms, low, mid, high, onset, spectrum, waveform };
}

export function featureAt(data, time) {
  const x = clamp(time * data.sampleRate / data.hop, 0, data.frames - 1);
  const a = Math.floor(x), b = Math.min(a + 1, data.frames - 1), u = x - a;
  const result = {};
  for (const name of ['rms', 'rawRms', 'low', 'mid', 'high', 'onset']) result[name] = data[name][a] * (1 - u) + data[name][b] * u;
  result.spectrum = new Float32Array(data.binCount);
  for (let k = 0; k < data.binCount; k++) result.spectrum[k] = data.spectrum[a * data.binCount + k] * (1 - u) + data.spectrum[b * data.binCount + k] * u;
  return result;
}

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/** Original procedural demo composition: 16 bars, 100 BPM, A minor. */
export function synthesizeDemo(sampleRate = 22050) {
  const beat = .6, duration = beat * 64, samples = new Float32Array(Math.round(sampleRate * duration));
  const rng = seededRandom(7031), chords = [[57,60,64],[53,57,60],[60,64,67],[55,59,62]];
  const hz = midi => 440 * 2 ** ((midi - 69) / 12);
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate, bar = Math.floor(t / (4 * beat));
    const chord = chords[bar % 4], bt = t % beat, half = t % (beat / 2);
    let x = 0;
    for (let n = 0; n < 3; n++) {
      const f = hz(chord[n]);
      const envelope = Math.min(1, (t % (beat * 4)) / .25) * Math.min(1, (beat * 4 - t % (beat * 4)) / .4);
      x += .045 * envelope * (Math.sin(2 * Math.PI * f * t) + .3 * Math.sin(2 * Math.PI * f * 1.003 * t));
    }
    const step = Math.floor(t / (beat / 2)), arp = hz(chord[step % 3] + 12);
    x += .13 * Math.exp(-half * 10) * (Math.sin(2 * Math.PI * arp * t) + .2 * Math.sin(4 * Math.PI * arp * t));
    x += .12 * Math.exp(-bt * 5) * Math.sin(2 * Math.PI * hz(chord[0] - 24) * t);
    x += .28 * Math.exp(-bt * 25) * Math.sin(2 * Math.PI * (45 * bt + 2.5 * (1 - Math.exp(-bt * 28))));
    const noise = rng() * 2 - 1;
    x += .035 * Math.exp(-half * 75) * noise;
    if (Math.floor(t / beat) % 2) x += .06 * Math.exp(-bt * 30) * noise;
    const fade = Math.min(1, t / .4, (duration - t) / 1.8);
    samples[i] = Math.tanh(x * 1.25) * fade;
  }
  return { samples, sampleRate, duration };
}

export function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2), view = new DataView(buffer);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  str(0,'RIFF'); view.setUint32(4,36 + samples.length * 2,true); str(8,'WAVE'); str(12,'fmt ');
  view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true); view.setUint32(24,sampleRate,true);
  view.setUint32(28,sampleRate * 2,true); view.setUint16(32,2,true); view.setUint16(34,16,true); str(36,'data');
  view.setUint32(40,samples.length * 2,true);
  for (let i = 0; i < samples.length; i++) { const x = clamp(samples[i],-1,1); view.setInt16(44 + i * 2, x < 0 ? x * 32768 : x * 32767, true); }
  return buffer;
}
