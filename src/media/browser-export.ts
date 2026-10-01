import { canvasSize, end, exportRange, type Clip, type Project } from '../model'

export interface VideoRenderRequest {
  width: number; height: number; fps: number; start: number; finish: number
  clips: Clip[]; media: { id: string; file: File }[]
}
export type VideoRenderMessage = { type: 'progress'; fraction: number } | { type: 'complete'; buffer: ArrayBuffer } | { type: 'unavailable'; reason?: string }

export function renderBrowserVideo(project: Project, progress: (fraction: number) => void, signal: AbortSignal): Promise<Uint8Array | null> {
  signal.throwIfAborted()
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined' || typeof OffscreenCanvas === 'undefined') return Promise.resolve(null)
  const [start, finish] = exportRange(project)
  const clips = project.tracks.filter(t => t.kind === 'video').slice().reverse().flatMap(track => project.clips.filter(c => c.trackId === track.id && end(c) > start && c.start < finish))
  const request: VideoRenderRequest = { ...canvasSize(project), start, finish, clips, media: project.media.filter(m => clips.some(c => c.mediaId === m.id)).map(({ id, file }) => ({ id, file })) }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./video-export.worker.ts', import.meta.url), { type: 'module' })
    const cleanup = () => { worker.terminate(); signal.removeEventListener('abort', abort) }
    const abort = () => { cleanup(); reject(new DOMException('Export canceled', 'AbortError')) }
    signal.addEventListener('abort', abort, { once: true })
    worker.onmessage = ({ data }: MessageEvent<VideoRenderMessage>) => {
      if (data.type === 'progress') { progress(data.fraction); return }
      cleanup()
      if (data.type === 'complete') resolve(new Uint8Array(data.buffer))
      else { if (data.reason) console.info('Using the WASM video encoder:', data.reason); resolve(null) }
    }
    worker.onerror = event => { event.preventDefault(); cleanup(); console.info('Using the WASM video encoder:', event.message); resolve(null) }
    worker.postMessage(request)
  })
}
