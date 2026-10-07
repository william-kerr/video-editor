# Browser app

## GitHub Pages

In **Settings → Pages → Build and deployment**, change **Source** from “Deploy from a branch” to **GitHub Actions**. There is no root/docs folder selector in this mode.

The workflow in `.github/workflows/pages.yml` builds the app and publishes **`dist/`**.

Vite's base path is **`/video-editor/`**. Keep that setting for this repository's Pages site. The repository root contains source files; it is not the finished website. Do not point Pages at the source `index.html`.

Push the changes to `main`, then open the **Actions** tab to see the build and deployment. The workflow runs `npm ci`, unit tests and the production build before deploying. Pull requests run those checks without deploying. The browser suite is a separate local check. No custom secrets, backend, media server, account system, or API keys are required; deployment uses GitHub's automatically provided token.

## Development

Use Node 22.12 or newer; the Pages workflow uses Node 22. Install dependencies inside a development container, not on the WSL host. Open this repository in VS Code and choose **Dev Containers: Reopen in Container** to use `.devcontainer/devcontainer.json`. Run these commands in the container's terminal:

```sh
npm ci
npm run dev
```

Open <http://localhost:5173/video-editor/>. If VS Code has not forwarded the port automatically, forward port **5173** in its **Ports** tab. This is Vite's usual development port, configured explicitly in this repo; it does not affect the public site's URL.

For the existing WSL setup, you can also enter the running devcontainer from the host:

```sh
docker exec -it -u node -w /workspaces/video-editor video_editor bash
```

`npm ci` installs the versions in `package-lock.json` and copies the pinned FFmpeg core into `public/ffmpeg/`. The generated core files are ignored by Git. All worker and WASM assets are served by the app's own origin, including in production.

TypeScript 7 supplies the build's `tsc` command. The worklet unit test uses esbuild to transform TypeScript because TypeScript 7 no longer supplies the old JavaScript compiler API. Dependabot groups Vite, its React plugin and esbuild so compatible tooling updates can be tested together.

```sh
npm test                 # Timeline rules and audio DSP
npm run build            # Type checking, bundling, offline cache manifest
npm run preview          # Serve dist at localhost:5173/video-editor/
```

Run `npm run build` before previewing production output, and stop the development server first because both servers use port 5173. The service worker is registered only in production builds, so use `npm run preview` to check offline behavior. Localhost is supported; other hosts need HTTPS for browser APIs such as AudioWorklet and WebCodecs.

Browser checks require Chromium and native FFmpeg inside the development container. Native FFmpeg only generates test fixtures and independently inspects downloaded exports; the website uses browser-native WebCodecs with a WASM fallback. Run the following inside the included devcontainer as its `node` user:

```sh
sudo apt-get update
sudo apt-get install -y ffmpeg
npx playwright install --with-deps chromium
node scripts/test-fixtures.mjs
npm run test:browser
```

The browser suite builds and starts a production server on port 4173, so development hot reload cannot interrupt an export test. If a server is already listening on 4173, Playwright reuses it; stop a stale server before testing a new build. Tests cover real imports, audio playback, editing, cross-track movement, marker looping, downloaded portrait MP4s, local file drop, native encoding, WASM fallback, phone rotation, overlapping layers, fades, export bounds, offline use and export cancellation. Regressions also cover MP3/WAV/M4A cover art, imports without whole-file ArrayBuffer reads, bounded audio decoding, repeated playback cleanup, audio-context recovery, and stereo continuity across decoded/exported sections. Generated fixtures and test artifacts are ignored by Git.

## Controls

