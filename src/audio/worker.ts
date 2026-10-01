import { autoProfile, denoise, learnProfile } from './spectral'
import { mixAudio } from './mix'

self.onmessage = (event: MessageEvent) => {
  const { id, action, channels, profile, mix } = event.data
  try {
    if (action === 'learn') { self.postMessage({ id, profile: learnProfile(channels) }); return }
    if (action === 'mix') {
      const wav = mixAudio(mix)
      self.postMessage({ id, wav }, { transfer: [wav.buffer] }); return
    }
    const thresholds = profile || autoProfile(channels)
    const wet = denoise(channels, thresholds)
    self.postMessage({ id, channels: wet, profile: thresholds }, { transfer: wet.map(c => c.buffer) })
  } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : String(error) }) }
}
