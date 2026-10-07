const CACHE_BYTES = 64 * 1024 * 1024
const buffers = new Map<string, AudioBuffer>()
const pending = new Map<string, Promise<AudioBuffer>>()
let bytes = 0
export async function cachedBuffer(key: string, create: () => Promise<AudioBuffer>) {
  const hit = buffers.get(key)
  if (hit) { buffers.delete(key); buffers.set(key, hit); return hit }
  if (!pending.has(key)) {
    const job = create().then(buffer => {
      buffers.set(key, buffer)
      bytes += buffer.length * buffer.numberOfChannels * 4
      while (bytes > CACHE_BYTES && buffers.size) {
        const [oldest, value] = buffers.entries().next().value!
        bytes -= value.length * value.numberOfChannels * 4
        buffers.delete(oldest)
      }
      return buffer
    }).finally(() => pending.delete(key))
    pending.set(key, job)
  }
  return pending.get(key)!
}

export function retainBuffers(ids: Set<string>) {
  for (const [key, buffer] of buffers) if (!ids.has(key.split(':')[0])) {
    bytes -= buffer.length * buffer.numberOfChannels * 4; buffers.delete(key)
  }
}