- Import files with the Import button, the empty media panel's folder button, or a desktop file drop into the media panel.
- Drag media onto a track. Existing clips can move between tracks of the same kind. Drag a clip's sides to trim; drag its upper corners to fade. Clip moves and trims snap to clip boundaries and set markers.
- Drag the timeline ruler to scrub the playhead and preview. Use the plus buttons to add tracks and the minus buttons to remove added tracks.
- **Space** toggles Play/Pause. **S** splits the selected clip at the playhead. **Delete/Backspace** removes the selected clip. **Ctrl+Z** or **Cmd+Z** undoes an edit.
- **I** and **O** set In and Out markers. Setting a marker at its existing position removes it. Rewind to In goes to the beginning when In is unset.
- Solo and mute control which tracks are heard. Stereo/mono is toggled in the track header. Double-click a gain slider or effect knob to return it to zero.

## Organization

- `src/model.ts`: session data, track/clip rules, trims, snapping and export bounds.
- `src/App.tsx`: session changes, Undo, keyboard shortcuts, transport and import/export orchestration.
- `src/components/`: the desktop-derived UI, timeline, media bin, preview and mixer.
- `src/media/`: local probing, thumbnails, browser preview fallback and export. `browser-export.ts` manages a cancellable WebCodecs worker; `video-export.worker.ts` decodes, composites and encodes video. `export.ts` prepares audio, muxes MP4s and retains the FFmpeg WASM fallback.
- `src/audio/spectral.ts`: the accepted spectral denoiser and noise learning.
- `src/audio/worker.ts`: noise processing and offline mix jobs away from the UI thread.
- `src/audio/dsp.ts`: shared compression, gain, stereo-linked ceiling limiter and WAV encoding.
- `src/audio/processor.ts`: AudioWorklet for live compression/gain/limiting and meters.
- `src/audio/playback.ts`: Web Audio scheduling and synchronization with the video preview.
- `scripts/`: self-hosted engine assets, offline cache generation and generated test media.

## Playback and export

Preview uses browser video decoding, a canvas compositor and Web Audio. The 25% / 50% / 100% selector changes only the preview canvas resolution; 50% halves each canvas dimension. It does not lower the source video's decoding resolution or change export quality. WASM probing reads rotation, duration and frame rate through a read-only WORKERFS mount of the selected File. Probing, preview conversion and fallback decoding/export do not copy entire source files into the WASM filesystem. Attached cover pictures are excluded from video detection, so songs with album art import as audio. A video format the browser cannot decode is converted to a temporary local preview proxy; its original file is retained for export.

Audio is decoded in eight-second sections using browser codecs when supported, with bounded WASM decoding as a fallback. A small overlap warms the codec and resampler before each section is trimmed. Waveform generation scans these sections without retaining a full decoded recording. Playback schedules only a short lookahead. Dry and denoised sections share a 64 MiB cache; playback buffers and decoder working memory are additional. Denoise runs in a worker with overlapping sections to avoid filter seams; the knob blends dry and filtered audio. Automatic learning uses the quietest half-second within each source's first six seconds, or the whole source if it is shorter than half a second. Learn uses the raw audio on that track between the In and Out markers to create a profile applied to its clips. Both markers must be set around 0.25–10 seconds of background noise without the sound you want to keep. After success, the button displays “Learned” for 1.5 seconds. Click Learn again to replace the profile.

This spectral denoiser is designed for general sounds, including birdsong, but can also reduce wanted sounds that overlap the learned noise. The first Play with denoise enabled prepares the upcoming audio; later playback reuses cached sections. Stopping playback retires its audio processors and releases source/gain nodes. A suspended, closed or failed audio engine can be restarted with Play; interruptions are reported instead of leaving the transport silently running. Compression and gain run per track. All audible tracks feed one stereo-linked master limiter at −1 dBFS. Turning off Loudness disables its added boost; the limiter still protects the combined mix. This is a sample-peak limiter, not a true-peak or LUFS mastering tool.

Export mixes audio in four-second sections through the same DSP, retaining compressor and limiter state between sections, and decodes the original video files using WebCodecs in a worker. Export requests the source sections needed for the selected range and noise profiles; the assembled PCM WAV and encoded output still use memory proportional to export duration. The WASM engine is released after export so its peak heap allocation does not remain in the editing session. Mediabunny reads media packets and manages decoding/encoding; a canvas composites the full-resolution frames, including clip fades, layer order, rotation and black padding. The worker prefers hardware H.264 encoding, then tries the browser's native encoder when hardware is unavailable. Video frames are generated from timeline timestamps rather than real-time playback, so encoding can run faster than the video duration without dropping frames.

