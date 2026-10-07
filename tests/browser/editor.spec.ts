import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const labelWidth = 188
async function importFiles(page: Page, files: string[]) {
  await page.locator('input[type=file]').setInputFiles(files.map(f => `tests/fixtures/${f}`))
  await expect(page.locator('.media-card')).toHaveCount(files.length, { timeout: 60000 })
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeEnabled()
}
async function drop(page: Page, name: string, track: string, at = 0) {
  const card = page.locator('.media-card').filter({ hasText: name })
  const row = page.locator('.track-row').filter({ has: page.locator('.track-title strong', { hasText: new RegExp(`^${track}$`) }) })
  await card.dragTo(row, { targetPosition: { x: labelWidth + at * 24 + (at === 0 ? 1 : 0), y: 42 } })
  await expect(page.locator('.clip').filter({ hasText: name })).toBeVisible()
}
async function seek(page: Page, at: number) {
  const ruler = page.locator('.ruler')
  await ruler.click({ position: { x: labelWidth + at * 24, y: 15 } })
}
async function marker(page: Page, at: number, which: 'In' | 'Out') {
  await seek(page, at)
  await page.getByRole('button', { name: new RegExp(`Set \\(or remove\\) ${which} marker`) }).click()
}

test('imports, plays audible tracks, edits, loops, and undoes', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('./')
  await importFiles(page, ['landscape.mp4', 'music.wav'])
  await drop(page, 'landscape.mp4', 'Video', 2)
  await expect(page.getByLabel('Playhead time')).toHaveText('00:02.00')
  await drop(page, 'music.wav', 'Audio', 2)
  await page.getByRole('button', { name: 'Play (Space)', exact: true }).click()
  await expect(page.getByLabel('Playhead time')).not.toHaveText('00:02.00')
  await expect.poll(async () => page.locator('.audio-meter').first().evaluate(canvas => {
    const c = canvas as HTMLCanvasElement
    const pixels = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 1] > 150) return true
    return false
  })).toBe(true)
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: 'Play (Space)', exact: true })).toBeVisible()
  await seek(page, 4)
  await page.locator('.clip[data-media-name="landscape.mp4"]').click({ position: { x: 45, y: 35 } })
  await page.keyboard.press('s')
  await expect(page.locator('.video-clip')).toHaveCount(2)
  await page.keyboard.press('Control+z')
  await expect(page.locator('.video-clip')).toHaveCount(1)
  await page.getByRole('button', { name: 'Add video track', exact: true }).click()
  const videoClip = page.locator('.video-clip')
  const rect = await videoClip.boundingBox()
  await page.mouse.move(rect!.x + 35, rect!.y + 40)
  await page.mouse.down()
  await page.mouse.move(rect!.x + 35, rect!.y + 40 + 82, { steps: 8 })
  await page.mouse.up()
  await expect(videoClip).toHaveAttribute('aria-label', /Video 2/)
  await marker(page, 2, 'In')
  await marker(page, 3, 'Out')
  await page.getByRole('button', { name: 'Loop between In and Out markers', exact: true }).click()
  await page.getByRole('button', { name: 'Play (Space)', exact: true }).click()
  await page.waitForTimeout(2600)
  const time = await page.getByLabel('Playhead time').textContent()
  expect(time).toMatch(/^00:02\./)
  await page.keyboard.press('Space')
  await page.screenshot({ path: 'test-results/editor-active.png' })
  expect(errors).toEqual([])
})

test('removing a solo track’s last clip or media restores other audio and can be undone', async ({ page }) => {
  await page.goto('./')
  await importFiles(page, ['landscape.mp4', 'music.wav'])
  await drop(page, 'landscape.mp4', 'Video')
  await drop(page, 'music.wav', 'Audio')
  const solo = page.locator('.audio-channel .solo-button')
  await solo.click()
  await page.locator('.audio-clip').click({ position: { x: 45, y: 35 } })
  await page.keyboard.press('Delete')
  await expect(page.locator('.audio-clip')).toHaveCount(0)
  await expect(solo).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press('Control+z')
  await expect(page.locator('.audio-clip')).toHaveCount(1)
  await expect(solo).toHaveAttribute('aria-pressed', 'true')
  await page.locator('.media-card').filter({ hasText: 'music.wav' }).getByRole('button', { name: 'Remove media' }).click()
  await expect(page.locator('.audio-clip')).toHaveCount(0)
  await expect(solo).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: 'Play (Space)', exact: true }).click()
  await expect.poll(() => page.locator('.audio-meter').first().evaluate(canvas => {
    const c = canvas as HTMLCanvasElement
    const pixels = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 1] > 150) return true
    return false
  }), { timeout: 2500 }).toBe(true)
})

