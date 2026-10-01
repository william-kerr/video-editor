import { audible, canvasSize, end, exportRange, type Project } from '../model'
import { channelsOf, denoised, renderMix } from '../audio/cache'
import { execute, extension, removeFiles, withFFmpeg } from './ffmpeg'
import { renderBrowserVideo } from './browser-export'

export interface ExportProgress { message: string; fraction?: number }
export async function exportVideo(project: Project, progress: (value: ExportProgress) => void, signal: AbortSignal) {
  const [start, finish] = exportRange(project)
  if (finish <= start) throw new Error('Add clips and set an Out marker after the In marker, or remove the markers to export everything.')
  const check = () => { if (signal.aborted) throw new DOMException('Export canceled', 'AbortError') }
  progress({ message: 'Preparing the audio mix…' })
  const clips = await Promise.all(project.clips.filter(clip => {
    const track = project.tracks.find(t => t.id === clip.trackId)!
    return audible(track, project) && end(clip) > start && clip.start < finish && project.media.find(m => m.id === clip.mediaId)?.audio
  }).map(async clip => {
    const track = project.tracks.find(t => t.id === clip.trackId)!
    const media = project.media.find(m => m.id === clip.mediaId)!
    const wet = track.denoiseOn && track.denoise > 0 ? await denoised(media, track.noiseProfile) : undefined
    return { clip, track, dry: channelsOf(media.audio!), wet: wet ? channelsOf(wet) : undefined }
  }))
  check()
  const wav = await renderMix({ clips, start, finish, loudness: project.loudnessOn ? project.loudness : 0 })
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
      } finally { await removeFiles(ffmpeg, files) }
    }, message => progress({ message }))
    check()
    return new Blob([output.buffer as ArrayBuffer], { type: 'video/mp4' })
  }
  const output = await withFFmpeg(async ffmpeg => {
    check()
    const files: string[] = ['mix.wav', 'export.mp4']
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
          const name = `media-${input}.${extension(media.name)}`
          files.push(name); inputNames.set(media.id, name)
          progress({ message: `Preparing ${media.name}…` })
          await ffmpeg.writeFile(name, new Uint8Array(await media.file.arrayBuffer()))
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
    } finally { ffmpeg.off('progress', listener); await removeFiles(ffmpeg, files) }
  }, message => progress({ message }))
  check()
  return new Blob([output.buffer as ArrayBuffer], { type: 'video/mp4' })
}
