import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CEILING, ChannelProcessor, MixProcessor } from '../../src/audio/dsp'
import { denoise, learnProfile } from '../../src/audio/spectral'
import { mixAudio } from '../../src/audio/mix'
import { newTrack, type Clip } from '../../src/model'

test('master limits the combined stereo mix to −1 dB', () => {
  const left = Float32Array.from({ length: 48000 }, (_, i) => 1.8 * Math.sin(i * .07))
  const right = Float32Array.from(left, value => value * .5)
  new MixProcessor().process(left, right, 18)
  assert.ok(Math.max(...left.map(Math.abs)) <= CEILING + 1e-6)
  for (let i = 3000; i < 48000; i += 1000) assert.ok(Math.abs(right[i] - left[i] * .5) < 1e-5)
})
test('compression makes sustained louder passages less dynamic', () => {
  const track = newTrack('audio')
  const run = (level: number) => {
    const l = new Float32Array(48000).fill(level), r = l.slice()
    new ChannelProcessor().process(l, r, { ...track, compression: 80, compressionOn: true })
    return l[47999]
  }
  assert.ok(run(.8) / run(.1) < 2)
})
test('spectral noise learning reduces stationary noise but preserves a new tone', () => {
  let seed = 17
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1 }
  const noise = Float32Array.from({ length: 24000 }, () => random() * .06)
  const profile = learnProfile([noise, noise])
  const audio = Float32Array.from({ length: 48000 }, (_, i) => random() * .06 + (i > 24000 ? .3 * Math.sin(2 * Math.PI * 2000 * i / 48000) : 0))
  const clean = denoise([audio], profile)[0]
  const rms = (array: Float32Array, a: number, b: number) => Math.sqrt(array.slice(a, b).reduce((s, v) => s + v * v, 0) / (b - a))
  assert.ok(rms(clean, 3000, 20000) < rms(audio, 3000, 20000) * .55)
  assert.ok(rms(clean, 28000, 44000) > .1)
  assert.equal(Array.from(clean).every(Number.isFinite), true)
})
test('export mixes overlapping tracks before applying the ceiling limiter', () => {
  const track = newTrack('audio')
  const clip: Clip = { id: 'c', mediaId: 'm', trackId: track.id, start: 0, sourceIn: 0, sourceOut: 1, fadeIn: .1, fadeOut: .1 }
  const dry = [new Float32Array(48000).fill(.8)]
  const wav = mixAudio({ start: 0, finish: 1, loudness: 12, clips: [{ clip, dry, track }, { clip: { ...clip, id: 'd' }, dry, track: newTrack('audio') }] })
  const view = new DataView(wav.buffer)
  assert.equal(view.getUint32(24, true), 48000)
  assert.equal(view.getInt16(44, true), 0)
  let peak = 0
  for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(view.getInt16(i, true)) / 32767)
  assert.ok(peak <= CEILING + 1 / 32767)
  assert.ok(peak > .85)
})