test('portrait export downloads full resolution with trimmed markers and processed audio', async ({ page }, info) => {
  await page.goto('./')
  await importFiles(page, ['portrait.mp4'])
  await drop(page, 'portrait.mp4', 'Video')
  await expect(page.locator('.preview-format')).toContainText('180 × 320')
  const clip = page.locator('.video-clip')
  const box = await clip.boundingBox()
  // Fade the picture and its sound over the first second.
  await page.mouse.move(box!.x + 5, box!.y + 8)
  await page.mouse.down(); await page.mouse.move(box!.x + 29, box!.y + 8, { steps: 6 }); await page.mouse.up()
  await marker(page, .5, 'In')
  await marker(page, 2.5, 'Out')
  await page.getByRole('slider', { name: 'Compress', exact: true }).first().press('ArrowUp')
  const download = page.waitForEvent('download', { timeout: 90000 })
  await page.getByRole('button', { name: /^Export between/ }).click()
  const saved = await download
  expect(saved.suggestedFilename()).toBe('video.mp4')
  const path = info.outputPath('portrait-export.mp4')
  await saved.saveAs(path)
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], { encoding: 'utf8' }))
  const video = probe.streams.find((s: any) => s.codec_type === 'video')
  const audio = probe.streams.find((s: any) => s.codec_type === 'audio')
  expect([video.width, video.height, video.codec_name]).toEqual([180, 320, 'h264'])
  expect(audio.codec_name).toBe('aac')
  expect(Number(probe.format.duration)).toBeCloseTo(2, 1)
  // Verify audible decoded audio, not merely an audio stream in the container.
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', '48000', '-'])
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  let peak = 0
  for (let i = 0; i < pcm.length; i += 4) peak = Math.max(peak, Math.abs(view.getFloat32(i, true)))
  expect(peak).toBeGreaterThan(.02)
  expect(peak).toBeLessThan(1)
})

test('desktop file drop imports locally without a file chooser or uploads', async ({ page }) => {
  const requests: string[] = []
  page.on('request', request => requests.push(request.url()))
  await page.goto('./')
  const bytes = Array.from(await readFile('tests/fixtures/music.wav'))
  await page.locator('.media-panel').evaluate((panel, bytes) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([new Uint8Array(bytes)], 'dropped-song.wav', { type: 'audio/wav' }))
    panel.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
  }, bytes)
  await expect(page.locator('.media-card')).toContainText('dropped-song.wav', { timeout: 60000 })
  expect(requests.filter(url => !url.startsWith('http://127.0.0.1:4173/') && !url.startsWith('blob:') && !url.startsWith('data:'))).toEqual([])
  await page.locator('.media-card').getByRole('button', { name: 'Remove media' }).click()
  await expect(page.locator('.empty-folder')).toBeVisible()
  await page.keyboard.press('Control+z')
  await expect(page.locator('.media-card')).toHaveCount(1)
})

