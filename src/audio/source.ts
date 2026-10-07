import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from 'mediabunny'
import { type Media, uid } from '../model'
import { execute, mountFile, removeFiles, unmountFile, withFFmpeg } from '../media/ffmpeg'
import { RATE } from './dsp'
import { cachedBuffer, retainBuffers } from './buffer-cache'

export const AUDIO_CHUNK = 8
let context: AudioContext | undefined
export function audioContext() {
  if (!context || context.state === 'closed') context = new AudioContext({ sampleRate: RATE })
  return context
}

// Serialize decoding and retain only a few demuxers, including their encoded packet caches.
let queue: Promise<unknown> = Promise.resolve()
const inputs = new Map<string, { input: Input; sink: AudioBufferSink | null }>()
export function audioChunk(media: Media, index: number) {
  return cachedBuffer(`${media.id}:dry:${index}`, () => {
    const run = queue.then(() => decode(media, index * AUDIO_CHUNK, Math.min(media.duration, (index + 1) * AUDIO_CHUNK)))
    queue = run.catch(() => {})
    return run
  })
}
async function decode(media: Media, start: number, finish: number): Promise<AudioBuffer> {
  // Decode past both edges to warm the codec and resampler before trimming.
  const from = Math.max(0, start - .1), to = Math.min(media.duration, finish + .1)
  const trim = (buffer: AudioBuffer) => {
    const result = new AudioBuffer({ numberOfChannels: 2, length: Math.max(1, Math.round(finish * RATE) - Math.round(start * RATE)), sampleRate: RATE })
    const offset = Math.round((start - from) * RATE)
    for (let channel = 0; channel < 2; channel++) result.copyToChannel(buffer.getChannelData(channel).subarray(offset, offset + result.length), channel)
    return result
  }
  let source = inputs.get(media.id)
  if (!source) {
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(media.file) })
    let sink: AudioBufferSink | null = null
    try {
      const track = await input.getPrimaryAudioTrack()
      if (track && await track.canDecode()) sink = new AudioBufferSink(track)
    } catch { /* Older codecs use bounded WASM decoding below. */ }
    source = { input, sink }
  }
  inputs.delete(media.id); inputs.set(media.id, source)
  while (inputs.size > 4) {
    const [id, oldest] = inputs.entries().next().value!
    oldest.input.dispose(); inputs.delete(id)
  }
  if (source.sink) {
    try {
      let raw: AudioBuffer | null = null
      for await (const { buffer, timestamp } of source.sink.buffers(from, to)) {
        raw ??= new AudioBuffer({ numberOfChannels: 2, length: Math.max(1, Math.round((to - from) * buffer.sampleRate)), sampleRate: buffer.sampleRate })
        if (raw.sampleRate !== buffer.sampleRate) throw new Error('Audio sample rate changed within a section.')
        const at = Math.round((timestamp - from) * raw.sampleRate)
        const offset = Math.max(0, -at), destination = Math.max(0, at)
        const count = Math.min(buffer.length - offset, raw.length - destination)
        if (count <= 0) continue
        for (let channel = 0; channel < 2; channel++) raw.copyToChannel(buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1)).subarray(offset, offset + count), channel, destination)
      }
      if (!raw) return new AudioBuffer({ numberOfChannels: 2, length: Math.max(1, Math.round((finish - start) * RATE)), sampleRate: RATE })
      if (raw.sampleRate === RATE) return trim(raw)
      const offline = new OfflineAudioContext(2, Math.max(1, Math.round((to - from) * RATE)), RATE)
      const node = offline.createBufferSource()
      node.buffer = raw; node.connect(offline.destination); node.start()
      try { return trim(await offline.startRendering()) }
      finally { node.disconnect(); node.buffer = null }
    } catch { source.sink = null; source.input.dispose() }
  }
  return withFFmpeg(async ffmpeg => {
    const directory = `/audio-${uid()}`, output = `audio-${uid()}.wav`
    try {
      const input = await mountFile(ffmpeg, media.file, directory)
      await execute(ffmpeg, ['-ss', String(from), '-i', input, '-t', String(to - from), '-map', '0:a:0', '-vn', '-ac', '2', '-ar', String(RATE), '-c:a', 'pcm_f32le', output])
      const wav = await ffmpeg.readFile(output) as Uint8Array
      return trim(await audioContext().decodeAudioData(wav.buffer as ArrayBuffer))
    } finally { await removeFiles(ffmpeg, [output]); await unmountFile(ffmpeg, directory) }
  })
}

export async function audioRange(media: Media, start: number, finish: number, chunk = audioChunk): Promise<AudioBuffer> {
  start = Math.max(0, Math.min(media.duration, start))
  finish = Math.max(start, Math.min(media.duration, finish))
  const first = Math.round(start * RATE), last = Math.round(finish * RATE)
  const output = new AudioBuffer({ numberOfChannels: 2, length: Math.max(1, last - first), sampleRate: RATE })
  for (let index = Math.floor(start / AUDIO_CHUNK); index < Math.ceil(finish / AUDIO_CHUNK - 1e-9); index++) {
    const buffer = await chunk(media, index)
    const offset = index * AUDIO_CHUNK * RATE
    const from = Math.max(first, offset), to = Math.min(last, offset + buffer.length)
    if (to <= from) continue
    for (let channel = 0; channel < 2; channel++) output.copyToChannel(buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1)).subarray(from - offset, to - offset), channel, from - first)
  }
  return output
}

export async function readWaveform(media: Media) {
  const size = Math.min(12000, Math.ceil(media.duration * 100))
  const peaks = [new Float32Array(size), new Float32Array(size)]
  const frames = Math.round(media.duration * RATE)
  for (let index = 0; index * AUDIO_CHUNK < media.duration; index++) {
    const buffer = await audioChunk(media, index)
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel)
      for (let i = 0; i < data.length; i++) {
        const bin = Math.min(size - 1, Math.floor((index * AUDIO_CHUNK * RATE + i) / frames * size))
        peaks[channel][bin] = Math.max(peaks[channel][bin], Math.abs(data[i]))
      }
    }
  }
  return peaks
}

export function retainAudio(ids: Set<string>) {
  retainBuffers(ids)
  // Dispose between decode jobs so an in-flight read can finish safely.
  queue = queue.then(() => {
    for (const [id, source] of inputs) if (!ids.has(id)) { source.input.dispose(); inputs.delete(id) }
  })
}
