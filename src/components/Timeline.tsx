import { memo, useEffect, useRef, useState } from 'react'
import { clamp, duration, end, placeClip, timecode, timelineEnd, trimClip, type Clip, type Media, type Project, type Track } from '../model'
import { Button } from './Button'
import { Icon } from './Icon'

const LABEL = 188, ROW = 82
interface Props {
  project: Project; time: number; selected: string | null; zoom: number
  setZoom: (value: number) => void; select: (id: string) => void; seek: (time: number) => void
  begin: () => void; finish: () => void; change: (project: Project) => void
  drop: (media: string, trackId: string, time: number) => void; addTrack: (track: Track) => void; removeTrack: (track: Track) => void; mono: (track: Track) => void
}
type Operation = 'move' | 'left' | 'right' | 'fade-in' | 'fade-out'
export function Timeline(props: Props) {
  const { project, time, selected, zoom } = props
  const scroll = useRef<HTMLDivElement>(null)
  const lanes = useRef<HTMLDivElement>(null)
  const gesture = useRef<{ clip: Clip; x: number; operation: Operation; project: Project; scroll: number } | null>(null)
  const [hover, setHover] = useState<{ id: string; operation: Operation } | null>(null)
  const length = Math.max(60, timelineEnd(project) + 15, time + 10, project.outPoint ?? 0)
  const width = Math.max(800, length * zoom)
  const step = zoom >= 70 ? 1 : zoom >= 30 ? 2 : zoom >= 14 ? 5 : 10
  const xTime = (clientX: number) => Math.max(0, (clientX - scroll.current!.getBoundingClientRect().left + scroll.current!.scrollLeft - LABEL) / zoom)
  function operation(event: React.PointerEvent, clip: Clip): Operation {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left, y = event.clientY - rect.top
    const fadeInX = Math.max(6, clip.fadeIn * zoom), fadeOutX = rect.width - Math.max(6, clip.fadeOut * zoom)
    if (y <= 22 && (x < 18 || Math.abs(x - fadeInX) < 7)) return 'fade-in'
    if (y <= 22 && (x > rect.width - 18 || Math.abs(x - fadeOutX) < 7)) return 'fade-out'
    if (x < 9) return 'left'
    if (x > rect.width - 9) return 'right'
    return 'move'
  }
  function move(event: React.PointerEvent, clip: Clip) {
    const drag = gesture.current
    if (!drag) { setHover({ id: clip.id, operation: operation(event, clip) }); return }
    const delta = (event.clientX - drag.x + scroll.current!.scrollLeft - drag.scroll) / zoom
    const original = drag.clip
    let updated: Clip = original
    if (drag.operation === 'move') {
      const index = Math.floor((event.clientY - lanes.current!.getBoundingClientRect().top) / ROW)
      const target = drag.project.tracks[index]
      const originalTrack = drag.project.tracks.find(t => t.id === original.trackId)!
      updated = placeClip(drag.project, original, Math.max(0, original.start + delta), target?.kind === originalTrack.kind ? target.id : original.trackId, 9 / zoom)
    } else if (drag.operation === 'left' || drag.operation === 'right') updated = trimClip(drag.project, original, drag.operation, (drag.operation === 'left' ? original.start : end(original)) + delta, 9 / zoom)
    else if (drag.operation === 'fade-in') updated = { ...original, fadeIn: clamp(original.fadeIn + delta, 0, duration(original)) }
    else updated = { ...original, fadeOut: clamp(original.fadeOut - delta, 0, duration(original)) }
    props.change({ ...drag.project, clips: drag.project.clips.map(c => c.id === original.id ? updated : c) })
    const bounds = scroll.current!.getBoundingClientRect()
    if (event.clientX > bounds.right - 25) scroll.current!.scrollLeft += 12
    if (event.clientX < bounds.left + LABEL + 15) scroll.current!.scrollLeft -= 12
  }
  return <section className="panel timeline-panel" aria-label="Timeline">
    <header className="panel-header"><Icon name="timeline" /><h2>Timeline</h2><div className="marker-readout"><span>In {project.inPoint === null ? '—' : timecode(project.inPoint, true)}</span><span>/</span><span>Out {project.outPoint === null ? '—' : timecode(project.outPoint, true)}</span></div><div className="timeline-zoom"><Icon name="zoom" size={17} /><input type="range" min="8" max="100" value={zoom} style={{ '--range-fill': `${(zoom - 8) / 92 * 100}%` } as React.CSSProperties} aria-label="Timeline zoom" onChange={e => props.setZoom(Number(e.target.value))} onDoubleClick={() => props.setZoom(24)} /></div></header>
    <div className="timeline-scroll" ref={scroll}>
      <div className="timeline-content" style={{ width: LABEL + width, minWidth: '100%' }}>
        <div className="ruler" onPointerDown={event => { if (event.clientX - event.currentTarget.getBoundingClientRect().left < LABEL) return; event.currentTarget.setPointerCapture(event.pointerId); props.seek(xTime(event.clientX)) }} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) props.seek(xTime(event.clientX)) }} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}>
          <div className="ruler-playhead" style={{ left: LABEL + time * zoom }} />
          <div className="ruler-label" style={{ width: LABEL }}>TRACKS</div>
          {Array.from({ length: Math.ceil(length / step) + 1 }, (_, i) => <span className="ruler-tick" style={{ left: LABEL + i * step * zoom, width: step * zoom }} key={i}>{timecode(i * step)}<i /><i /><i /><i /></span>)}
        </div>
        <div ref={lanes} className="lanes" style={{ minHeight: Math.max(ROW * project.tracks.length, 180) }}>
          {project.tracks.map(track => <div key={track.id} className={`track-row ${track.kind}-row`} style={{ height: ROW, backgroundSize: `${step * zoom}px 100%`, backgroundPositionX: LABEL }} data-track={track.id} onDragOver={event => { if (event.dataTransfer.types.includes('application/x-video-editor-media')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; event.currentTarget.classList.add('track-drop') } }} onDragLeave={event => event.currentTarget.classList.remove('track-drop')} onDrop={event => { event.currentTarget.classList.remove('track-drop'); const id = event.dataTransfer.getData('application/x-video-editor-media'); if (id) { event.preventDefault(); props.drop(id, track.id, xTime(event.clientX)) } }} onPointerDown={event => { if (event.target === event.currentTarget) props.seek(xTime(event.clientX)) }}>
            <div className="track-header" style={{ width: LABEL }}><div className="track-title"><Icon name={track.kind} size={18} /><strong>{track.name}</strong></div><div className="track-subtitle">{track.kind === 'audio' ? <button className="mono-button" data-tip="Stereo or mono" onClick={() => props.mono(track)}>{track.mono ? 'Mono' : 'Stereo'}</button> : 'Video + audio'}</div><Button icon={track.primary ? 'plus' : 'minus'} tip={track.primary ? `Add ${track.kind} track` : `Delete ${track.name}`} className="track-add" onClick={() => track.primary ? props.addTrack(track) : props.removeTrack(track)} /></div>
            {!project.clips.some(c => c.trackId === track.id) && <span className="track-hint" style={{ left: LABEL + 24 }}>Drag {track.kind} clips here</span>}
          </div>)}
          {project.clips.map(clip => {
            const media = project.media.find(m => m.id === clip.mediaId)!
            const index = project.tracks.findIndex(t => t.id === clip.trackId)
            const track = project.tracks[index]
            const hovered = hover?.id === clip.id ? hover.operation : undefined
            return <div key={clip.id} className={`clip ${media.kind}-clip ${selected === clip.id ? 'selected' : ''} ${hovered ? `hover-${hovered}` : ''}`} data-clip-id={clip.id} data-media-name={media.name} style={{ left: LABEL + clip.start * zoom, top: index * ROW + 6, width: Math.max(4, duration(clip) * zoom), height: ROW - 12 }} tabIndex={0} aria-label={`${media.name}, ${track.name}, ${timecode(clip.start, true)} to ${timecode(end(clip), true)}`} onFocus={() => props.select(clip.id)} onPointerDown={event => { event.stopPropagation(); event.currentTarget.focus(); props.select(clip.id); const op = operation(event, clip); gesture.current = { clip, x: event.clientX, operation: op, project, scroll: scroll.current!.scrollLeft }; setHover({ id: clip.id, operation: op }); event.currentTarget.setPointerCapture(event.pointerId); props.begin() }} onPointerMove={event => move(event, clip)} onPointerLeave={() => { if (!gesture.current) setHover(null) }} onPointerUp={event => { gesture.current = null; event.currentTarget.releasePointerCapture(event.pointerId); props.finish() }} onPointerCancel={() => { gesture.current = null; props.finish() }}>
              <div className="clip-header"><span>{media.name}</span></div>
              <Waveform media={media} clip={clip} mono={track.mono} />
              {media.thumbnail && <img className={`clip-thumbnail ${media.audio ? 'with-audio' : ''}`} src={media.thumbnail} alt="" draggable={false} />}
              <svg className="fade-triangles" width="100%" height="100%" preserveAspectRatio="none" viewBox={`0 0 ${Math.max(1, duration(clip) * zoom)} ${ROW - 12}`}><polygon points={`0,0 ${clip.fadeIn * zoom},0 0,${ROW - 12}`} /><polygon points={`${duration(clip) * zoom},0 ${(duration(clip) - clip.fadeOut) * zoom},0 ${duration(clip) * zoom},${ROW - 12}`} /></svg>
              <span className="fade-handle fade-left" style={{ left: Math.max(4, clip.fadeIn * zoom - 3) }} /><span className="fade-handle fade-right" style={{ right: Math.max(4, clip.fadeOut * zoom - 3) }} />
              <span className="trim-affordance trim-left" /><span className="trim-affordance trim-right" />
            </div>
          })}
        </div>
        <div className="timeline-lines" style={{ left: LABEL }}>
          {project.inPoint !== null && <div className="marker-line in-line" style={{ left: project.inPoint * zoom }}><span>I</span></div>}
          {project.outPoint !== null && <div className="marker-line out-line" style={{ left: project.outPoint * zoom }}><span>O</span></div>}
          <div className="playhead" style={{ left: time * zoom }}><span /></div>
        </div>
      </div>
    </div>
  </section>
}
const Waveform = memo(function Waveform({ media, clip, mono }: { media: Media; clip: Clip; mono: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const element = canvas.current!
    function draw() {
      const width = Math.round(element.clientWidth * devicePixelRatio), height = Math.round(element.clientHeight * devicePixelRatio)
      element.width = width; element.height = height
      const context = element.getContext('2d')!
      if (!media.peaks.length) return
      const channels = mono ? [media.peaks[0]] : media.peaks
      const row = height / channels.length
      const from = clip.sourceIn / media.duration * media.peaks[0].length, span = duration(clip) / media.duration * media.peaks[0].length
      context.fillStyle = media.kind === 'audio' ? '#72ccbd' : '#95b7f8'
      context.globalAlpha = .85
      for (let c = 0; c < channels.length; c++) {
        for (let x = 0; x < width; x += 2) {
          const first = Math.floor(from + x / width * span), last = Math.ceil(from + (x + 2) / width * span)
          let peak = .008
          for (let i = first; i <= last; i++) {
            const value = mono && media.peaks.length > 1 ? (media.peaks[0][i] + media.peaks[1][i]) / 2 : channels[c][i]
            peak = Math.max(peak, value || 0)
          }
          const h = Math.min(row - 3, peak * row * .9)
          context.fillRect(x, (c + .5) * row - h / 2, 1.5, Math.max(1, h))
        }
      }
    }
    const observer = new ResizeObserver(draw); observer.observe(element); draw()
    return () => observer.disconnect()
  }, [media, clip.sourceIn, clip.sourceOut, mono])
  return <canvas ref={canvas} className="clip-waveform" aria-hidden="true" />
})
