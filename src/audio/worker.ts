import { autoProfile, denoise, learnProfile } from './spectral'
import { mixAudio, newMixState } from './mix'

const mixes = new Map<string, ReturnType<typeof newMixState>>()

self.onmessage = (event: MessageEvent) => {
  const { id, action, channels, profile, mix, mixId } = event.data
  try {
    if (action === 'learn') { self.postMessage({ id, profile: learnProfile(channels) }); return }
    if (action === 'auto-profile') { self.postMessage({ id, profile: autoProfile(channels) }); return }
    if (action === 'release-mix') { mixes.delete(mixId); self.postMessage({ id }); return }
    if (action === 'mix') {
      if (!mixes.has(mixId)) mixes.set(mixId, newMixState())
      const wav = mixAudio(mix, mixes.get(mixId))
      self.postMessage({ id, wav }, { transfer: [wav.buffer] }); return
    }
    const thresholds = profile || autoProfile(channels)
    const wet = denoise(channels, thresholds)
    self.postMessage({ id, channels: wet, profile: thresholds }, { transfer: wet.map(c => c.buffer) })
  } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : String(error) }) }
}
