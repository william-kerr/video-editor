export type Kind = 'video' | 'audio'
export interface Media {
  id: string
  name: string
  file: File
  url: string
  kind: Kind
  duration: number
  width: number
  height: number
  fps: number
  thumbnail?: string
  audio?: AudioBuffer
  peaks: Float32Array[]
  autoProfile?: number[]
}
export interface Clip {
  id: string
  mediaId: string
  trackId: string
  start: number
  sourceIn: number
  sourceOut: number
  fadeIn: number
  fadeOut: number
}
export interface Track {
  id: string
  name: string
  kind: Kind
  primary: boolean
  mono: boolean
  mute: boolean
  solo: boolean
  gain: number
  denoise: number
  denoiseOn: boolean
  compression: number
  compressionOn: boolean
  noiseProfile?: number[]
}
export interface Project {
  media: Media[]
  clips: Clip[]
  tracks: Track[]
  inPoint: number | null
  outPoint: number | null
  loudness: number
  loudnessOn: boolean
}
export const uid = () => crypto.randomUUID()
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
export const duration = (clip: Clip) => clip.sourceOut - clip.sourceIn
export const end = (clip: Clip) => clip.start + duration(clip)
export const timelineEnd = (project: Project) => Math.max(0, ...project.clips.map(end))
export function newTrack(kind: Kind, name = kind === 'video' ? 'Video' : 'Audio', primary = false): Track {
  return { id: uid(), kind, name, primary, mono: false, mute: false, solo: false, gain: 0, denoise: 0, denoiseOn: false, compression: 0, compressionOn: false }
}
export function newProject(): Project {
  return { media: [], clips: [], tracks: [newTrack('video', 'Video', true), newTrack('audio', 'Audio', true)], inPoint: null, outPoint: null, loudness: 0, loudnessOn: false }
}
export function canvasSize(project: Project) {
  const videos = project.clips.filter(c => project.media.find(m => m.id === c.mediaId)?.kind === 'video').sort((a, b) => a.start - b.start)
  const media = project.media.find(m => m.id === videos[0]?.mediaId) ?? project.media.find(m => m.kind === 'video')
  return { width: even(media?.width || 1920), height: even(media?.height || 1080), fps: media?.fps || 30 }
}
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
export function exportRange(project: Project): [number, number] {
  const finish = timelineEnd(project)
  return [clamp(project.inPoint ?? 0, 0, finish), clamp(project.outPoint ?? finish, 0, finish)]
}
export function markerRange(project: Project): [number, number] | null {
  if (project.inPoint === null || project.outPoint === null || project.outPoint <= project.inPoint) return null
  return [project.inPoint, project.outPoint]
}
export function audible(track: Track, project: Project) {
  return !track.mute && (!project.tracks.some(t => t.solo) || track.solo)
}
export function timecode(seconds: number, precise = false) {
  const value = Math.max(0, seconds)
  const minutes = Math.floor(value / 60)
  const sec = Math.floor(value % 60).toString().padStart(2, '0')
  return `${minutes.toString().padStart(2, '0')}:${sec}${precise ? '.' + Math.floor((value % 1) * 100).toString().padStart(2, '0') : ''}`
}
export function snapTime(time: number, project: Project, excluded: string | null, threshold: number) {
  const targets = [0, project.inPoint, project.outPoint, ...project.clips.filter(c => c.id !== excluded).flatMap(c => [c.start, end(c)])].filter((n): n is number => n !== null)
  let nearest = time
  let distance = threshold
  for (const target of targets) {
    if (Math.abs(target - time) < distance) { nearest = target; distance = Math.abs(target - time) }
  }
  return Math.max(0, nearest)
}
export function placeClip(project: Project, clip: Clip, desired: number, trackId: string, threshold: number): Clip {
  const length = duration(clip)
  let snapped = desired
  let distance = threshold
  const targets = [0, project.inPoint, project.outPoint, ...project.clips.filter(c => c.id !== clip.id).flatMap(c => [c.start, end(c)])].filter((n): n is number => n !== null)
  for (const target of targets) for (const candidate of [target, target - length]) {
    if (candidate >= 0 && Math.abs(candidate - desired) < distance) {
      snapped = candidate
      distance = Math.abs(candidate - desired)
    }
  }
  const others = project.clips.filter(c => c.id !== clip.id && c.trackId === trackId).sort((a, b) => a.start - b.start)
  const gaps: [number, number][] = []
  let previous = 0
  for (const other of others) { if (other.start - previous >= length - 1e-6) gaps.push([previous, other.start - length]); previous = Math.max(previous, end(other)) }
  gaps.push([previous, Infinity])
  const options = gaps.map(([a, b]) => clamp(snapped, a, b))
  const start = options.reduce((best, next) => Math.abs(next - desired) < Math.abs(best - desired) ? next : best)
  return { ...clip, start, trackId }
}
export function splitClip(project: Project, selected: string | null, time: number): Project {
  const clip = project.clips.find(c => c.id === selected)
  if (!clip || time <= clip.start + 0.01 || time >= end(clip) - 0.01) return project
  const offset = time - clip.start
  const left = { ...clip, sourceOut: clip.sourceIn + offset, fadeIn: Math.min(clip.fadeIn, offset), fadeOut: 0 }
  const right = { ...clip, id: uid(), start: time, sourceIn: left.sourceOut, fadeIn: 0, fadeOut: Math.min(clip.fadeOut, end(clip) - time) }
  return { ...project, clips: project.clips.flatMap(c => c.id === clip.id ? [left, right] : [c]) }
}
export function trimClip(project: Project, clip: Clip, edge: 'left' | 'right', desired: number, threshold: number): Clip {
  const media = project.media.find(m => m.id === clip.mediaId)!
  const others = project.clips.filter(c => c.trackId === clip.trackId && c.id !== clip.id)
  const target = snapTime(desired, project, clip.id, threshold)
  let next: Clip
  if (edge === 'left') {
    const previous = Math.max(0, ...others.filter(c => end(c) <= clip.start + 0.001).map(end))
    const start = clamp(target, Math.max(previous, clip.start - clip.sourceIn), end(clip) - 0.04)
    next = { ...clip, start, sourceIn: clip.sourceIn + start - clip.start }
  } else {
    const following = Math.min(Infinity, ...others.filter(c => c.start >= end(clip) - 0.001).map(c => c.start))
    const finish = clamp(target, clip.start + 0.04, Math.min(following, clip.start + media.duration - clip.sourceIn))
    next = { ...clip, sourceOut: clip.sourceIn + finish - clip.start }
  }
  return { ...next, fadeIn: Math.min(next.fadeIn, duration(next)), fadeOut: Math.min(next.fadeOut, duration(next)) }
}
export function clipGain(clip: Clip, time: number) {
  return Math.min(clip.fadeIn ? clamp((time - clip.start) / clip.fadeIn, 0, 1) : 1, clip.fadeOut ? clamp((end(clip) - time) / clip.fadeOut, 0, 1) : 1)
}
