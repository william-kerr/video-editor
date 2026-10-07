import { clipGain, audible, end, timelineEnd, type Clip, type Project } from '../model'
import { audioContext, audioRange } from './source'
import { denoised } from './cache'
import processorURL from './processor.ts?worker&url'

interface Voice { trackId: string; sources: AudioBufferSourceNode[]; dry: GainNode; wet?: GainNode; fade: GainNode }
interface Prepared { clip: Clip; dry: AudioBuffer; wet?: AudioBuffer; start: number; finish: number }

export class AudioPlayback {
  private context: AudioContext | null = null
  private loaded: Promise<void> | null = null
  private nodes = new Map<string, AudioWorkletNode>()
  private voices = new Set<Voice>()
  private master: AudioWorkletNode | null = null
  private generation = 0
  private began = 0
  private offset = 0
  private timer = 0
  private project: Project | null = null
  readonly peaks = new Map<string, number>()
  onerror: (error: Error) => void = () => {}
  active = false

  time() { return this.offset + Math.max(0, (this.context?.currentTime ?? 0) - this.began) }
  async start(project: Project, at: number, status: (text: string) => void) {
    this.stop()
    const generation = this.generation
    const ctx = audioContext()
    if (this.context !== ctx) { this.context = ctx; this.loaded = null }
    await ctx.resume()
    if (generation !== this.generation) return false
    this.loaded ??= ctx.audioWorklet.addModule(processorURL).catch(error => { this.loaded = null; throw error })
    await this.loaded
    if (generation !== this.generation) return false
    status('Preparing audio…')
    this.project = project
    const finish = timelineEnd(project)
    let next = Math.min(finish, at + 4)
    const prepared = await this.prepare(project, at, next, generation)
    if (generation !== this.generation) return false
    this.offset = at; this.began = ctx.currentTime + .06
    this.master = this.node('mix')
    this.master.connect(ctx.destination)
    for (const track of project.tracks) {
      const node = this.node(track.id)
      node.connect(this.master); this.nodes.set(track.id, node)
    }
    this.schedule(prepared)
    this.active = true
    this.update(project)
    ctx.onstatechange = () => {
      if (this.active && ctx.state !== 'running') this.fail(new Error('Audio playback was interrupted. Press Play to resume.'))
    }
    const pump = async () => {
      try {
        while (generation === this.generation && next < finish && next < this.time() + 8) {
          const to = Math.min(finish, next + 4)
          const prepared = await this.prepare(this.project!, next, to, generation)
          if (generation !== this.generation) return
          this.schedule(prepared); this.update(this.project!)
          next = to
        }
        if (generation === this.generation && next < finish) this.timer = window.setTimeout(() => void pump(), 100)
      } catch (error) { if (generation === this.generation) this.fail(error instanceof Error ? error : new Error(String(error))) }
    }
    void pump()
    return true
  }
  private async prepare(project: Project, start: number, finish: number, generation: number) {
    const prepared: Prepared[] = []
    for (const clip of project.clips) {
      if (generation !== this.generation) break
      const track = project.tracks.find(t => t.id === clip.trackId)!
      const media = project.media.find(m => m.id === clip.mediaId)!
      if (!media.hasAudio || end(clip) <= start || clip.start >= finish) continue
      const from = Math.max(start, clip.start), to = Math.min(finish, end(clip))
      const sourceStart = clip.sourceIn + from - clip.start, sourceEnd = clip.sourceIn + to - clip.start
      const dry = await audioRange(media, sourceStart, sourceEnd)
      if (generation !== this.generation) break
      const wet = track.denoiseOn && track.denoise > 0 ? await audioRange(media, sourceStart, sourceEnd, (media, index) => denoised(media, index, track.noiseProfile)) : undefined
      prepared.push({ clip, dry, wet, start: from, finish: to })
    }
    return prepared
  }
  private schedule(prepared: Prepared[]) {
    const ctx = this.context!
    for (const { clip, dry, wet, start, finish } of prepared) {
      const when = this.began + start - this.offset
      const late = Math.max(0, ctx.currentTime - when)
      if (late >= finish - start) continue
      const fade = ctx.createGain()
      fade.connect(this.nodes.get(clip.trackId)!)
      fade.gain.setValueAtTime(clipGain(clip, start + late), when + late)
      const boundaries = [clip.start + clip.fadeIn, end(clip) - clip.fadeOut, finish]
      if (clip.fadeIn && clip.fadeOut) boundaries.push((clip.fadeIn * end(clip) + clip.fadeOut * clip.start) / (clip.fadeIn + clip.fadeOut))
      for (const time of boundaries.filter(t => t > start + late && t <= finish).sort((a, b) => a - b)) fade.gain.linearRampToValueAtTime(clipGain(clip, time), this.began + time - this.offset)
      const sources: AudioBufferSourceNode[] = []
      const source = (buffer: AudioBuffer) => {
        const node = ctx.createBufferSource(), gain = ctx.createGain()
        node.buffer = buffer; node.connect(gain); gain.connect(fade)
        node.start(when + late, late, finish - start - late)
        sources.push(node)
        return gain
      }
      const voice: Voice = { trackId: clip.trackId, sources, dry: source(dry), wet: wet ? source(wet) : undefined, fade }
      this.voices.add(voice)
      let remaining = sources.length
      for (const node of sources) node.onended = () => { if (--remaining === 0) this.release(voice) }
    }
  }
  private release(voice: Voice) {
    for (const source of voice.sources) {
      source.onended = null
      try { source.stop() } catch { /* Already ended. */ }
      source.disconnect(); source.buffer = null
    }
    voice.dry.disconnect(); voice.wet?.disconnect(); voice.fade.disconnect()
    this.voices.delete(voice)
  }
  private node(id: string) {
    const node = new AudioWorkletNode(this.context!, 'editor-audio', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' })
    node.port.onmessage = event => { this.peaks.set(id, event.data) }
    node.onprocessorerror = () => this.fail(new Error('The audio processor stopped. Press Play to restart it.'))
    return node
  }
  private fail(error: Error) { this.stop(); this.onerror(error) }
  update(project: Project) {
    this.project = project
    this.master?.port.postMessage({ master: true, boost: project.loudnessOn ? project.loudness : 0 })
    for (const track of project.tracks) this.nodes.get(track.id)?.port.postMessage(track)
    for (const { trackId, dry, wet } of this.voices) {
      const track = project.tracks.find(t => t.id === trackId)
      if (!track) continue
      const amount = track.denoiseOn && wet ? track.denoise / 100 : 0
      const volume = audible(track, project) ? 1 : 0
      dry.gain.setTargetAtTime(volume * (1 - amount), this.context!.currentTime, .015)
      wet?.gain.setTargetAtTime(volume * amount, this.context!.currentTime, .015)
    }
  }
  stop() {
    this.generation++; this.active = false
    clearTimeout(this.timer)
    if (this.context) this.context.onstatechange = null
    for (const voice of this.voices) this.release(voice)
    for (const node of [...this.nodes.values(), ...(this.master ? [this.master] : [])]) {
      node.onprocessorerror = null; node.port.onmessage = null
      node.port.postMessage({ dispose: true }); node.port.close(); node.disconnect()
    }
    this.nodes.clear(); this.master = null; this.project = null; this.peaks.clear()
  }
}
