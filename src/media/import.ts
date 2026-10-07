import { type Media, uid } from '../model'
import { execute, mountFile, unmountFile, removeFiles, withFFmpeg } from './ffmpeg'
import { readWaveform } from '../audio/source'

interface Probe { streams: { codec_type: string; width?: number; height?: number; avg_frame_rate?: string; duration?: string; disposition?: { attached_pic?: number }; side_data_list?: { rotation?: number }[]; tags?: { rotate?: string } }[]; format?: { duration?: string } }
export async function importMedia(file: File, status: (text: string) => void): Promise<Media> {
  if (file.size >= 2 ** 31) throw new Error(`${file.name} is too large for the browser video engine. Use a file smaller than 2 GB.`)
  const id = uid()
  let url = URL.createObjectURL(file)
  try {
    const probe = await withFFmpeg(async ffmpeg => {
      const directory = `/probe-${id}`
      const output = `probe-${id}.json`
      try {
        const input = await mountFile(ffmpeg, file, directory)
        const code = await ffmpeg.ffprobe(['-v', 'error', '-show_streams', '-show_format', '-of', 'json', input, '-o', output])
        // Core 0.12.10 can return -1 after a successful ffprobe call; validate its JSON below.
        if (code > 0) throw new Error(`Could not read ${file.name}. Import a video or audio file.`)
        const result = JSON.parse(await ffmpeg.readFile(output, 'utf8') as string) as Probe
        if (!Array.isArray(result.streams)) throw new Error(`Could not read media streams in ${file.name}.`)
        return result
      } finally { await removeFiles(ffmpeg, [output]); await unmountFile(ffmpeg, directory) }
    }, status)
    const video = probe.streams.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic && stream.width && stream.height)
    const hasAudio = probe.streams.some(stream => stream.codec_type === 'audio')
    if (!video && !hasAudio) throw new Error(`${file.name} does not contain video or audio.`)
    const seconds = Number(probe.format?.duration ?? video?.duration)
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`Could not determine the duration of ${file.name}.`)
    const rotation = video?.side_data_list?.find(item => item.rotation !== undefined)?.rotation ?? Number(video?.tags?.rotate || 0)
    const sideways = Math.abs(rotation % 180) === 90
    const [numerator, denominator] = (video?.avg_frame_rate || '30/1').split('/').map(Number)
    const media: Media = {
      id, name: file.name, file, url, kind: video ? 'video' : 'audio', duration: seconds,
      width: (sideways ? video?.height : video?.width) || 0,
      height: (sideways ? video?.width : video?.height) || 0,
      fps: numerator / denominator || 30, peaks: [], hasAudio,
    }
    if (video) {
      try { media.thumbnail = await thumbnail(url) }
      catch {
        status(`Preparing a browser-compatible preview · ${file.name}`)
        const proxy = await withFFmpeg(async ffmpeg => {
          const directory = `/proxy-${id}`
          const output = `proxy-${id}.mp4`
          try {
            const input = await mountFile(ffmpeg, file, directory)
            await execute(ffmpeg, ['-i', input, '-an', '-vf', "scale=w='min(960,iw)':h='min(960,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output])
            return (await ffmpeg.readFile(output) as Uint8Array).slice()
          } finally { await removeFiles(ffmpeg, [output]); await unmountFile(ffmpeg, directory) }
        }, status)
        media.url = URL.createObjectURL(new Blob([proxy.buffer as ArrayBuffer], { type: 'video/mp4' }))
        URL.revokeObjectURL(url)
        url = media.url
        try { media.thumbnail = await thumbnail(media.url) }
        catch (error) { URL.revokeObjectURL(media.url); throw error }
      }
    }
    if (hasAudio) {
      status(`Reading audio · ${file.name}`)
      media.peaks = await readWaveform(media)
    }
    return media
  } catch (error) { URL.revokeObjectURL(url); throw error }
}
function thumbnail(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    const timeout = window.setTimeout(() => finish(new Error('Video preview timed out')), 15000)
    const finish = (result: string | Error) => {
      clearTimeout(timeout)
      video.removeAttribute('src'); video.load()
      if (result instanceof Error) reject(result); else resolve(result)
    }
    video.muted = true; video.preload = 'auto'; video.playsInline = true
    video.onerror = () => finish(new Error('Video format cannot be played'))
    video.onloadeddata = () => { video.currentTime = Math.min(0.1, video.duration / 2) }
    video.onseeked = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 240; canvas.height = 135
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#0b0e12'; ctx.fillRect(0, 0, 240, 135)
      const scale = Math.min(240 / video.videoWidth, 135 / video.videoHeight)
      ctx.drawImage(video, (240 - video.videoWidth * scale) / 2, (135 - video.videoHeight * scale) / 2, video.videoWidth * scale, video.videoHeight * scale)
      finish(canvas.toDataURL('image/jpeg', 0.8))
    }
    video.src = url
  })
}
