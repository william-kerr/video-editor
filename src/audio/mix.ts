import { ChannelProcessor, MixProcessor, RATE, wavBytes } from './dsp'
import { clipGain, duration, type Clip, type Track } from '../model'

export interface MixClip { clip: Clip; track: Track; dry: Float32Array[]; wet?: Float32Array[]; sourceStart?: number }
export interface MixRequest { clips: MixClip[]; start: number; finish: number; loudness: number; tracks?: Track[]; frames?: number }
export const newMixState = () => ({ tracks: new Map<string, { processor: ChannelProcessor; track: Track }>(), master: new MixProcessor() })
export function mixAudio({ clips, start, finish, loudness, tracks = clips.map(item => item.track), frames }: MixRequest, state = newMixState()) {
  const count = frames ?? Math.ceil((finish - start) * RATE)
  const mixed = [new Float32Array(count), new Float32Array(count)]
  for (const track of tracks) {
    const current = state.tracks.get(track.id)
    if (current) current.track = track
    else state.tracks.set(track.id, { processor: new ChannelProcessor(), track })
  }
  for (const id of state.tracks.keys()) {
    const { processor, track } = state.tracks.get(id)!
    const trackClips = clips.filter(c => c.track.id === id)
    for (let block = 0; block < count; block += 2048) {
      const size = Math.min(2048, count - block)
      const channels = [new Float32Array(size), new Float32Array(size)]
      for (const { clip, dry, wet, sourceStart = 0, track } of trackClips) {
        const amount = track.denoiseOn ? track.denoise / 100 : 0
        for (let i = 0; i < size; i++) {
          const time = start + (block + i) / RATE
          if (time < clip.start || time >= clip.start + duration(clip)) continue
          const source = Math.round((clip.sourceIn + time - clip.start - sourceStart) * RATE)
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
  state.master.process(mixed[0], mixed[1], loudness)
  return wavBytes(mixed)
}
