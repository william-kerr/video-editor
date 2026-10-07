import { type Media, uid } from '../model'
import { AUDIO_CHUNK, audioRange } from './source'
import { cachedBuffer } from './buffer-cache'
import type { MixRequest } from './mix'

let worker: Worker | null = null
const pending = new Map<string, { resolve: (data: any) => void; reject: (error: Error) => void }>()
function request(data: object): Promise<any> {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = event => {
      const item = pending.get(event.data.id)
      if (event.data.error) item?.reject(new Error(event.data.error)); else item?.resolve(event.data)
      pending.delete(event.data.id)
    }
    worker.onerror = event => { for (const item of pending.values()) item.reject(new Error(event.message)); pending.clear(); worker?.terminate(); worker = null }
  }
  const id = uid()
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker!.postMessage({ ...data, id }) })
}
export function channelsOf(buffer: AudioBuffer) { return Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, i) => buffer.getChannelData(i)) }
const profiles = new WeakMap<Media, Promise<number[]>>()
export function denoised(media: Media, index: number, profile?: number[]) {
  return cachedBuffer(`${media.id}:wet:${index}:${profile ? JSON.stringify(profile) : 'auto'}`, async () => {
    if (!profile) {
      if (!profiles.has(media)) profiles.set(media, audioRange(media, 0, Math.min(6, media.duration)).then(buffer => request({ action: 'auto-profile', channels: channelsOf(buffer) })).then(data => data.profile).catch(error => { profiles.delete(media); throw error }))
      profile = await profiles.get(media)!
    }
    // Overlap by whole spectral hops so chunk boundaries have the same noise filter context.
    const start = index * AUDIO_CHUNK, finish = Math.min(media.duration, start + AUDIO_CHUNK)
    const from = Math.max(0, start - .064), to = Math.min(media.duration, finish + .064)
    const dry = await audioRange(media, from, to)
    const data = await request({ action: 'denoise', channels: channelsOf(dry), profile })
    const buffer = new AudioBuffer({ numberOfChannels: 2, length: Math.max(1, Math.round((finish - start) * 48000)), sampleRate: 48000 })
    const offset = Math.round((start - from) * 48000)
    data.channels.forEach((channel: Float32Array<ArrayBuffer>, i: number) => buffer.copyToChannel(channel.subarray(offset, offset + buffer.length), i))
    return buffer
  })
}
export async function learn(channels: Float32Array[]): Promise<number[]> { return (await request({ action: 'learn', channels })).profile }
export async function renderMix(mix: MixRequest, mixId: string): Promise<Uint8Array> { return (await request({ action: 'mix', mix, mixId })).wav }
export async function releaseMix(mixId: string) { await request({ action: 'release-mix', mixId }) }
