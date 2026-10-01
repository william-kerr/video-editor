import { ChannelProcessor, MixProcessor, type ChannelSettings } from './dsp'

declare const sampleRate: number
declare abstract class AudioWorkletProcessor {
  port: MessagePort
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void

class EditorAudio extends AudioWorkletProcessor {
  private channel = new ChannelProcessor()
  private mix = new MixProcessor()
  private settings: ChannelSettings & { master?: boolean; boost?: number } = { gain: 0, compression: 0, compressionOn: false, mono: false }
  private frames = 0
  private peak = 0
  constructor() {
    super()
    this.port.onmessage = event => { this.settings = event.data }
  }
  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    const output = outputs[0]
    if (!output?.[0]) return true
    const left = output[0], right = output[1] || output[0]
    left.set(inputs[0]?.[0] || new Float32Array(left.length))
    right.set(inputs[0]?.[1] || inputs[0]?.[0] || new Float32Array(right.length))
    if (this.settings.master) this.peak = Math.max(this.peak, this.mix.process(left, right, this.settings.boost || 0))
    else {
      this.channel.process(left, right, this.settings)
      for (let i = 0; i < left.length; i++) this.peak = Math.max(this.peak, Math.abs(left[i]), Math.abs(right[i]))
    }
    this.frames += left.length
    if (this.frames >= sampleRate / 20) { this.port.postMessage(this.peak); this.peak = 0; this.frames = 0 }
    return true
  }
}
registerProcessor('editor-audio', EditorAudio)
