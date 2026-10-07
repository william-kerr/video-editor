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

test('sectioned export preserves samples, source offsets and dynamics across gaps', async () => {
  const { newMixState } = await import('../../src/audio/mix')
  const track = { ...newTrack('audio'), compression: 65, compressionOn: true, gain: 6 }
  const laterTrack = { ...newTrack('audio'), gain: -12 }
  const dry = [Float32Array.from({ length: 48000 * 12 }, (_, i) => .5 * Math.sin(i * .03))]
  const clip: Clip = { id: 'c', mediaId: 'm', trackId: track.id, start: 0, sourceIn: 1, sourceOut: 5, fadeIn: .2, fadeOut: 1 }
  const clips = [{ clip, track, dry }, { clip: { ...clip, id: 'd', start: 8, sourceIn: 6, sourceOut: 10 }, track, dry }, { clip: { ...clip, id: 'e', start: 8, sourceIn: 6, sourceOut: 10, fadeIn: 0, trackId: laterTrack.id }, track: laterTrack, dry }]
  const whole = mixAudio({ clips, start: 0, finish: 12, loudness: 8 })
  const state = newMixState()
  const parts = []
  for (let start = 0; start < 12; start += 4) {
    const section = clips.filter(({ clip }) => clip.start < start + 4 && clip.start + 4 > start).map(item => ({
      ...item, sourceStart: item.clip.sourceIn, dry: item.dry.map(channel => channel.slice(item.clip.sourceIn * 48000, item.clip.sourceOut * 48000)),
    }))
    parts.push(mixAudio({ clips: section, tracks: [track, laterTrack], start, finish: start + 4, loudness: 8 }, state).subarray(44))
  }
  assert.deepEqual(Buffer.concat(parts), Buffer.from(whole.subarray(44)))
})

test('stopped worklets retire instead of processing silence forever', async () => {
  const { readFile } = await import('node:fs/promises')
  const { runInNewContext } = await import('node:vm')
  const { transform } = await import('esbuild')
  const dsp = await import('../../src/audio/dsp')
  let Processor: any
  const source = await readFile(new URL('../../src/audio/processor.ts', import.meta.url), 'utf8')
  const { code } = await transform(source, { loader: 'ts', format: 'cjs', target: 'es2022' })
  runInNewContext(code, {
    exports: {}, require: () => dsp, sampleRate: 48000,
    AudioWorkletProcessor: class { port = { onmessage: null, postMessage() {}, close() {} } },
    registerProcessor: (_: string, value: any) => { Processor = value },
  })
  const processor = new Processor()
  const output = [[new Float32Array(128).fill(1), new Float32Array(128).fill(1)]]
  assert.equal(processor.process([[]], output), true)
  assert.equal(output[0][0].every(value => value === 0), true)
  processor.port.onmessage({ data: { dispose: true } })
  assert.equal(processor.process([[]], output), false)
})

test('decoded audio cache shares pending reads and evicts old buffers within its memory budget', async () => {
  const { cachedBuffer, retainBuffers } = await import('../../src/audio/buffer-cache')
  retainBuffers(new Set())
  let reads = 0
  const decode = async () => { reads++; return { length: 2 * 1024 * 1024, numberOfChannels: 2 } as AudioBuffer }
  const [first, same] = await Promise.all([cachedBuffer('a:dry:0', decode), cachedBuffer('a:dry:0', decode)])
  assert.equal(first, same)
  assert.equal(reads, 1)
  for (let i = 1; i <= 4; i++) await cachedBuffer(`a:dry:${i}`, decode)
  await cachedBuffer('a:dry:4', decode)
  assert.equal(reads, 5)
  await cachedBuffer('a:dry:0', decode)
  assert.equal(reads, 6)
  retainBuffers(new Set())
  await cachedBuffer('a:dry:0', decode)
  assert.equal(reads, 7)
})