test('preview fills its pane, marker play pauses at Out, and denoise Learn works', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('./')
  await importFiles(page, ['landscape.mp4'])
  await drop(page, 'landscape.mp4', 'Video')
  const frame = page.getByLabel('Video preview frame')
  const rectangle = await frame.boundingBox()
  expect(rectangle!.width).toBeGreaterThan(600)
  expect(rectangle!.height).toBeGreaterThan(350)
  await expect(frame).toHaveAttribute('width', '160')
  await page.getByLabel('Preview resolution').selectOption('1')
  await expect(frame).toHaveAttribute('width', '320')
  await marker(page, .5, 'In')
  await marker(page, 1.5, 'Out')
  await page.getByRole('button', { name: 'Learn', exact: true }).first().click()
  await expect(page.locator('.status-bar')).toContainText('Noise learned')
  await expect(page.getByRole('button', { name: 'Learn', exact: true }).first()).toHaveText('Learned')
  await expect(page.getByRole('button', { name: 'Learn', exact: true }).first()).toHaveText('Learn', { timeout: 3000 })
  await page.getByRole('slider', { name: 'Denoise', exact: true }).first().press('ArrowUp')
  await seek(page, 1)
  await page.getByRole('button', { name: 'Play between In and Out markers', exact: true }).click()
  await expect(page.getByLabel('Playhead time')).toHaveText('00:01.50')
  await expect(page.getByRole('button', { name: 'Play (Space)', exact: true })).toBeVisible()
  await seek(page, .8)
  await page.waitForTimeout(150)
  await expect(page.getByRole('button', { name: 'Play (Space)', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Play (Space)', exact: true }).click()
  await expect.poll(async () => Number((await page.getByLabel('Playhead time').textContent())!.split(':')[1])).toBeGreaterThan(1.7)
  await page.keyboard.press('Space')
  expect(errors).toEqual([])
})

test('cached app imports and exports with the network disconnected', async ({ page, context }, info) => {
  await page.goto('./')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }))
  })
  await importFiles(page, ['portrait.mp4'])
  await expect.poll(() => page.evaluate(async () => Boolean(await caches.match(new URL('ffmpeg/ffmpeg-core.wasm', location.href))))).toBe(true)
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Import video or audio', exact: true })).toBeVisible()
  await importFiles(page, ['portrait.mp4'])
  await drop(page, 'portrait.mp4', 'Video')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /^Export between/ }).click()
  const result = await download
  await result.saveAs(info.outputPath('offline-export.mp4'))
  await expect(page.getByRole('heading', { name: 'Your video is ready' })).toBeVisible()
})

test('unsupported browser video gets a local preview proxy and still exports', async ({ page }) => {
  await page.goto('./')
  await importFiles(page, ['legacy.avi'])
  await drop(page, 'legacy.avi', 'Video')
  await expect(page.locator('.preview-format')).toContainText('160 × 120')
  await expect.poll(() => page.getByLabel('Video preview frame').evaluate(canvas => {
    const c = canvas as HTMLCanvasElement
    return c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data.some((value, i) => i % 4 !== 3 && value > 100)
  })).toBe(true)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /^Export between/ }).click()
  await download
  await expect(page.getByRole('heading', { name: 'Your video is ready' })).toBeVisible()
})

test('canceling an export leaves the session usable for another export', async ({ page }) => {
  await page.goto('./')
  await importFiles(page, ['portrait.mp4'])
  await drop(page, 'portrait.mp4', 'Video')
  await page.getByRole('button', { name: /^Export between/ }).click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByRole('button', { name: /^Export between/ })).toBeEnabled()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /^Export between/ }).click()
  await download
  await expect(page.getByRole('heading', { name: 'Your video is ready' })).toBeVisible()
})

