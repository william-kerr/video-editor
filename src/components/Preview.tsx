import { useEffect, useRef } from 'react'
import { canvasSize, clipGain, end, timecode, type Media, type Project } from '../model'
import { Button } from './Button'
import { Icon } from './Icon'

interface Props {
  project: Project; time: number; playing: boolean; loop: boolean; quality: number; source: Media | null; busy: boolean
  setQuality: (value: number) => void; rewind: () => void; rewindIn: () => void; play: () => void; playMarkers: () => void; toggleLoop: () => void; marker: (which: 'in' | 'out') => void; split: () => void; exportVideo: () => void
}
export function Preview(props: Props) {
  const { project, time, playing, quality, source } = props
  const canvas = useRef<HTMLCanvasElement>(null)
  const videos = useRef(new Map<string, HTMLVideoElement>())
  const layer = useRef<HTMLCanvasElement | null>(null)
  const latest = useRef(props); latest.current = props
  const dimensions = source?.kind === 'video' ? { width: source.width, height: source.height, fps: source.fps } : canvasSize(project)
  const hasVideo = Boolean(source?.kind === 'video' || project.clips.some(c => project.media.find(m => m.id === c.mediaId)?.kind === 'video'))
  const draw = () => {
    const { project, time, source } = latest.current
    const surface = canvas.current
    if (!surface) return
    const context = surface.getContext('2d')!
    context.globalAlpha = 1; context.fillStyle = '#080a0d'; context.fillRect(0, 0, surface.width, surface.height)
    const visible = source ? [{ id: 'source', mediaId: source.id, start: 0, sourceIn: 0, sourceOut: source.duration, fadeIn: 0, fadeOut: 0, trackId: '' }] : project.tracks.filter(t => t.kind === 'video').slice().reverse().flatMap(t => project.clips.filter(c => c.trackId === t.id && c.start <= time && end(c) > time))
    for (const clip of visible) {
      const video = videos.current.get(clip.id)
      if (!video || video.readyState < 2) continue
      const scale = Math.min(surface.width / video.videoWidth, surface.height / video.videoHeight)
      layer.current ??= document.createElement('canvas')
      const tile = layer.current
      if (tile.width !== surface.width || tile.height !== surface.height) { tile.width = surface.width; tile.height = surface.height }
      const paint = tile.getContext('2d')!
      paint.fillStyle = '#080a0d'; paint.fillRect(0, 0, tile.width, tile.height)
      paint.drawImage(video, (tile.width - video.videoWidth * scale) / 2, (tile.height - video.videoHeight * scale) / 2, video.videoWidth * scale, video.videoHeight * scale)
      context.globalAlpha = source ? 1 : clipGain(clip, time)
      context.drawImage(tile, 0, 0)
    }
    context.globalAlpha = 1
  }
  useEffect(() => {
    const active = new Set<string>()
    const visible = source ? [{ id: 'source', mediaId: source.id, start: 0, sourceIn: 0, sourceOut: source.duration, fadeIn: 0, fadeOut: 0 }] : project.clips.filter(c => c.start <= time && end(c) > time)
    for (const clip of visible) {
      const media = source || project.media.find(m => m.id === clip.mediaId)!
      if (media.kind !== 'video') continue
      active.add(clip.id)
      let video = videos.current.get(clip.id)
      if (!video || video.src !== media.url) {
        video?.pause()
        video = document.createElement('video'); video.muted = true; video.playsInline = true; video.preload = 'auto'; video.src = media.url
        video.onseeked = draw; video.onloadeddata = draw
        videos.current.set(clip.id, video)
      }
      const target = source ? 0 : clip.sourceIn + time - clip.start
      if (Math.abs(video.currentTime - target) > (playing ? .18 : .012)) video.currentTime = Math.max(0, target)
      if (playing && !source) { if (video.paused) void video.play().catch(() => {}) } else video.pause()
    }
    for (const [id, video] of videos.current) if (!active.has(id)) { video.pause(); if (!project.clips.some(c => c.id === id) && id !== 'source') { video.removeAttribute('src'); video.load(); videos.current.delete(id) } }
    draw()
  }, [project, time, playing, quality, source])
  useEffect(() => () => { for (const video of videos.current.values()) { video.pause(); video.removeAttribute('src'); video.load() } videos.current.clear() }, [])
  return <section className="panel preview-panel" aria-label="Video preview">
    <header className="panel-header"><Icon name="video" /><h2>Preview</h2><span className="preview-format">{dimensions.width} × {dimensions.height} <span>· {Math.round(dimensions.fps * 100) / 100} fps</span></span><Button icon="export" className="action-button" tip="Export between In and Out markers. Without markers, export the entire timeline." onClick={props.exportVideo} disabled={props.busy || !project.clips.length}>Export</Button></header>
    <div className="preview-stage">
      <canvas ref={canvas} width={Math.max(2, Math.round(dimensions.width * quality))} height={Math.max(2, Math.round(dimensions.height * quality))} style={{ aspectRatio: `${dimensions.width}/${dimensions.height}` }} aria-label="Video preview frame" />
      {!hasVideo && <div className="empty-state preview-empty"><div className="empty-preview-icon"><Icon name="video" size={40} /></div><h3>Preview your video here</h3><p>Drag a video clip to the timeline</p></div>}
      {source && <span className="source-label">{source.name}</span>}
    </div>
    <div className="transport">
      <Button icon="rewind" tip="Go to start" onClick={props.rewind} />
      <Button icon="rewind-in" tip="Go to In marker" onClick={props.rewindIn} />
      <Button icon={playing ? 'pause' : 'play'} tip={playing ? 'Pause (Space)' : 'Play (Space)'} className="play-button" onClick={props.play} disabled={props.busy} />
      <Button icon="play-markers" tip="Play between In and Out markers" onClick={props.playMarkers} disabled={props.busy} />
      <Button icon="loop" tip="Loop between In and Out markers" className={props.loop ? 'is-active' : ''} aria-pressed={props.loop} onClick={props.toggleLoop} />
      <span className="transport-divider" />
      <Button icon="in" tip="Set (or remove) In marker (I)" className={project.inPoint !== null ? 'marker-in-active' : ''} onClick={() => props.marker('in')} />
      <Button icon="out" tip="Set (or remove) Out marker (O)" className={project.outPoint !== null ? 'marker-out-active' : ''} onClick={() => props.marker('out')} />
      <Button icon="split" tip="Split selected clip (S)" onClick={props.split} />
      <output className="timecode" aria-label="Playhead time">{timecode(time, true)}</output>
      <div className="quality-select"><select aria-label="Preview resolution" value={quality} onChange={event => props.setQuality(Number(event.target.value))}><option value={.25}>25%</option><option value={.5}>50%</option><option value={1}>100%</option></select><svg className="select-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg></div>
    </div>
  </section>
}
