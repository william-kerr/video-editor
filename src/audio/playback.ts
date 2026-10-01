import { audible, clipGain, end, type Project } from '../model'
import { audioContext } from '../media/import'
import { denoised } from './cache'
import processorURL from './processor.ts?worker&url'

export class AudioPlayback {
  private loaded: Promise<void> | null = null
  private nodes = new Map<string, AudioWorkletNode>()
  private sources: AudioBufferSourceNode[] = []
  private gains: { trackId: string; dry: GainNode; wet?: GainNode }[] = []
  private master: AudioWorkletNode | null = null
  private generation = 0
  private began = 0
  private offset = 0
  readonly peaks = new Map<string, number>()
  active = false

  time() { return this.offset + Math.max(0, audioContext().currentTime - this.began) }
  async start(project: Project, at: number, status: (text: string) => void) {
    this.stop()
    const generation = this.generation
    const ctx = audioContext()
    await ctx.resume()
    this.loaded ??= ctx.audioWorklet.addModule(processorURL)
    await this.loaded
    const filtered = new Map<string, AudioBuffer>()
    const needed = project.clips.filter(clip => {
      const track = project.tracks.find(t => t.id === clip.trackId)!
      return track.denoiseOn && track.denoise > 0 && audible(track, project) && end(clip) > at && project.media.find(m => m.id === clip.mediaId)?.audio
    })
    if (needed.length) status('Preparing noise reduction…')
    await Promise.all(needed.map(async clip => {
      const track = project.tracks.find(t => t.id === clip.trackId)!
      const media = project.media.find(m => m.id === clip.mediaId)!
      filtered.set(clip.id, await denoised(media, track.noiseProfile))
    }))
    if (generation !== this.generation) return false
    this.offset = at
    this.began = ctx.currentTime + .04
    this.master = this.node('mix')
    this.master.connect(ctx.destination)
    for (const track of project.tracks) {
      const node = this.node(track.id)
      node.connect(this.master)
      this.nodes.set(track.id, node)
    }
    for (const clip of project.clips) {
      const track = project.tracks.find(t => t.id === clip.trackId)!
      const media = project.media.find(m => m.id === clip.mediaId)!
      if (!media.audio || end(clip) <= at || !audible(track, project)) continue
      const start = Math.max(at, clip.start)
      const offset = clip.sourceIn + start - clip.start
      const length = Math.min(end(clip) - start, media.audio.duration - offset)
      if (length <= 0) continue
      const when = this.began + start - at
      const fade = ctx.createGain()
      fade.connect(this.nodes.get(track.id)!)
      fade.gain.setValueAtTime(clipGain(clip, start), when)
      const boundaries = [clip.start + clip.fadeIn, end(clip) - clip.fadeOut]
      if (clip.fadeIn && clip.fadeOut) boundaries.push((clip.fadeIn * end(clip) + clip.fadeOut * clip.start) / (clip.fadeIn + clip.fadeOut))
      boundaries.push(end(clip))
      for (const time of boundaries.filter(t => t > start && t <= end(clip)).sort((a, b) => a - b)) fade.gain.linearRampToValueAtTime(clipGain(clip, time), this.began + time - at)
      const source = (buffer: AudioBuffer) => {
        const source = ctx.createBufferSource()
        const gain = ctx.createGain()
        source.buffer = buffer; source.connect(gain); gain.connect(fade)
        source.start(when, offset, length)
        this.sources.push(source)
        return gain
      }
      this.gains.push({ trackId: track.id, dry: source(media.audio), wet: filtered.has(clip.id) ? source(filtered.get(clip.id)!) : undefined })
    }
    this.active = true
    this.update(project)
    return true
  }
  private node(id: string) {
    const node = new AudioWorkletNode(audioContext(), 'editor-audio', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' })
    node.port.onmessage = event => { this.peaks.set(id, event.data) }
    return node
  }
  update(project: Project) {
    this.master?.port.postMessage({ master: true, boost: project.loudnessOn ? project.loudness : 0 })
    for (const track of project.tracks) this.nodes.get(track.id)?.port.postMessage(track)
    for (const { trackId, dry, wet } of this.gains) {
      const track = project.tracks.find(t => t.id === trackId)
      if (!track) continue
      const amount = track.denoiseOn && wet ? track.denoise / 100 : 0
      const volume = audible(track, project) ? 1 : 0
      dry.gain.setTargetAtTime(volume * (1 - amount), audioContext().currentTime, .015)
      wet?.gain.setTargetAtTime(volume * amount, audioContext().currentTime, .015)
    }
  }
  stop() {
    this.generation++
    this.active = false
    for (const source of this.sources) { try { source.stop(); source.disconnect() } catch { /* Already ended. */ } }
    for (const node of this.nodes.values()) { node.port.close(); node.disconnect() }
    this.master?.port.close(); this.master?.disconnect()
    this.sources = []; this.gains = []; this.nodes.clear(); this.master = null
    this.peaks.clear()
  }
}
