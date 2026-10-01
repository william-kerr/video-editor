import { ChannelProcessor, MixProcessor, RATE, wavBytes } from './dsp'
import { clipGain, duration, type Clip, type Track } from '../model'

export interface MixClip { clip: Clip; track: Track; dry: Float32Array[]; wet?: Float32Array[] }
export interface MixRequest { clips: MixClip[]; start: number; finish: number; loudness: number }
export function mixAudio({ clips, start, finish, loudness }: MixRequest) {
  const count = Math.ceil((finish - start) * RATE)
  const mixed = [new Float32Array(count), new Float32Array(count)]
  const tracks = [...new Map(clips.map(c => [c.track.id, c.track])).values()]
  for (const track of tracks) {
    const processor = new ChannelProcessor()
    const trackClips = clips.filter(c => c.track.id === track.id)
    for (let block = 0; block < count; block += 2048) {
      const size = Math.min(2048, count - block)
      const channels = [new Float32Array(size), new Float32Array(size)]
      for (const { clip, dry, wet } of trackClips) {
        const amount = track.denoiseOn ? track.denoise / 100 : 0
        for (let i = 0; i < size; i++) {
          const time = start + (block + i) / RATE
          if (time < clip.start || time >= clip.start + duration(clip)) continue
          const source = Math.round((clip.sourceIn + time - clip.start) * RATE)
          const fade = clipGain(clip, time)
          for (let c = 0; c < 2; c++) {
            const value = dry[Math.min(c, dry.length - 1)][source] || 0
            const filtered = wet?.[Math.min(c, wet.length - 1)][source] ?? value
            channels[c][i] += (value + amount * (filtered - value)) * fade
          }
        }
      }
      processor.process(channels[0], channels[1], track)
      for (let c = 0; c < 2; c++) for (let i = 0; i < size; i++) mixed[c][block + i] += channels[c][i]
    }
  }
  new MixProcessor().process(mixed[0], mixed[1], loudness)
  return wavBytes(mixed)
}
