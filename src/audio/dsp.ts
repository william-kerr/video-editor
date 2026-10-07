export const RATE = 48000
export const CEILING = 10 ** (-1 / 20)
export interface ChannelSettings { gain: number; compression: number; compressionOn: boolean; mono: boolean }
export class ChannelProcessor {
  private envelope = 0
  private smoothedGain = 1
  process(left: Float32Array, right: Float32Array, settings: ChannelSettings) {
    const amount = settings.compressionOn ? settings.compression / 100 : 0
    const threshold = -6 - 24 * amount
    const ratio = 1 + 5 * amount
    const makeup = amount ? -threshold * (1 - 1 / ratio) * 0.5 : 0
    const targetGain = 10 ** ((settings.gain + makeup) / 20)
    const attack = Math.exp(-1 / (RATE * .008))
    const release = Math.exp(-1 / (RATE * .15))
    for (let i = 0; i < left.length; i++) {
      const peak = Math.max(Math.abs(left[i]), Math.abs(right[i]))
      const coefficient = peak > this.envelope ? attack : release
      this.envelope = coefficient * this.envelope + (1 - coefficient) * peak
      const level = 20 * Math.log10(Math.max(1e-10, this.envelope))
      const reduction = amount && level > threshold ? (threshold - level) * (1 - 1 / ratio) : 0
      this.smoothedGain += (targetGain - this.smoothedGain) * .005
      const gain = this.smoothedGain * 10 ** (reduction / 20)
      if (settings.mono) left[i] = right[i] = (left[i] + right[i]) / 2
      left[i] *= gain; right[i] *= gain
    }
  }
}
export class MixProcessor {
  private envelope = 0
  private gain = 1
  process(left: Float32Array, right: Float32Array, boost: number) {
    const release = Math.exp(-1 / (RATE * .12))
    const target = 10 ** (boost / 20)
    let peak = 0
    for (let i = 0; i < left.length; i++) {
      this.gain += (target - this.gain) * .005
      const l = left[i] * this.gain, r = right[i] * this.gain
      const value = Math.max(Math.abs(l), Math.abs(r))
      peak = Math.max(peak, value)
      this.envelope = Math.max(value, this.envelope * release)
      const reduction = Math.min(1, CEILING / Math.max(1e-10, this.envelope))
      left[i] = l * reduction; right[i] = r * reduction
    }
    return peak
  }
}
export function wavHeader(frames: number, count = 2, sampleRate = RATE) {
  const buffer = new ArrayBuffer(44)
  const view = new DataView(buffer)
  const text = (at: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)) }
  text(0, 'RIFF'); view.setUint32(4, 36 + frames * count * 2, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, count, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * count * 2, true)
  view.setUint16(32, count * 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, frames * count * 2, true)
  return new Uint8Array(buffer)
}
export function wavBytes(channels: Float32Array[], sampleRate = RATE) {
  const frames = channels[0].length, count = channels.length
  const buffer = new ArrayBuffer(44 + frames * count * 2)
  new Uint8Array(buffer).set(wavHeader(frames, count, sampleRate))
  const view = new DataView(buffer)
  for (let i = 0; i < frames; i++) for (let c = 0; c < count; c++) view.setInt16(44 + (i * count + c) * 2, Math.round(Math.max(-1, Math.min(1, channels[c][i])) * 32767), true)
  return new Uint8Array(buffer)
}
