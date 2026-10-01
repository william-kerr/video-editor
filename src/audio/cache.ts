import { type Media, uid } from '../model'
import { audioContext } from '../media/import'
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
const cache = new Map<string, Promise<AudioBuffer>>()
export function channelsOf(buffer: AudioBuffer) { return Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, i) => buffer.getChannelData(i)) }
export function denoised(media: Media, profile?: number[]) {
  const key = media.id + (profile ? JSON.stringify(profile) : ':auto')
  if (!cache.has(key)) {
    cache.set(key, request({ action: 'denoise', channels: channelsOf(media.audio!), profile }).then(data => {
      const buffer = audioContext().createBuffer(data.channels.length, data.channels[0].length, 48000)
      data.channels.forEach((channel: Float32Array, i: number) => buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, i))
      return buffer
    }).catch(error => { cache.delete(key); throw error }))
  }
  return cache.get(key)!
}
export async function learn(channels: Float32Array[]): Promise<number[]> { return (await request({ action: 'learn', channels })).profile }
export async function renderMix(mix: MixRequest): Promise<Uint8Array> { return (await request({ action: 'mix', mix })).wav }