async function observeBrowserRenderer(page: Page) {
  await page.addInitScript(() => {
    const results: string[] = []
    ;(window as any).videoRenderResults = results
    window.Worker = new Proxy(Worker, { construct(Target, args) {
      const worker = Reflect.construct(Target, args) as Worker
      if (String(args[0]).includes('video-export.worker')) worker.addEventListener('message', event => {
        if (event.data.type !== 'progress') results.push(event.data.type)
      })
      return worker
    } })
  })
}
function rgbFrame(path: string, at: number, width = 320, height = 180) {
  return execFileSync('ffmpeg', ['-v', 'error', '-ss', String(at), '-i', path, '-frames:v', '1', '-vf', `scale=${width}:${height}`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'])
}

test('browser export preserves marker trims, layer order, fades, gaps and letterboxing', async ({ page }, info) => {
  await observeBrowserRenderer(page)
  await page.goto('./')
  await importFiles(page, ['blue.mp4', 'red.mp4'])
  await page.getByRole('button', { name: 'Add video track', exact: true }).click()
  await drop(page, 'blue.mp4', 'Video 2', 1)
  await drop(page, 'red.mp4', 'Video', 2)
  const red = await page.locator('.clip[data-media-name="red.mp4"]').boundingBox()
  await page.mouse.move(red!.x + 5, red!.y + 8)
  await page.mouse.down(); await page.mouse.move(red!.x + 29, red!.y + 8, { steps: 6 }); await page.mouse.up()
  await page.mouse.move(red!.x + red!.width - 5, red!.y + 8)
  await page.mouse.down(); await page.mouse.move(red!.x + red!.width - 53, red!.y + 8, { steps: 6 }); await page.mouse.up()
  await marker(page, .5, 'In')
  await marker(page, 5.5, 'Out')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /^Export between/ }).click()
  const saved = await download
  const path = info.outputPath('composite.mp4')
  await saved.saveAs(path)
  expect(await page.evaluate(() => (window as any).videoRenderResults)).toEqual(['complete'])
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', path], { encoding: 'utf8' }))
  const video = probe.streams.find((s: any) => s.codec_type === 'video')
  expect([video.width, video.height, Number(video.nb_read_frames)]).toEqual([320, 180, 150])
  expect(Number(probe.format.duration)).toBeCloseTo(5, 1)
  const pixel = (frame: Buffer, x: number) => [...frame.subarray((90 * 320 + x) * 3, (90 * 320 + x) * 3 + 3)]
  const close = (actual: number[], expected: number[]) => actual.forEach((channel, i) => expect(Math.abs(channel - expected[i])).toBeLessThan(18))
  close(pixel(rgbFrame(path, .25), 160), [0, 0, 0])
  close(pixel(rgbFrame(path, 1), 160), [0, 0, 255])
  close(pixel(rgbFrame(path, 2), 160), [128, 0, 128])
  close(pixel(rgbFrame(path, 2), 20), [0, 0, 128])
  close(pixel(rgbFrame(path, 3), 160), [255, 0, 0])
  close(pixel(rgbFrame(path, 3), 20), [0, 0, 0])
  close(pixel(rgbFrame(path, 4), 160), [191, 0, 64])
  close(pixel(rgbFrame(path, 4.75), 160), [96, 0, 0])
})

test('browser export honors phone rotation metadata', async ({ page }, info) => {
  await observeBrowserRenderer(page)
  await page.goto('./')
  await importFiles(page, ['rotated.mp4'])
  await drop(page, 'rotated.mp4', 'Video')
  await marker(page, .5, 'In')
  await marker(page, 2.5, 'Out')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /^Export between/ }).click()
  const path = info.outputPath('rotation.mp4')
  await (await download).saveAs(path)
  expect(await page.evaluate(() => (window as any).videoRenderResults)).toEqual(['complete'])
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', path], { encoding: 'utf8' }))
  const video = probe.streams.find((s: any) => s.codec_type === 'video')
  expect([video.width, video.height]).toEqual([180, 320])
  const expected = rgbFrame('tests/fixtures/rotated.mp4', 1, 180, 320)
  const actual = rgbFrame(path, .5, 180, 320)
  expect(actual.length).toBe(expected.length)
  const meanError = actual.reduce((sum, value, i) => sum + Math.abs(value - expected[i]), 0) / actual.length
  expect(meanError).toBeLessThan(10)
})

test('export falls back to WASM when browser encoding is unavailable', async ({ page }, info) => {
  await page.addInitScript(() => Object.defineProperty(window, 'VideoEncoder', { configurable: true, value: undefined }))
  await page.goto('./')
  await importFiles(page, ['portrait.mp4'])
  await drop(page, 'portrait.mp4', 'Video')
  await marker(page, .5, 'In')
  await marker(page, 1.5, 'Out')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /^Export between/ }).click()
  const saved = await download
  expect(saved.suggestedFilename()).toBe('video.mp4')
  const path = info.outputPath('fallback.mp4')
  await saved.saveAs(path)
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], { encoding: 'utf8' }))
  const video = probe.streams.find((s: any) => s.codec_type === 'video')
  expect([video.width, video.height, video.codec_name]).toEqual([180, 320, 'h264'])
  expect(Number(probe.format.duration)).toBeCloseTo(1, 1)
})

