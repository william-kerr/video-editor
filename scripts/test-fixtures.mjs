import { mkdir, readFile, writeFile } from 'node:fs/promises'
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
const rotation = execFileSync('ffmpeg', ['-hide_banner', '-h', 'full'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).includes('-display_rotation')
ffmpeg(...(rotation ? ['-display_rotation', '90'] : []), '-i', 'tests/fixtures/landscape.mp4', '-c', 'copy', ...(rotation ? [] : ['-metadata:s:v:0', 'rotate=90']), 'tests/fixtures/rotated.mp4')
ffmpeg('-f', 'lavfi', '-i', 'color=c=blue:s=32x32', '-frames:v', '1', 'tests/fixtures/cover.jpg')
ffmpeg('-f', 'lavfi', '-i', 'aevalsrc=0.3*sin(2*PI*220*t)|0.2*sin(2*PI*330*t):s=44100:d=24', 'tests/fixtures/covered.wav')
for (const [extension, codec] of [['mp3', 'libmp3lame'], ['m4a', 'aac']]) {
  ffmpeg('-i', 'tests/fixtures/covered.wav', '-i', 'tests/fixtures/cover.jpg', '-map', '0:a', '-map', '1:v', '-c:a', codec, '-c:v', 'copy', '-disposition:v', 'attached_pic', `tests/fixtures/covered.${extension}`)
}
// WAV cover art lives in an ID3 APIC frame inside a RIFF chunk.
const picture = Buffer.concat([Buffer.from('\0image/jpeg\0\x03\0'), await readFile('tests/fixtures/cover.jpg')])
const frame = Buffer.alloc(10)
frame.write('APIC'); frame.writeUInt32BE(picture.length, 4)
const id3 = Buffer.alloc(10)
id3.write('ID3'); id3[3] = 3
const size = frame.length + picture.length
for (let i = 0; i < 4; i++) id3[6 + i] = size >>> (7 * (3 - i)) & 127
const chunk = Buffer.alloc(8)
chunk.write('id3 '); chunk.writeUInt32LE(id3.length + size, 4)
const wav = Buffer.concat([await readFile('tests/fixtures/covered.wav'), chunk, id3, frame, picture, Buffer.alloc((id3.length + size) % 2)])
wav.writeUInt32LE(wav.length - 8, 4)
await writeFile('tests/fixtures/covered.wav', wav)
