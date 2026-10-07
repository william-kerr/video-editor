import { audible, canvasSize, end, exportRange, uid, type Project } from '../model'
import { channelsOf, denoised, releaseMix, renderMix } from '../audio/cache'
import { audioRange } from '../audio/source'
import { RATE, wavHeader } from '../audio/dsp'
import { cancelFFmpeg, execute, mountFile, unmountFile, removeFiles, withFFmpeg } from './ffmpeg'
import { renderBrowserVideo } from './browser-export'

export interface ExportProgress { message: string; fraction?: number }
export async function exportVideo(project: Project, progress: (value: ExportProgress) => void, signal: AbortSignal) {
  const [start, finish] = exportRange(project)
  if (finish <= start) throw new Error('Add clips and set an Out marker after the In marker, or remove the markers to export everything.')
  const check = () => { if (signal.aborted) throw new DOMException('Export canceled', 'AbortError') }
  progress({ message: 'Preparing the audio mix…' })
  const wav = await renderAudio(project, start, finish, check)
  check()
  progress({ message: 'Encoding video…', fraction: 0 })
  const encoded = await renderBrowserVideo(project, fraction => progress({ message: 'Encoding video…', fraction: fraction * .9 }), signal)
  check()
  if (encoded) {
    // Video is already encoded by the browser. WASM only encodes the mixed audio and muxes the MP4.
    const output = await withFFmpeg(async ffmpeg => {
      const files = ['encoded-video.mp4', 'mix.wav', 'export.mp4']
      try {
        check()
        progress({ message: 'Finishing video…', fraction: .9 })
        await ffmpeg.writeFile('encoded-video.mp4', encoded)
        await ffmpeg.writeFile('mix.wav', wav)
        check()
        await execute(ffmpeg, ['-i', 'encoded-video.mp4', '-i', 'mix.wav', '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-t', String(finish - start), '-movflags', '+faststart', 'export.mp4'])
        check()
        return (await ffmpeg.readFile('export.mp4') as Uint8Array).slice()
      } finally { await removeFiles(ffmpeg, files); cancelFFmpeg() }
    }, message => progress({ message }))
    check()
    return new Blob([output.buffer as ArrayBuffer], { type: 'video/mp4' })
  }
  const output = await withFFmpeg(async ffmpeg => {
    check()
    const files: string[] = ['mix.wav', 'export.mp4']
    const directories: string[] = []
    const size = canvasSize(project)
    const length = finish - start
    const args: string[] = ['-f', 'lavfi', '-i', `color=c=black:s=${size.width}x${size.height}:r=${size.fps}:d=${length}`]
    const filters: string[] = ['[0:v]settb=AVTB,format=yuv420p[base]']
    const videoTracks = project.tracks.filter(t => t.kind === 'video').map(t => t.id).reverse()
    const videoClips = videoTracks.flatMap(trackId => project.clips.filter(c => c.trackId === trackId && end(c) > start && c.start < finish))
    const inputNames = new Map<string, string>()
    let input = 1, previous = 'base'
    const listener = ({ progress: fraction, time }: { progress: number; time: number }) => {
      progress({ message: 'Encoding video…', fraction: Math.min(.99, Math.max(0, time / 1e6 / length || fraction)) })
    }
    ffmpeg.on('progress', listener)
    try {
      for (const clip of videoClips) {
        check()
        const media = project.media.find(m => m.id === clip.mediaId)!
        if (!inputNames.has(media.id)) {
          const directory = `/media-${input}`
          directories.push(directory)
          progress({ message: `Preparing ${media.name}…` })
          inputNames.set(media.id, await mountFile(ffmpeg, media.file, directory))
        }
        const visibleStart = Math.max(start, clip.start)
        const visibleEnd = Math.min(finish, end(clip))
        // Retain the full clip's fade coordinates even when markers cut into it.
        const sourceOffset = clip.sourceIn + visibleStart - clip.start
        args.push('-ss', String(sourceOffset), '-t', String(visibleEnd - visibleStart), '-i', inputNames.get(media.id)!)
        const fadeOffset = visibleStart - clip.start
        // geq handles fades already underway at the In marker (fade's start cannot be negative).
        const fade = clip.fadeIn || clip.fadeOut
          ? `,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='255*min(${clip.fadeIn ? `min(1,max(0,(T+${fadeOffset})/${clip.fadeIn}))` : '1'},${clip.fadeOut ? `min(1,max(0,(${end(clip) - clip.start - fadeOffset}-T)/${clip.fadeOut}))` : '1'})'`
          : ''
        filters.push(`[${input}:v]settb=AVTB,setpts=PTS-STARTPTS,scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuva420p${fade},setpts=PTS+${visibleStart - start}/TB[v${input}]`)
        filters.push(`[${previous}][v${input}]overlay=eof_action=pass:repeatlast=0:enable='gte(t,${visibleStart - start})*lt(t,${visibleEnd - start})'[o${input}]`)
        previous = `o${input}`; input++
      }
      await ffmpeg.writeFile('mix.wav', wav)
      args.push('-i', 'mix.wav', '-filter_complex', filters.join(';'), '-map', `[${previous}]`, '-map', `${input}:a`, '-t', String(length), '-r', String(size.fps), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-movflags', '+faststart', '-threads', '1', 'export.mp4')
      check()
      progress({ message: 'Encoding video…', fraction: 0 })
      await execute(ffmpeg, args)
      check()
      return (await ffmpeg.readFile('export.mp4') as Uint8Array).slice()
    } finally {
      ffmpeg.off('progress', listener); await removeFiles(ffmpeg, files)
      for (const directory of directories) await unmountFile(ffmpeg, directory)
      cancelFFmpeg()
    }
  }, message => progress({ message }))
  check()
  return new Blob([output.buffer as ArrayBuffer], { type: 'video/mp4' })
}

async function renderAudio(project: Project, start: number, finish: number, check: () => void) {
  const frames = Math.ceil((finish - start) * RATE)
  const wav = new Uint8Array(44 + frames * 4)
  wav.set(wavHeader(frames))
  const mixId = uid()
  const tracks = project.tracks.filter(track => audible(track, project) && project.clips.some(clip => clip.trackId === track.id && end(clip) > start && clip.start < finish && project.media.find(media => media.id === clip.mediaId)?.hasAudio))
  try {
    for (let frame = 0; frame < frames; frame += 4 * RATE) {
      check()
      const from = start + frame / RATE, to = start + Math.min(frames, frame + 4 * RATE) / RATE
      const clips = []
      for (const clip of project.clips) {
        const track = project.tracks.find(t => t.id === clip.trackId)!
        const media = project.media.find(m => m.id === clip.mediaId)!
        if (!media.hasAudio || !audible(track, project) || end(clip) <= from || clip.start >= to) continue
        const sourceStart = clip.sourceIn + Math.max(from, clip.start) - clip.start
        const sourceEnd = Math.min(media.duration, clip.sourceIn + Math.min(to, end(clip)) - clip.start)
        const dry = await audioRange(media, sourceStart, sourceEnd)
        check()
        const wet = track.denoiseOn && track.denoise > 0 ? await audioRange(media, sourceStart, sourceEnd, (media, index) => denoised(media, index, track.noiseProfile)) : undefined
        clips.push({ clip, track, sourceStart, dry: channelsOf(dry), wet: wet ? channelsOf(wet) : undefined })
      }
      check()
      const part = await renderMix({ clips, tracks, frames: Math.min(4 * RATE, frames - frame), start: from, finish: to, loudness: project.loudnessOn ? project.loudness : 0 }, mixId)
      wav.set(part.subarray(44, 44 + Math.min(4 * RATE, frames - frame) * 4), 44 + frame * 4)
    }
    return wav
  } finally { await releaseMix(mixId) }
}