for (const extension of ['mp3', 'wav', 'm4a']) test(`file drop recognizes ${extension} cover art as audio without reading the entire file`, async ({ page }) => {
  await page.addInitScript(() => {
    File.prototype.arrayBuffer = async () => { throw new Error('Whole-file audio/probe read') }
    const durations: number[] = []
    ;(window as any).decodedDurations = durations
    window.OfflineAudioContext = new Proxy(OfflineAudioContext, { construct(Target, args) {
      durations.push(args[1] / args[2])
      return Reflect.construct(Target, args)
    } })
    const decode = AudioContext.prototype.decodeAudioData
    AudioContext.prototype.decodeAudioData = function (bytes, ...args) {
      if (bytes.byteLength > 8.3 * 48000 * 2 * 4 + 4096) throw new Error('Unbounded audio decode')
      return decode.call(this, bytes, ...args)
    }
  })
  await page.goto('./')
  await page.locator('input[type=file]').setInputFiles(`tests/fixtures/covered.${extension}`)
  // Exercise both import paths, including a desktop drop with an empty MIME type.
  await expect(page.locator('.media-card')).toHaveCount(1)
  await page.locator('.media-card').getByRole('button', { name: 'Remove media' }).click()
  const bytes = Array.from(await readFile(`tests/fixtures/covered.${extension}`))
  await page.locator('.media-panel').evaluate((panel, { bytes, extension }) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([new Uint8Array(bytes)], `song.${extension}`))
    panel.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
  }, { bytes, extension })
  await expect(page.locator('.media-card')).toHaveAttribute('aria-label', `song.${extension}, audio`)
  await expect(page.locator('.media-card img')).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await drop(page, `song.${extension}`, 'Audio')
  await seek(page, 7.5)
  await page.getByRole('button', { name: 'Play (Space)', exact: true }).click()
  await expect.poll(async () => Number((await page.getByLabel('Playhead time').textContent())!.split(':')[1])).toBeGreaterThan(9)
  await expect.poll(() => page.locator('.audio-meter').first().evaluate(canvas => {
    const c = canvas as HTMLCanvasElement
    return c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data.some((value, i) => i % 4 === 1 && value > 150)
  })).toBe(true)
  expect(await page.evaluate(() => Math.max(0, ...(window as any).decodedDurations))).toBeLessThanOrEqual(8.3)
})

