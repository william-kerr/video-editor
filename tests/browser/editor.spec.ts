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
