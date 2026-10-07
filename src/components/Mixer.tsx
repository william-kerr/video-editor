import { memo, useEffect, useId, useRef, useState } from 'react'
import { clamp, type Project, type Track } from '../model'
import type { AudioPlayback } from '../audio/playback'
import { Button } from './Button'
import { Icon } from './Icon'

interface MixerProps {
  project: Project; engine: AudioPlayback; begin: () => void; finish: () => void
  update: (id: string, patch: Partial<Track>) => void; updateMix: (value: number, enabled: boolean) => void; learn: (id: string) => Promise<boolean>
}
export const Mixer = memo(function Mixer({ project, engine, begin, finish, update, updateMix, learn }: MixerProps) {
  const active = (id: string) => project.clips.some(c => c.trackId === id && project.media.find(m => m.id === c.mediaId)?.hasAudio)
  const any = project.tracks.some(t => active(t.id))
  return <section className="panel mixer-panel" aria-label="Audio mixer">
    <header className="panel-header"><Icon name="mixer" /><h2>Audio mixer</h2><span className="sample-rate">48 kHz</span></header>
    <div className="mixer-channels">
      <div className={`channel mix-channel ${any ? '' : 'channel-disabled'}`}>
        <div className="channel-heading"><Icon name="mixer" /><h3>Mix</h3></div>
        <div className="knob-rack single-knob"><Knob label="Loudness" value={project.loudness} max={24} enabled={project.loudnessOn} disabled={!any} unit="dB" tip="Boost the combined mix while keeping peaks below −1 dB." begin={begin} finish={finish} onChange={value => updateMix(value, value > 0 || project.loudnessOn)} onToggle={() => updateMix(project.loudness, !project.loudnessOn)} caption="Ceiling −1 dB" /></div>
        <Meter id="mix" engine={engine} />
      </div>
      {project.tracks.map(track => <div key={track.id} className={`channel ${track.kind}-channel ${active(track.id) ? '' : 'channel-disabled'}`}>
        <div className="channel-heading"><Icon name={track.kind} /><h3>{track.name}</h3><div className="channel-actions"><Button icon="ear" tip={track.solo ? 'Unsolo' : 'Solo'} className={`solo-button ${track.solo ? 'is-active' : ''}`} aria-pressed={track.solo} disabled={!active(track.id)} onClick={() => { begin(); update(track.id, { solo: !track.solo }); finish() }} /><Button icon={track.mute ? 'muted' : 'speaker'} tip={track.mute ? 'Unmute' : 'Mute'} aria-pressed={track.mute} disabled={!active(track.id)} onClick={() => { begin(); update(track.id, { mute: !track.mute }); finish() }} /></div></div>
        <div className="knob-rack">
          <Knob label="Denoise" value={track.denoise} max={100} enabled={track.denoiseOn} disabled={!active(track.id)} unit="%" tip="Reduce steady background noise while preserving the sound you want." begin={begin} finish={finish} onChange={value => update(track.id, { denoise: value, denoiseOn: value > 0 || track.denoiseOn })} onToggle={() => update(track.id, { denoiseOn: !track.denoiseOn })} caption={<LearnButton disabled={!active(track.id)} learn={() => learn(track.id)} />} />
          <Knob label="Compress" value={track.compression} max={100} enabled={track.compressionOn} disabled={!active(track.id)} unit="%" tip="Even out quiet and loud audio." begin={begin} finish={finish} onChange={value => update(track.id, { compression: value, compressionOn: value > 0 || track.compressionOn })} onToggle={() => update(track.id, { compressionOn: !track.compressionOn })} caption="Even level" />
        </div>
        <Meter id={track.id} engine={engine} />
        <input className="gain-slider" style={{ '--range-fill': `${(track.gain + 60) / 72 * 100}%` } as React.CSSProperties} type="range" min="-60" max="12" step="0.1" value={track.gain} aria-label={`${track.name} gain in decibels`} disabled={!active(track.id)} onPointerDown={begin} onPointerUp={finish} onBlur={finish} onKeyDown={event => { if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') begin() }} onKeyUp={finish} onChange={event => update(track.id, { gain: Number(event.target.value) })} onDoubleClick={() => { begin(); update(track.id, { gain: 0 }); finish() }} />
        <div className="gain-notch" />
      </div>)}
    </div>
  </section>
})
function LearnButton({ disabled, learn }: { disabled: boolean; learn: () => Promise<boolean> }) {
  const [state, setState] = useState<'idle' | 'learning' | 'learned'>('idle')
  const timer = useRef(0)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearTimeout(timer.current) } }, [])
  async function onClick() {
    clearTimeout(timer.current)
    setState('learning')
    const learned = await learn()
    if (!mounted.current) return
    setState(learned ? 'learned' : 'idle')
    if (learned) timer.current = window.setTimeout(() => setState('idle'), 1500)
  }
  return <button className={`learn-button ${state === 'learned' ? 'learn-complete' : ''}`} aria-label="Learn" data-tip="Learn background noise between In and Out markers. Select 0.25–10 seconds of noise without the sound you want to keep." disabled={disabled || state === 'learning'} onClick={onClick}><span role="status">{state === 'learned' ? 'Learned' : state === 'learning' ? 'Learning…' : 'Learn'}</span></button>
}
interface KnobProps {
  label: string; value: number; max: number; unit: '%' | 'dB'; enabled: boolean; disabled: boolean; tip: string; caption: React.ReactNode
  begin: () => void; finish: () => void; onChange: (value: number) => void; onToggle: () => void
}
function Knob({ label, value, max, unit, enabled, disabled, tip, caption, begin, finish, onChange, onToggle }: KnobProps) {
  const gesture = useRef<{ x: number; y: number; value: number } | null>(null)
  const gradientId = useId()
  const angle = -135 + value / max * 270
  return <div className={`effect effect-${label.toLowerCase()} ${enabled ? 'effect-on' : ''}`}>
    <button className="effect-power" data-tip={tip} disabled={disabled} aria-label={`${label} enabled`} aria-pressed={enabled} onClick={() => { begin(); onToggle(); finish() }}><Icon name="power" size={11} />{label}</button>
    <div className="rotary" role="slider" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-valuetext={`${Math.round(value)}${unit}`} onPointerDown={event => { if (disabled) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); gesture.current = { x: event.clientX, y: event.clientY, value }; begin() }} onPointerMove={event => { const start = gesture.current; if (!start) return; onChange(Math.round(clamp(start.value + (start.y - event.clientY + (event.clientX - start.x) * .5) * max / (event.shiftKey ? 900 : 180), 0, max) * 10) / 10) }} onPointerUp={event => { if (gesture.current) { gesture.current = null; event.currentTarget.releasePointerCapture(event.pointerId); finish() } }} onPointerCancel={() => { gesture.current = null; finish() }} onDoubleClick={() => { if (!disabled) { begin(); onChange(0); finish() } }} onKeyDown={event => { if (!disabled && ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'Home', 'End'].includes(event.key)) { event.preventDefault(); begin(); onChange(event.key === 'Home' ? 0 : event.key === 'End' ? max : clamp(value + (['ArrowUp', 'ArrowRight'].includes(event.key) ? 1 : -1) * (event.shiftKey ? .1 : 1), 0, max)); finish() } }}>
      <svg viewBox="0 0 76 76" aria-hidden="true">
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#62788e" /><stop offset=".45" stopColor="#3f5167" /><stop offset="1" stopColor="#2b3b50" /></linearGradient></defs>
        {Array.from({ length: 21 }, (_, i) => <path key={i} d="M38 2v2" transform={`rotate(${-135 + i * 13.5} 38 38)`} className={i / 20 <= value / max && enabled ? 'tick-lit' : 'tick'} />)}
        <path d="M16.08 59.92A31 31 0 1 1 59.92 59.92" className="knob-arc" />
        {enabled && value > 0 && <path d="M16.08 59.92A31 31 0 1 1 59.92 59.92" pathLength="100" strokeDasharray={`${value / max * 100} 100`} className="knob-arc knob-arc-active" />}
        <circle cx="38" cy="40" r="26" className="knob-shadow" />
        <circle cx="38" cy="37" r="25" fill={`url(#${gradientId})`} className="knob-face" />
        <circle cx="38" cy="37" r="18" className="knob-inner" />
        <path d="M38 15v8" transform={`rotate(${angle} 38 38)`} className="knob-indicator" />
      </svg>
    </div>
    <output className="knob-value">{unit === '%' ? `${Math.round(value)}%` : `+${value.toFixed(1)} dB`}</output>
    <div className="effect-caption">{caption}</div>
  </div>
}
function Meter({ id, engine }: { id: string; engine: AudioPlayback }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let frame = 0, displayed = 0, clippedUntil = 0, last = 0
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw)
      if (now - last < 40 || !canvas.current) return
      last = now
      const element = canvas.current, ratio = devicePixelRatio || 1
      const width = Math.round(element.clientWidth * ratio), height = Math.round(8 * ratio)
      if (element.width !== width || element.height !== height) { element.width = width; element.height = height }
      const ctx = element.getContext('2d')!
      const peak = engine.peaks.get(id) || 0
      displayed = Math.max(peak, displayed * .78)
      if (peak >= 1) clippedUntil = now + 1500
      const green = Math.max(1, Math.floor((element.clientWidth + 2) / 7) - 9), count = green + 9
      const gap = Math.round(2 * ratio), size = Math.max(1, Math.floor((width - gap * (count - 1)) / count))
      const left = Math.floor((width - count * size - gap * (count - 1)) / 2)
      ctx.clearRect(0, 0, width, height)
      const db = 20 * Math.log10(Math.max(1e-8, displayed))
      for (let i = 0; i < count; i++) {
        const threshold = i < green ? -60 + i / green * 42 : i < green + 6 ? -18 + (i - green) * 2 : -6 + (i - green - 6) * 2
        ctx.fillStyle = i === count - 1 && now < clippedUntil ? '#ff3838' : i < green ? db >= threshold ? '#57d5a3' : '#273e39' : i < green + 6 ? db >= threshold ? '#e6c16b' : '#433d2f' : db >= threshold ? '#f27d88' : '#442e36'
        ctx.fillRect(left + i * (size + gap), 0, size, height)
      }
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [id, engine])
  return <canvas ref={canvas} className="audio-meter" aria-label="Audio level meter" />
}
