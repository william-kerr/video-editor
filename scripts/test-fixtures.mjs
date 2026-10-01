import { mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
await mkdir('tests/fixtures', { recursive: true })
const ffmpeg = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' })
for (const [name, size, fps, frequency] of [['landscape', '320x180', '30', '440'], ['portrait', '180x320', '24', '660']]) {
  ffmpeg('-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=${fps}`, '-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=48000`, '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', `tests/fixtures/${name}.mp4`)
}
ffmpeg('-f', 'lavfi', '-i', 'aevalsrc=0.3*sin(2*PI*220*t)|0.2*sin(2*PI*330*t):s=48000:d=6', 'tests/fixtures/music.wav')
ffmpeg('-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=24', '-t', '1', '-c:v', 'mjpeg', 'tests/fixtures/legacy.avi')
for (const [name, color, size, fps] of [['blue', 'blue', '320x180', '30'], ['red', 'red', '180x320', '24']]) {
  ffmpeg('-f', 'lavfi', '-i', `color=c=${color}:size=${size}:rate=${fps}`, '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', `tests/fixtures/${name}.mp4`)
}
ffmpeg('-i', 'tests/fixtures/landscape.mp4', '-c', 'copy', '-metadata:s:v:0', 'rotate=90', 'tests/fixtures/rotated.mp4')