Native output uses H.264 in quality latency mode with variable bitrate proportional to resolution and frame rate (0.3 bits per pixel per frame, at least 4 Mb/s; approximately 18.7 Mb/s for 1080p30). WASM encodes the processed audio as 320 kb/s AAC stereo at 48 kHz and muxes it with the already encoded video without re-encoding the picture. If browser decoding or encoding is unsupported or fails, export falls back to FFmpeg WASM H.264, CRF 17, with the `veryfast` preset. Both paths write a fast-start MP4 downloaded as `video.mp4`. Codec choices can produce different file sizes; preview quality never changes export resolution.

The earliest video clip on the timeline defines the output dimensions and frame rate. Portrait-only timelines therefore export portrait video. With no video clips on the timeline, the first imported video supplies those settings; without any imported video, they default to 1920×1080 at 30 fps. Audio-only exports have a black picture. Solo and mute affect audio in preview and export; they do not hide video layers. Untagged YUV sources use the same BT.601 matrix as the FFmpeg fallback; explicit color metadata is retained during decoding.

A local Chromium benchmark on September 30, 2026 exported the same 14-second 1920×1080, 30 fps test clip in 102.6 seconds with the original single-thread WASM path and 9.2 seconds with native browser encoding, including audio and final MP4 assembly. Hardware encoding was unavailable in that test environment. The exported video contained all 420 frames and retained its original dimensions and duration. These are measurements of this fixture and environment, not a timing guarantee for other computers, codecs or projects.

For export, an unset In marker means the beginning and an unset Out marker means the end of the last clip. Either marker can be set independently. Normal Play continues to the last clip when Loop is off. Play Markers and looping require both markers, with Out after In. Marker playback starts at the current playhead if it is within the range, otherwise at In, and pauses at Out. With Loop enabled, both play controls repeat that range.

## Privacy, offline use and limits

- Import uses the browser file picker or a desktop file drop. It grants access to the selected files only. No broad disk permission is requested, and original files are never modified.
- There are no uploads, login, analytics, external font requests or runtime CDNs. Export creates a local MP4 download.
- The production service worker caches the app shell. The roughly 31 MB FFmpeg WASM engine is cached when it is first loaded, normally during import. Once the app and engine are cached, the app can be reopened offline, subject to the browser's storage eviction policy. A downloaded update waits for existing app tabs to close before activating.
- The editing session and media are held in memory. Reloading or closing the page discards the session; the app requests a browser confirmation when clips exist, though the browser controls whether it displays one. There is no project save/load or session recovery.
- Desktop Chrome/Edge are the initial test target. Other browsers vary in codec, memory, autoplay, AudioWorklet and download support. A desktop-sized viewport is required for the full timeline layout.
- This first browser port is intended for short edits. Decoded audio caches, active playback buffers, decoder working memory, the assembled export audio and the finished download use memory. Large/long/4K projects can exceed the browser's limits. Browser-native encoding does not require cross-origin isolation, so it works on GitHub Pages. The single-thread WASM fallback remains slower than native encoding; GitHub Pages cannot supply the cross-origin isolation headers needed by the multithread core. Preview starts independently of export encoding.
- ffmpeg.wasm documents a 2 GB input limit: <https://ffmpegwasm.netlify.app/docs/faq/>. Import conservatively retains the limit of less than 2 GiB (2³¹ bytes) per source file. WORKERFS removes full-file input copies; it does not remove WASM output limits or make long exports memory-independent. Practical export limits can still be lower when several files are combined.

Dependency license notices are in `public/licenses/`. The repository's Unlicense applies to the app's original code; bundled dependencies keep their own licenses.
