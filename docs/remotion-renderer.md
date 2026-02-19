# Remotion Renderer Service

This service renders bespoke motion videos from the backend's final generated text.

## 1) Run the renderer

```bash
cd remotion-renderer
npm install
npm run start
```

Default base URL is `http://127.0.0.1:3030`.

## 2) Configure backend

Set these environment variables for backend:

```bash
REMOTION_RENDER_ENDPOINT=http://127.0.0.1:3030/render
REMOTION_RENDER_TIMEOUT_S=180
```

Optional local fallback when renderer is down:

```bash
VIDEO_FALLBACK_URL=https://example.com/demo.mp4
```

## 3) Render API contract

`POST /render`

Request:
- `jobId: string`
- `topic: string`
- `answer: string`
- `script: { title, composition, scenes[] }`
- `qualityProfile: "high"` (optional)
- `ttsEnabled: false` (optional)

Response:
- `videoUrl: string`
- `posterUrl: string | null`
- `durationMs: number`
- `aspectRatio: string`
- `providerJobId: string`

Rendered files are served from `/renders/<file>.mp4`.
