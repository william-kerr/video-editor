import { ALL_FORMATS, BlobSource, BufferTarget, CanvasSink, CanvasSource, Input, Mp4OutputFormat, Output, Quality, canEncodeVideo, type VideoEncodingConfig } from 'mediabunny'
import { clipGain, end, type Clip } from '../model'
import type { VideoRenderMessage, VideoRenderRequest } from './browser-export'

const send = (message: VideoRenderMessage) => self.postMessage(message)
self.onmessage = async ({ data }: MessageEvent<VideoRenderRequest>) => {
  try {
    const buffer = await render(data)
    if (buffer) self.postMessage({ type: 'complete', buffer } satisfies VideoRenderMessage, { transfer: [buffer] })
    else send({ type: 'unavailable' })
  } catch (error) { send({ type: 'unavailable', reason: error instanceof Error ? error.message : String(error) }) }
}

async function render({ width, height, fps, start, finish, clips, media }: VideoRenderRequest) {
  // Keep full output dimensions and generous variable bitrate; preview quality is independent.
  const quality = new Quality({ bitrate: Math.max(4_000_000, Math.round(width * height * fps * .3)), bitrateMode: 'variable' })
  const config: VideoEncodingConfig = { codec: 'avc', quality, latencyMode: 'quality', keyFrameInterval: 2, hardwareAcceleration: 'prefer-hardware' }
  const supports = () => canEncodeVideo('avc', { ...config, width, height, frameRate: fps })
  if (!await supports()) {
    config.hardwareAcceleration = 'no-preference'
    if (!await supports()) return null
  }
  const inputs = new Map(media.map(item => [item.id, new Input({ formats: ALL_FORMATS, source: new BlobSource(item.file) })]))
  const layers: { clip: Clip; first: number; last: number; frames: ReturnType<CanvasSink['canvasesAtTimestamps']> }[] = []
  const target = new BufferTarget()
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target })
  const length = finish - start
  const frameCount = Math.ceil(length * fps - 1e-7)
  try {
    for (const clip of clips) {
      const track = await inputs.get(clip.mediaId)!.getPrimaryVideoTrack()
      if (!track || !await track.canDecode()) return null
      const decoderConfig = await track.getDecoderConfig()
      if (decoderConfig && !decoderConfig.colorSpace?.matrix) {
        // Untagged YUV uses FFmpeg's BT.601 matrix; retain any explicit color metadata.
        // Supplying a complete configuration also avoids Chromium dropping partial color information.
        const colorSpace: VideoColorSpaceInit = {
          primaries: decoderConfig.colorSpace?.primaries ?? 'bt709', transfer: decoderConfig.colorSpace?.transfer ?? 'bt709',
          fullRange: decoderConfig.colorSpace?.fullRange ?? false, matrix: 'smpte170m',
        }
        track.getDecoderConfig = async () => ({ ...decoderConfig, colorSpace })
      }
      const firstTimestamp = await track.getFirstTimestamp()
      const first = Math.max(0, Math.ceil((clip.start - start) * fps - 1e-7))
      const last = Math.min(frameCount, Math.ceil((end(clip) - start) * fps - 1e-7))
      function* timestamps() {
        for (let frame = first; frame < last; frame++) yield Math.max(firstTimestamp, clip.sourceIn + start + frame / fps - clip.start)
      }
      // Decode sequentially, reuse a bounded pool, and honor rotation/aspect metadata.
      const sink = new CanvasSink(track, { width, height, fit: 'contain', alpha: false, poolSize: 2 })
      layers.push({ clip, first, last, frames: sink.canvasesAtTimestamps(timestamps()) })
    }
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d', { alpha: false })!
    const source = new CanvasSource(canvas, config)
    output.addVideoTrack(source, { frameRate: fps })
    await output.start()
    let lastProgress = 0
    for (let frame = 0; frame < frameCount; frame++) {
      const timestamp = frame / fps
      context.globalAlpha = 1; context.fillStyle = '#000'; context.fillRect(0, 0, width, height)
      for (const layer of layers) {
        if (frame < layer.first || frame >= layer.last) continue
        const next = await layer.frames.next()
        if (next.done || !next.value) throw new Error('A video frame could not be decoded.')
        context.globalAlpha = clipGain(layer.clip, start + timestamp)
        context.drawImage(next.value.canvas, 0, 0)
        if (frame + 1 === layer.last) await layer.frames.return()
      }
      await source.add(timestamp, Math.min(1 / fps, length - timestamp))
      if (performance.now() - lastProgress > 100 || frame + 1 === frameCount) {
        send({ type: 'progress', fraction: (frame + 1) / frameCount })
        lastProgress = performance.now()
      }
    }
    source.close()
    await output.finalize()
    return target.buffer!
  } finally {
    await Promise.allSettled(layers.map(layer => layer.frames.return()))
    for (const input of inputs.values()) input.dispose()
    if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel()
  }
}
