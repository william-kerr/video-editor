import { useEffect, useRef, useState } from 'react'
import { canvasSize, clamp, end, markerRange, newProject, newTrack, placeClip, splitClip, timelineEnd, uid, type Media, type Project, type Track } from './model'
import { importMedia } from './media/import'
import { AudioPlayback } from './audio/playback'
import { channelsOf, denoised, learn } from './audio/cache'
import { exportVideo, type ExportProgress } from './media/export'
import { cancelFFmpeg } from './media/ffmpeg'
import { MediaBin } from './components/MediaBin'
import { Preview } from './components/Preview'
import { Timeline } from './components/Timeline'
import { Mixer } from './components/Mixer'
import { Button } from './components/Button'
import { Icon } from './components/Icon'

export function App() {
  const [project, setProject] = useState(newProject)
  const state = useRef(project)
  const [time, setTime] = useState(0)
  const playhead = useRef(0)
  const [playing, setPlaying] = useState(false)
  const running = useRef(false)
  const [loop, setLoop] = useState(false)
  const loopRef = useRef(false)
  const markerPlayback = useRef(false)
  const [quality, setQuality] = useState(.5)
  const [zoom, setZoom] = useState(24)
  const [selected, setSelected] = useState<string | null>(null)
  const [source, setSource] = useState<Media | null>(null)
  const [status, setStatus] = useState('Import media to begin')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const importing = useRef(false)
  const [exporting, setExporting] = useState<ExportProgress | null>(null)
  const [download, setDownload] = useState<string | null>(null)
  const exporter = useRef<AbortController | null>(null)
  const history = useRef<Project[]>([])
  const transaction = useRef<Project | null>(null)
  const engine = useRef(new AudioPlayback()).current
  const playbackToken = useRef(0)
  const [timelineHeight, setTimelineHeight] = useState(280)
  const layout = useRef<HTMLDivElement>(null)
  const urls = useRef(new Set<string>())

  function position(value: number) { playhead.current = Math.max(0, value); setTime(playhead.current) }
  function pause() { playbackToken.current++; running.current = false; setPlaying(false); engine.stop() }
  function seek(value: number) { pause(); setSource(null); position(value) }
  function change(next: Project) {
    const tracks = next.tracks.map(track => track.solo && !next.clips.some(clip => clip.trackId === track.id && next.media.find(media => media.id === clip.mediaId)?.audio) ? { ...track, solo: false } : track)
    if (tracks.some((track, index) => track !== next.tracks[index])) next = { ...next, tracks }
    state.current = next; setProject(next); engine.update(next)
  }
  function begin() { transaction.current ??= state.current }
  function commit(next: Project) {
    if (next === state.current) return
    history.current.push(state.current)
    if (history.current.length > 80) history.current.shift()
    change(next)
  }
  function finish() {
    const before = transaction.current
    transaction.current = null
    if (before && before !== state.current) {
      history.current.push(before)
      if (history.current.length > 80) history.current.shift()
      if (running.current) void start(markerPlayback.current, engine.time())
    }
  }
  function undo() {
    const before = history.current.pop()
    if (!before) return
    pause(); transaction.current = null; change(before); setSource(null); setStatus('Undone')
  }
  async function start(markers = false, from = playhead.current) {
    const current = state.current
    if (!current.clips.length) { setStatus('Drag media onto the timeline to begin'); return }
    if (importing.current || exporter.current) return
    let at = from
    const bounded = markers || loopRef.current
    if (bounded) {
      const range = markerRange(current)
      if (!range) { setStatus('Set In and Out markers to play or loop a range'); return }
      if (at < range[0] || at >= range[1] - .001) at = range[0]
    } else if (at >= timelineEnd(current)) at = 0
    const token = ++playbackToken.current
    markerPlayback.current = bounded
    running.current = true; setPlaying(true); setSource(null); position(at)
    try {
      const started = await engine.start(current, at, setStatus)
      if (token !== playbackToken.current || !started) return
      setStatus(bounded ? loopRef.current ? 'Looping between markers' : 'Playing between markers' : 'Playing')
    } catch (error) { if (token === playbackToken.current) { pause(); report(error) } }
  }
  function togglePlay() { if (running.current) { if (engine.active) position(engine.time()); pause(); setStatus('Paused') } else void start() }
  function toggleLoop() {
    const value = !loopRef.current; loopRef.current = value; setLoop(value)
    if (running.current && value) void start(true, engine.active ? engine.time() : playhead.current)
  }
  function marker(which: 'in' | 'out') {
    const key = which === 'in' ? 'inPoint' : 'outPoint'
    const current = state.current
    const value = Math.round(playhead.current * canvasSize(current).fps) / canvasSize(current).fps
    commit({ ...current, [key]: current[key] !== null && Math.abs(current[key]! - value) < .5 / canvasSize(current).fps ? null : value })
  }
  function split() { pause(); commit(splitClip(state.current, selected, playhead.current)) }
  function removeClip() {
    if (!selected) return
    pause(); commit({ ...state.current, clips: state.current.clips.filter(c => c.id !== selected) }); setSelected(null)
  }
  function report(reason: unknown) {
    const message = reason instanceof Error ? reason.message : String(reason)
    setStatus(message); setError(message)
  }
  async function importFiles(files: File[]) {
    if (importing.current || exporter.current || !files.length) return
    pause(); importing.current = true; setBusy(true); setError(null)
    for (const file of files) {
      try {
        setStatus(`Importing ${file.name}…`)
        const media = await importMedia(file, setStatus)
        urls.current.add(media.url)
        commit({ ...state.current, media: [...state.current.media, media] })
        setStatus(`Imported ${file.name}`)
      } catch (error) { report(error) }
    }
    importing.current = false; setBusy(false)
  }
  function drop(mediaId: string, trackId: string, at: number) {
    const current = state.current
    const media = current.media.find(m => m.id === mediaId), track = current.tracks.find(t => t.id === trackId)
    if (!media || !track) return
    if (media.kind !== track.kind) { setStatus(`Drop this clip onto a ${media.kind} track`); return }
    pause(); setSource(null)
    const clip = placeClip(current, { id: uid(), mediaId, trackId, start: at, sourceIn: 0, sourceOut: media.duration, fadeIn: 0, fadeOut: 0 }, at, trackId, 9 / zoom)
    const empty = current.clips.length === 0
    commit({ ...current, clips: [...current.clips, clip] })
    setSelected(clip.id)
    if (empty) position(clip.start)
    setStatus('Ready to edit')
  }
  function addTrack(parent: Track) {
    const current = state.current
    const name = parent.kind === 'video' ? 'Video' : 'Audio'
    let number = 2
    while (current.tracks.some(t => t.name === `${name} ${number}`)) number++
    const track = newTrack(parent.kind, `${name} ${number}`)
    const tracks = [...current.tracks]
    const last = tracks.map(t => t.kind).lastIndexOf(parent.kind)
    tracks.splice(last + 1, 0, track)
    commit({ ...current, tracks })
  }
  function removeTrack(track: Track) {
    if (track.primary) return
    pause()
    commit({ ...state.current, tracks: state.current.tracks.filter(t => t.id !== track.id), clips: state.current.clips.filter(c => c.trackId !== track.id) })
  }
  function updateTrack(id: string, patch: Partial<Track>) {
    change({ ...state.current, tracks: state.current.tracks.map(t => t.id === id ? { ...t, ...patch } : t) })
    if (patch.gain !== undefined) setStatus(`${state.current.tracks.find(t => t.id === id)?.name} gain ${patch.gain.toFixed(1)} dB`)
  }
  async function learnNoise(id: string): Promise<boolean> {
    const current = state.current
    const range = markerRange(current)
    if (!range || range[1] - range[0] < .25 || range[1] - range[0] > 10) { setStatus('Set In and Out around 0.25–10 seconds of background noise without the sound you want to keep'); return false }
    const [start, stopTime] = range
    const channels = [new Float32Array(Math.ceil((stopTime - start) * 48000)), new Float32Array(Math.ceil((stopTime - start) * 48000))]
    let found = false
    for (const clip of current.clips.filter(c => c.trackId === id && c.start < stopTime && end(c) > start)) {
      const audio = current.media.find(m => m.id === clip.mediaId)?.audio
      if (!audio) continue
      found = true
      const samples = channelsOf(audio)
      for (let i = Math.max(0, Math.round((clip.start - start) * 48000)); i < Math.min(channels[0].length, Math.round((end(clip) - start) * 48000)); i++) {
        const index = Math.round((clip.sourceIn + start + i / 48000 - clip.start) * 48000)
        for (let c = 0; c < 2; c++) channels[c][i] += samples[Math.min(c, samples.length - 1)][index] || 0
      }
    }
    if (!found) { setStatus('There is no audio on this track between the markers'); return false }
    setStatus('Learning background noise…')
    try {
      const profile = await learn(channels)
      begin(); updateTrack(id, { noiseProfile: profile }); finish()
      setStatus('Noise learned between In and Out markers')
      for (const clip of state.current.clips.filter(c => c.trackId === id)) {
        const media = state.current.media.find(m => m.id === clip.mediaId)!
        if (media.audio) void denoised(media, profile).catch(report)
      }
      return true
    } catch (error) { report(error); return false }
  }
  async function exportProject() {
    if (exporter.current || importing.current) return
    pause(); setError(null)
    if (download) { URL.revokeObjectURL(download); setDownload(null) }
    const controller = new AbortController(); exporter.current = controller
    setExporting({ message: 'Preparing export…' }); setBusy(true)
    try {
      const blob = await exportVideo(state.current, progress => { if (!controller.signal.aborted) setExporting(progress) }, controller.signal)
      const url = URL.createObjectURL(blob)
      urls.current.add(url); setDownload(url)
      setExporting({ message: 'Your video is ready', fraction: 1 })
      saveDownload(url)
      setStatus('Export complete · full-resolution H.264 video and AAC audio')
    } catch (error) {
      setExporting(null)
      if (controller.signal.aborted) setStatus('Export canceled'); else report(error)
    } finally { exporter.current = null; setBusy(false) }
  }
  function saveDownload(url: string) {
    const a = document.createElement('a'); a.href = url; a.download = 'video.mp4'; document.body.append(a); a.click(); a.remove()
  }
  const actions = useRef({ start, pause, position }); actions.current = { start, pause, position }
  useEffect(() => {
    let frame = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      if (!running.current || !engine.active) return
      const current = engine.time()
      const range = markerPlayback.current ? markerRange(state.current) : null
      const finish = range?.[1] ?? timelineEnd(state.current)
      if (current >= finish) {
        if (loopRef.current && range) { engine.stop(); void actions.current.start(true, range[0]) }
        else { actions.current.position(finish); actions.current.pause(); setStatus('Paused') }
      } else actions.current.position(current)
    }
    frame = requestAnimationFrame(tick)
    const unload = (event: BeforeUnloadEvent) => { if (state.current.clips.length) { event.preventDefault(); event.returnValue = '' } }
    const preventFileNavigation = (event: DragEvent) => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault() }
    window.addEventListener('beforeunload', unload)
    window.addEventListener('dragover', preventFileNavigation); window.addEventListener('drop', preventFileNavigation)
    return () => { cancelAnimationFrame(frame); engine.stop(); window.removeEventListener('beforeunload', unload); window.removeEventListener('dragover', preventFileNavigation); window.removeEventListener('drop', preventFileNavigation) }
  }, [engine])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || ['TEXTAREA'].includes(event.target.tagName) || event.target instanceof HTMLInputElement && !['range', 'button'].includes(event.target.type))) return
      if (exporter.current || importing.current) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo() }
      else if (event.code === 'Space') { event.preventDefault(); if (!event.repeat) togglePlay() }
      else if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        if (event.key.toLowerCase() === 'i') marker('in')
        if (event.key.toLowerCase() === 'o') marker('out')
        if (event.key.toLowerCase() === 's') split()
        if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeClip() }
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })
  return <main className="app-shell">
    <div className="editor-layout" ref={layout} style={{ gridTemplateRows: `minmax(270px, 1fr) 10px ${timelineHeight}px` }}>
      <div className="upper-workspace">
        <MediaBin media={project.media} busy={busy} importFiles={importFiles} remove={id => { pause(); setSource(null); commit({ ...state.current, media: state.current.media.filter(m => m.id !== id), clips: state.current.clips.filter(c => c.mediaId !== id) }) }} preview={media => { pause(); setSource(media) }} />
        <Preview project={project} time={time} playing={playing} loop={loop} quality={quality} source={source} busy={busy} setQuality={setQuality} rewind={() => seek(0)} rewindIn={() => seek(state.current.inPoint ?? 0)} play={togglePlay} playMarkers={() => { if (running.current) pause(); else void start(true) }} toggleLoop={toggleLoop} marker={marker} split={split} exportVideo={exportProject} />
        <Mixer project={project} engine={engine} begin={begin} finish={finish} update={updateTrack} updateMix={(value, enabled) => change({ ...state.current, loudness: value, loudnessOn: enabled })} learn={learnNoise} />
      </div>
      <div className="workspace-divider" role="separator" aria-label="Resize timeline" aria-orientation="horizontal" onPointerDown={e => e.currentTarget.setPointerCapture(e.pointerId)} onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) setTimelineHeight(clamp(layout.current!.getBoundingClientRect().bottom - e.clientY, 180, layout.current!.clientHeight - 280)) }} onPointerUp={e => e.currentTarget.releasePointerCapture(e.pointerId)} />
      <Timeline project={project} time={time} selected={selected} zoom={zoom} setZoom={setZoom} select={setSelected} seek={seek} begin={() => { pause(); setSource(null); begin() }} finish={finish} change={change} drop={drop} addTrack={addTrack} removeTrack={removeTrack} mono={track => { begin(); updateTrack(track.id, { mono: !track.mono }); finish() }} />
    </div>
    <footer className="status-bar"><span className={error ? 'status-error' : ''} aria-live="polite">{status}</span><span className="keyboard-hints"><kbd>Space</kbd> Play / pause <kbd>Ctrl+Z</kbd> Undo <kbd>S</kbd> Split <kbd>I</kbd> In <kbd>O</kbd> Out</span></footer>
    {error && <div className="error-toast" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError(null)}>×</button></div>}
    {exporting && <div className="modal-backdrop"><section className="export-dialog" role="dialog" aria-modal="true" aria-label="Export video"><div className="export-symbol"><Icon name="export" size={28} /></div><h2>{exporting.message}</h2><p>{canvasSize(project).width} × {canvasSize(project).height} · H.264 MP4 · full quality</p>{!download && <><progress max={1} value={exporting.fraction} /><p className="export-note">Everything is processed on your computer.<br />Keep this tab open while the video is encoded.</p></>}{download ? <div className="dialog-actions"><Button onClick={() => setExporting(null)}>Done</Button><Button className="action-button" icon="import" onClick={() => saveDownload(download)}>Download Again</Button></div> : <Button onClick={() => { exporter.current?.abort(); cancelFFmpeg(); setExporting(null) }}>Cancel</Button>}</section></div>}
  </main>
}
