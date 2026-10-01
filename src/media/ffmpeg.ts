import { FFmpeg } from '@ffmpeg/ffmpeg'

let engine: FFmpeg | null = null
let ready: Promise<FFmpeg> | null = null
let queue: Promise<unknown> = Promise.resolve()
let lastLog = ''
export async function getFFmpeg(status?: (text: string) => void): Promise<FFmpeg> {
  if (!ready) {
    status?.('Preparing the local video engine…')
    engine = new FFmpeg()
    engine.on('log', ({ message }) => { lastLog = message })
    const current = engine
    ready = current.load({
      coreURL: new URL(`${import.meta.env.BASE_URL}ffmpeg/ffmpeg-core.js`, location.href).href,
      wasmURL: new URL(`${import.meta.env.BASE_URL}ffmpeg/ffmpeg-core.wasm`, location.href).href,
    }).then(() => current).catch(error => { ready = null; engine = null; throw error })
  }
  return ready
}
export function withFFmpeg<T>(job: (ffmpeg: FFmpeg) => Promise<T>, status?: (text: string) => void): Promise<T> {
  const run = queue.then(async () => job(await getFFmpeg(status)))
  queue = run.catch(() => {})
  return run
}
export async function execute(ffmpeg: FFmpeg, args: string[]) {
  lastLog = ''
  const result = await ffmpeg.exec(['-hide_banner', '-y', ...args])
  if (result !== 0) throw new Error(lastLog || 'The video engine could not process this file.')
}
export function cancelFFmpeg() {
  engine?.terminate()
  engine = null
  ready = null
}
export const extension = (name: string) => name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'
export async function removeFiles(ffmpeg: FFmpeg, names: string[]) {
  for (const name of names) { try { await ffmpeg.deleteFile(name) } catch { /* Engine can be terminated by Cancel. */ } }
}