test('repeated play and stop releases nodes and recovers a suspended or closed audio context', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    const contexts: AudioContext[] = []
    const nodes: AudioWorkletNode[] = []
    const retired = new Set<AudioWorkletNode>()
    ;(window as any).audioTest = { contexts, nodes, retired }
    const addModule = AudioWorklet.prototype.addModule
    AudioWorklet.prototype.addModule = async function (url, options) {
      const source = await (await fetch(url)).text()
      const observed = `
        let active = 0;
        function observeProcessor(name, Processor) {
          registerProcessor(name, class extends Processor {
            constructor() {
              super(); active++;
              this.port.addEventListener('message', event => { if (event.data.testFail) this.testFail = true; });
            }
            process(...args) {
              if (this.testFail) throw new Error('Test audio processor failure');
              const alive = super.process(...args);
              if (!alive && !this.retired) { this.retired = true; active--; }
              return alive;
            }
          });
        }
        ${source.replace('registerProcessor(', 'observeProcessor(')}
        registerProcessor('lifetime-monitor', class extends AudioWorkletProcessor {
          process() { this.port.postMessage(active); return true; }
        });`
      const blob = URL.createObjectURL(new Blob([observed], { type: 'text/javascript' }))
      try { await addModule.call(this, blob, options) } finally { URL.revokeObjectURL(blob) }
    }
    window.AudioContext = new Proxy(AudioContext, { construct(Target, args) {
      const context = Reflect.construct(Target, args) as AudioContext
      contexts.push(context)
      return context
    } })
    window.AudioWorkletNode = new Proxy(AudioWorkletNode, { construct(Target, args) {
      const node = Reflect.construct(Target, args) as AudioWorkletNode
      if (args[1] === 'lifetime-monitor') return node
      nodes.push(node)
      const post = node.port.postMessage.bind(node.port)
      node.port.postMessage = (data: any) => { if (data.dispose) retired.add(node); post(data) }
      return node
    } })
  })
  await page.goto('./')
  await importFiles(page, ['covered.wav'])
  await drop(page, 'covered.wav', 'Audio')
  for (let i = 0; i < 30; i++) {
    await page.getByRole('button', { name: 'Play (Space)', exact: true }).click()
    await expect(page.locator('.status-bar')).toContainText('Playing')
    await page.getByRole('button', { name: 'Pause (Space)', exact: true }).click()
  }
  expect(await page.evaluate(() => { const { nodes, retired } = (window as any).audioTest; return nodes.length - retired.size })).toBe(0)
  await page.evaluate(() => {
    const test = (window as any).audioTest
    const monitor = new AudioWorkletNode(test.contexts.at(-1), 'lifetime-monitor')
    monitor.port.onmessage = event => { test.active = event.data }
    monitor.connect(test.contexts.at(-1).destination)
  })
  await expect.poll(() => page.evaluate(() => (window as any).audioTest.active)).toBe(0)
  await page.getByRole('button', { name: 'Play (Space)', exact: true }).click()
  await expect(page.locator('.status-bar')).toContainText('Playing')
  await page.evaluate(() => (window as any).audioTest.contexts.at(-1).suspend())
  await expect(page.getByRole('alert')).toContainText('interrupted')
  await page.getByRole('button', { name: 'Play (Space)', exact: true }).click()
  await expect(page.locator('.status-bar')).toContainText('Playing')
  await page.evaluate(() => (window as any).audioTest.contexts.at(-1).close())
  await expect(page.getByRole('alert')).toContainText('interrupted')
  await page.getByRole('button', { name: 'Play (Space)', exact: true }).click()
  await expect(page.locator('.status-bar')).toContainText('Playing')
  await expect.poll(() => page.evaluate(() => (window as any).audioTest.nodes.filter((node: AudioWorkletNode) => node.onprocessorerror).length)).toBe(3)
  await page.evaluate(() => (window as any).audioTest.nodes.find((node: AudioWorkletNode) => node.onprocessorerror).port.postMessage({ testFail: true }))
  await expect(page.getByRole('alert')).toContainText('audio processor stopped')
  await page.getByRole('button', { name: 'Play (Space)', exact: true }).click()
  await expect(page.locator('.status-bar')).toContainText('Playing')
  await expect.poll(() => page.locator('.audio-meter').first().evaluate(canvas => {
    const c = canvas as HTMLCanvasElement
    return c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data.some((value, i) => i % 4 === 1 && value > 150)
  })).toBe(true)
  expect(errors).toEqual([])
})

for (const extension of ['wav', 'mp3', 'm4a']) test(`${extension} audio stays continuous across decoded and mixed sections`, async ({ page }, info) => {
  // Exercise the AAC fallback while retaining native video encoding.
  if (extension === 'm4a') await page.addInitScript(() => Object.defineProperty(window, 'AudioDecoder', { configurable: true, value: undefined }))
  await page.goto('./')
  await importFiles(page, [`covered.${extension}`, 'portrait.mp4'])
  await drop(page, `covered.${extension}`, 'Audio')
  await marker(page, .5, 'In')
  await marker(page, 18.5, 'Out')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /^Export between/ }).click()
  const path = info.outputPath('sectioned-audio.mp4')
  await (await download).saveAs(path)
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'f32le', '-ac', '2', '-ar', '48000', '-'], { maxBuffer: 8 * 1024 * 1024 })
  const samples = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4)
  expect(samples.length / 2 / 48000).toBeCloseTo(18, 1)
  // Every 10 ms around each chunk boundary must contain sound, with no splice jumps.
  for (const boundary of [3.5, 4, 7.5, 8, 11.5, 12, 15.5, 16]) {
    const start = Math.round((boundary - .02) * 48000)
    for (let offset = start; offset < start + 1920; offset += 480) {
      for (let channel = 0; channel < 2; channel++) {
        let energy = 0, jump = 0
        for (let i = offset; i < offset + 480; i++) {
          energy += samples[i * 2 + channel] ** 2
          jump = Math.max(jump, Math.abs(samples[i * 2 + channel] - samples[(i - 1) * 2 + channel]))
        }
        expect(Math.sqrt(energy / 480)).toBeGreaterThan(.08)
        expect(jump).toBeLessThan(.04)
      }
    }
  }
})
