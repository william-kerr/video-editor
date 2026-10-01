const paths: Record<string, string> = {
  "video": "<rect x=\"3\" y=\"5\" width=\"18\" height=\"14\" rx=\"3\"/><path d=\"m10 9 5 3-5 3Z\"/>",
  "audio": "<path d=\"M4 10v4m4-8v12m4-15v18m4-15v12m4-8v4\"/>",
  "folder": "<path d=\"M3 8V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z\"/><path d=\"M3 9h18\"/>",
  "import": "<path d=\"M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4\"/>",
  "timeline": "<path d=\"M4 4v16M9 5h11v5H9zm0 9h7v5H9z\"/>",
  "mixer": "<path d=\"M6 3v5m0 4v9m6-18v10m0 4v4m6-18v3m0 4v11M3 8h6v4H3zm6 5h6v4H9zm6-7h6v4h-6z\"/>",
  "play": "<path d=\"m8 5 11 7-11 7Z\" fill=\"currentColor\" stroke-linejoin=\"round\"/>",
  "pause": "<path d=\"M8 5v14M16 5v14\" stroke-width=\"3\"/>",
  "rewind": "<path d=\"M5 5v14m14-14L8 12l11 7Z\"/>",
  "rewind-in": "<path d=\"M8 4H4v16h4m11-14-9 6 9 6Z\"/>",
  "play-markers": "<path d=\"M5 5H3v14h2m14-14h2v14h-2M9 7l7 5-7 5Z\"/>",
  "loop": "<path d=\"M20 7H8a5 5 0 0 0-5 5m1 5h12a5 5 0 0 0 5-5M17 4l3 3-3 3M7 14l-3 3 3 3\"/>",
  "split": "<circle cx=\"6\" cy=\"6\" r=\"3\"/><circle cx=\"6\" cy=\"18\" r=\"3\"/><path d=\"m8 8 12 12M8 16 20 4\"/>",
  "in": "<path d=\"M9 4H5v16h4m10-8H9m4-4-4 4 4 4\"/>",
  "out": "<path d=\"M15 4h4v16h-4M5 12h10m-4-4 4 4-4 4\"/>",
  "plus": "<path d=\"M12 5v14M5 12h14\"/>",
  "minus": "<path d=\"M5 12h14\"/>",
  "speaker": "<path d=\"M3 9h4l5-4v14l-5-4H3Zm13-1a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14\"/>",
  "ear": "<path d=\"M5 12v-2a7 7 0 0 1 14 0c0 4-3 5-4 8a4 4 0 0 1-8 0\"/><path d=\"M9 11a3 3 0 0 1 6 0c0 2-3 3-3 5\"/>",
  "muted": "<path d=\"M3 9h4l5-4v14l-5-4H3Z\" stroke=\"#8793a6\"/><path d=\"m4 20 16-16\" stroke=\"#f27d88\"/>",
  "power": "<path d=\"M12 3v9m-5.5-6a9 9 0 1 0 11 0\"/>",
  "export": "<path d=\"M12 15V3m-4 4 4-4 4 4M4 14v6h16v-6\"/>",
  "trash": "<path d=\"M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7\"/>",
  "zoom": "<circle cx=\"10\" cy=\"10\" r=\"6\"/><path d=\"m15 15 6 6\"/>"
}

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: paths[name] || paths.video }} />
}
