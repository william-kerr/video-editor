# Bill's Video Editor

This is a simple video editor that runs in the browser. If you just want to trim some clips, glue them together, fix the audio, and export something to upload to YouTube without installing anything or logging in, this might be all you need. If not, feel free to fork it and have your agent personalize it with the features you want.

**Use in your browser:**  
<https://william-kerr.github.io/video-editor>

1. Use **Import** or drop local files into the Media panel. Drag each imported file onto a matching video or audio track.
2. Trim clips, arrange them on the timeline, and adjust the audio in the mixer.
3. Export to download an MP4. Use **In** and **Out** markers to set the start and end. Leave In unset to start at the beginning of the timeline or Out unset to end at the last clip.

Files stay in your browser, with no uploads or analytics. Sessions are kept only in memory: closing or reloading discards your edits, and there is no project save/load or recovery. Download your export before leaving.

To prepare for offline use, open the editor and import a file while online so the browser can cache the app and media engine. Once both are cached, you can reopen the editor offline until the browser clears the cache.

Use desktop Chrome or Edge for the full timeline. The editor is intended for short edits; each source file must be smaller than 2 GiB, and long or high-resolution exports can exceed browser memory.

## Screenshot

![Video Editor](public/screenshot.png)

## Running Locally

See [DEVELOPMENT.md](DEVELOPMENT.md) for local setup, architecture and verification. Contributor guidance is in [AGENTS.md](AGENTS.md); project decisions and lessons are recorded in monthly files under [docs/history](docs/history/).

## Background

I was inspired by someone who canceled their Photoshop subscription and built their own app with the features they needed using AI. I periodically subscribe to use Adobe products and thought I'd see if a vibe coded video editor was any good.

### Disclaimer

Although I **despise** vibe slop when it comes to something I'm passionate about, I don't mind vibing personal tools into existence that I don't want to pay for. So, this is just a tool, not a masterpiece.
