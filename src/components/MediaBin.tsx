import { useRef, useState } from 'react'
import { timecode, type Media } from '../model'
import { Icon } from './Icon'
import { Button } from './Button'

export function MediaBin({ media, busy, importFiles, remove, preview }: { media: Media[]; busy: boolean; importFiles: (files: File[]) => void; remove: (id: string) => void; preview: (media: Media) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const count = useRef(0)
  const choose = () => input.current?.click()
  return <section className={`panel media-panel ${dragging ? 'drop-active' : ''}`} aria-label="Media library" onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); count.current++; setDragging(true) } }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }} onDragLeave={() => { count.current = Math.max(0, count.current - 1); if (!count.current) setDragging(false) }} onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); count.current = 0; setDragging(false); importFiles(Array.from(event.dataTransfer.files)) } }}>
    <header className="panel-header"><Icon name="folder" /><h2>Media</h2><span className="badge">{media.length}</span><Button icon="import" className="action-button" onClick={choose} disabled={busy}>Import</Button></header>
    <input ref={input} type="file" accept="video/*,audio/*,.mkv,.mov,.m4v,.wav,.mp3,.flac,.ogg,.m4a" multiple hidden onChange={event => { importFiles(Array.from(event.target.files || [])); event.target.value = '' }} />
    <div className="media-list">
      {!media.length && <div className="empty-state"><button className="empty-folder" aria-label="Import video or audio" onClick={choose} disabled={busy}><Icon name="folder" size={28} /></button><h3>Import video or audio</h3><p>Drag it onto the timeline to begin</p></div>}
      {media.map(item => <article key={item.id} className="media-card" draggable={!busy} onDragStart={event => { event.dataTransfer.setData('application/x-video-editor-media', item.id); event.dataTransfer.effectAllowed = 'copy' }} onDoubleClick={() => preview(item)} aria-label={`${item.name}, ${item.kind}`}>
        <div className="media-thumbnail">{item.thumbnail ? <img src={item.thumbnail} alt="" draggable={false} /> : <Icon name="audio" size={32} />}</div>
        <div className="media-info"><strong title={item.name}>{item.name}</strong><span>{item.kind === 'audio' ? 'Audio' : `${item.width > item.height ? 'Landscape' : item.width < item.height ? 'Portrait' : 'Square'} · ${ratio(item.width, item.height)}`}</span>{item.kind === 'video' && <span>{item.width} × {item.height}</span>}<span>{timecode(item.duration)}</span></div>
        <Button icon="trash" className="remove-media" tip="Remove media" onClick={() => remove(item.id)} /></article>)}
    </div>
    {dragging && <div className="drop-message"><Icon name="import" size={30} />Drop video or audio to import</div>}
  </section>
}
function ratio(width: number, height: number) { const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a; const d = gcd(width, height); return `${width / d}:${height / d}` }
