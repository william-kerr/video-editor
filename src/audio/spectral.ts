// Spectral gating follows the desktop editor's gentle, sound-agnostic denoiser.
// See public/licenses/Noisereduce-MIT.txt for the original algorithm attribution.
import FFT from 'fft.js'
const SIZE = 2048, HOP = 256, BINS = SIZE / 2 + 1
const window = Float64Array.from({ length: SIZE }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / SIZE))
const windowSum = SIZE / 2

export function learnProfile(channels: Float32Array[]): number[] {
  const fft = new FFT(SIZE)
  const frame = new Float64Array(SIZE)
  const spectrum = fft.createComplexArray()
  const values: Float64Array[] = []
  const maximum = new Float64Array(BINS).fill(-300)
  for (let start = -SIZE / 2; start <= channels[0].length - SIZE / 2; start += HOP) {
    for (let i = 0; i < SIZE; i++) {
      const j = start + i
      frame[i] = channels.reduce((sum, c) => sum + (c[j] || 0), 0) / channels.length * window[i]
    }
    fft.realTransform(spectrum, frame)
    const db = new Float64Array(BINS)
    for (let i = 0; i < BINS; i++) {
      db[i] = 20 * Math.log10(Math.hypot(spectrum[i * 2], spectrum[i * 2 + 1]) / windowSum + Number.EPSILON)
      maximum[i] = Math.max(maximum[i], db[i])
    }
    values.push(db)
  }
  return Array.from({ length: BINS }, (_, i) => {
    const sum = values.reduce((total, db) => total + Math.max(db[i], maximum[i] - 80), 0)
    const mean = sum / values.length
    const variance = values.reduce((total, db) => total + (Math.max(db[i], maximum[i] - 80) - mean) ** 2, 0) / values.length
    return mean + 1.25 * Math.sqrt(variance)
  })
}
export function autoProfile(channels: Float32Array[]) {
  const count = Math.min(channels[0].length, 48000 * 6)
  const size = Math.min(24000, count)
  let best = 0, quietest = Infinity
  for (let start = 0; start <= count - size; start += 6000) {
    let energy = 0
    for (let i = start; i < start + size; i += 4) for (const channel of channels) energy += channel[i] ** 2
    if (energy < quietest) { quietest = energy; best = start }
  }
  return learnProfile(channels.map(c => c.slice(best, best + size)))
}
export function denoise(channels: Float32Array[], profile: number[], progress?: (value: number) => void) {
  return channels.map((channel, channelIndex) => {
    const fft = new FFT(SIZE)
    const frame = new Float64Array(SIZE)
    const transformed = fft.createComplexArray()
    const inverse = fft.createComplexArray()
    const output = new Float32Array(channel.length)
    const normalization = new Float32Array(channel.length)
    const frames: { start: number; spectrum: number[]; mask: Float64Array }[] = []
    const frequencyWeights = [1, 2, 3, 4, 3, 2, 1]
    const timeWeights = [1, 2, 3, 2, 1]
    // Keep five frames instead of a spectrum matrix for the entire recording.
    for (let start = -SIZE - HOP * 2; start < channel.length + HOP * 2; start += HOP) {
      for (let i = 0; i < SIZE; i++) frame[i] = (channel[start + i] || 0) * window[i]
      fft.realTransform(transformed, frame)
      const raw = new Float64Array(BINS)
      for (let i = 0; i < BINS; i++) raw[i] = 20 * Math.log10(Math.hypot(transformed[i * 2], transformed[i * 2 + 1]) / windowSum + Number.EPSILON) > profile[i] ? 1 : 0
      const mask = new Float64Array(BINS)
      for (let i = 0; i < BINS; i++) for (let j = -3; j <= 3; j++) mask[i] += (raw[i + j] || 0) * frequencyWeights[j + 3] / 16
      frames.push({ start, spectrum: transformed.slice(), mask })
      if (frames.length < 5) continue
      const center = frames[2]
      for (let i = 0; i < BINS; i++) {
        let gain = 0
        for (let t = 0; t < 5; t++) gain += frames[t].mask[i] * timeWeights[t] / 9
        center.spectrum[i * 2] *= gain; center.spectrum[i * 2 + 1] *= gain
      }
      fft.completeSpectrum(center.spectrum)
      fft.inverseTransform(inverse, center.spectrum)
      for (let i = Math.max(0, -center.start); i < Math.min(SIZE, channel.length - center.start); i++) {
        output[center.start + i] += inverse[i * 2] * window[i]
        normalization[center.start + i] += window[i] ** 2
      }
      frames.shift()
      if (start % (HOP * 128) === 0) progress?.((channelIndex + Math.max(0, start) / channel.length) / channels.length)
    }
    for (let i = 0; i < output.length; i++) output[i] /= Math.max(1e-8, normalization[i])
    return output
  })
}
