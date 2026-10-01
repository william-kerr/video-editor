import { type Media, uid } from '../model'
import { execute, extension, removeFiles, withFFmpeg } from './ffmpeg'

let context: AudioContext | undefined
export const audioContext = () => context ??= new AudioContext({ sampleRate: 48000 })

interface Probe { streams: { codec_type: string; width?: number; height?: number; avg_frame_rate?: string; duration?: string; side_data_list?: { rotation?: number }[]; tags?: { rotate?: string } }[]; format?: { duration?: string } }
export async function importMedia(file: File, status: (text: string) => void): Promise<Media> {
  if (file.size >= 2 ** 31) throw new Error(`${file.name} is too large for the browser video engine. Use a file smaller than 2 GB.`)
  const id = uid()
  const url = URL.createObjectURL(file)
  try {
    const probe = await withFFmpeg(async ffmpeg => {
      const input = `probe-${id}.${extension(file.name)}`
      const output = `probe-${id}.json`
      try {
        await ffmpeg.writeFile(input, new Uint8Array(await file.arrayBuffer()))
        const code = await ffmpeg.ffprobe(['-v', 'error', '-show_streams', '-show_format', '-of', 'json', input, '-o', output])
        // Core 0.12.10 can return -1 after a successful ffprobe call; validate its JSON below.
        if (code > 0) throw new Error(`Could not read ${file.name}. Import a video or audio file.`)
        const result = JSON.parse(await ffmpeg.readFile(output, 'utf8') as string) as Probe
        if (!Array.isArray(result.streams)) throw new Error(`Could not read media streams in ${file.name}.`)
        return result
      } finally { await removeFiles(ffmpeg, [input, output]) }
    }, status)
    const video = probe.streams.find(stream => stream.codec_type === 'video' && stream.width && stream.height)
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
      fps: numerator / denominator || 30, peaks: [],
    }
    if (video) {
      try { media.thumbnail = await thumbnail(url) }
      catch {
        status(`Preparing a browser-compatible preview · ${file.name}`)
        const proxy = await withFFmpeg(async ffmpeg => {
          const input = `proxy-${id}.${extension(file.name)}`
          const output = `proxy-${id}.mp4`
          try {
            await ffmpeg.writeFile(input, new Uint8Array(await file.arrayBuffer()))
            await execute(ffmpeg, ['-i', input, '-an', '-vf', "scale=w='min(960,iw)':h='min(960,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output])
            return (await ffmpeg.readFile(output) as Uint8Array).slice()
          } finally { await removeFiles(ffmpeg, [input, output]) }
        }, status)
        media.url = URL.createObjectURL(new Blob([proxy.buffer as ArrayBuffer], { type: 'video/mp4' }))
        URL.revokeObjectURL(url)
        try { media.thumbnail = await thumbnail(media.url) }
        catch (error) { URL.revokeObjectURL(media.url); throw error }
      }
    }
    if (hasAudio) {
      status(`Reading audio · ${file.name}`)
      try { media.audio = await audioContext().decodeAudioData(await file.arrayBuffer()) }
      catch {
        const wav = await withFFmpeg(async ffmpeg => {
          const input = `audio-${id}.${extension(file.name)}`
          const output = `audio-${id}.wav`
          try {
            await ffmpeg.writeFile(input, new Uint8Array(await file.arrayBuffer()))
            await execute(ffmpeg, ['-i', input, '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_f32le', output])
            return await ffmpeg.readFile(output) as Uint8Array
          } finally { await removeFiles(ffmpeg, [input, output]) }
        }, status)
        media.audio = await audioContext().decodeAudioData(wav.slice().buffer as ArrayBuffer)
      }
      media.peaks = waveform(media.audio)
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
export function waveform(buffer: AudioBuffer) {
  const size = Math.min(12000, Math.ceil(buffer.duration * 100))
  return Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, channel) => {
    const data = buffer.getChannelData(channel)
    const result = new Float32Array(size)
    const stride = data.length / size
    for (let i = 0; i < size; i++) {
      let peak = 0
      for (let j = Math.floor(i * stride); j < Math.min(data.length, (i + 1) * stride); j++) peak = Math.max(peak, Math.abs(data[j]))
      result[i] = peak
    }
    return result
  })
}
