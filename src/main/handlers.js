const { dialog, app } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { spawn } = require('child_process')

// Resolve ffmpeg/ffprobe — checks env vars then common Homebrew/system paths
function findBin(name) {
  if (process.env[name.toUpperCase() + '_PATH']) return process.env[name.toUpperCase() + '_PATH']
  const candidates = [
    `/opt/homebrew/bin/${name}`,    // Apple Silicon Homebrew
    `/usr/local/bin/${name}`,       // Intel Homebrew / Linux
    `/usr/bin/${name}`,
  ]
  for (const p of candidates) {
    if (require('fs').existsSync(p)) return p
  }
  return name // fall back to PATH
}
const ffmpegPath = findBin('ffmpeg')
const ffprobePath = findBin('ffprobe')

const OpenAI = require('openai').default || require('openai')
const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk')

// ─── Settings helpers ──────────────────────────────────────────────────────────

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function loadSettings() {
  try {
    const p = getSettingsPath()
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'))
    }
  } catch (e) {
    console.error('Failed to load settings:', e)
  }
  return { openaiKey: '', anthropicKey: '', whisperModel: 'whisper-1' }
}

function saveSettings(data) {
  const p = getSettingsPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8')
}

// ─── Spawn helpers ─────────────────────────────────────────────────────────────

function spawnPromise(bin, args, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args)
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (d) => {
      stdout += d.toString()
    })
    proc.stderr.on('data', (d) => {
      const chunk = d.toString()
      stderr += chunk
      if (onProgress) onProgress(chunk)
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(new Error(`Process exited with code ${code}:\n${stderr}`))
      }
    })

    proc.on('error', (err) => {
      reject(err)
    })
  })
}

// ─── Register all IPC handlers ─────────────────────────────────────────────────

function registerHandlers(ipcMain, win) {
  // ── openFile ────────────────────────────────────────────────────────────────
  ipcMain.handle('openFile', async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [
        {
          name: 'Video/Audio',
          extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'mp3', 'wav', 'aac', 'm4a', 'flac']
        }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // ── getFileInfo ──────────────────────────────────────────────────────────────
  ipcMain.handle('getFileInfo', async (_evt, filePath) => {
    // 1) ffprobe to get duration
    const probeArgs = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ]

    let probeOutput
    try {
      probeOutput = await spawnPromise(ffprobePath, probeArgs)
    } catch (e) {
      throw new Error(`ffprobe failed: ${e.message}`)
    }

    const probeData = JSON.parse(probeOutput)
    const durationSec =
      parseFloat(probeData.format?.duration) ||
      parseFloat(probeData.streams?.[0]?.duration) ||
      0
    const durationMs = Math.round(durationSec * 1000)

    // 2) Extract audio to WAV in temp dir
    const tmpDir = path.join(os.tmpdir(), 'klippy')
    fs.mkdirSync(tmpDir, { recursive: true })
    const audioPath = path.join(tmpDir, `audio_${Date.now()}.wav`)

    const ffmpegArgs = [
      '-y',
      '-i', filePath,
      '-vn',
      '-acodec', 'pcm_s16le',
      '-ar', '16000',
      '-ac', '1',
      audioPath
    ]

    win.webContents.send('progress', { type: 'extracting', progress: 0 })

    try {
      await spawnPromise(ffmpegPath, ffmpegArgs, (chunk) => {
        // Parse time= from ffmpeg stderr for progress
        const timeMatch = chunk.match(/time=(\d+):(\d+):(\d+\.\d+)/)
        if (timeMatch && durationSec > 0) {
          const h = parseInt(timeMatch[1])
          const m = parseInt(timeMatch[2])
          const s = parseFloat(timeMatch[3])
          const currentSec = h * 3600 + m * 60 + s
          const progress = Math.min(1, currentSec / durationSec)
          win.webContents.send('progress', { type: 'extracting', progress })
        }
      })
    } catch (e) {
      throw new Error(`ffmpeg audio extract failed: ${e.message}`)
    }

    win.webContents.send('progress', { type: 'extracting', progress: 1 })

    // Build media:// URL for renderer
    const mediaUrl = 'media://' + encodeURIComponent(filePath)

    return { durationMs, audioPath, mediaUrl }
  })

  // ── transcribe ───────────────────────────────────────────────────────────────
  ipcMain.handle('transcribe', async (_evt, audioPath, opts) => {
    const { model = 'whisper-1', apiKey } = opts || {}

    if (!apiKey) throw new Error('OpenAI API key is required for transcription')

    const openai = new OpenAI({ apiKey })

    win.webContents.send('progress', { type: 'transcribing', progress: 0.1 })

    let response
    try {
      response = await openai.audio.transcriptions.create({
        file: fs.createReadStream(audioPath),
        model,
        response_format: 'verbose_json',
        timestamp_granularities: ['word']
      })
    } catch (e) {
      throw new Error(`Whisper API error: ${e.message}`)
    }

    win.webContents.send('progress', { type: 'transcribing', progress: 0.9 })

    // Whisper returns {words: [{word, start, end}], text}
    const words = (response.words || []).map((w, i) => ({
      id: i,
      word: w.word,
      startMs: Math.round((w.start || 0) * 1000),
      endMs: Math.round((w.end || 0) * 1000),
      confidence: w.probability !== undefined ? w.probability : 1
    }))

    win.webContents.send('progress', { type: 'transcribing', progress: 1 })

    return words
  })

  // ── exportEdit ───────────────────────────────────────────────────────────────
  ipcMain.handle('exportEdit', async (_evt, opts) => {
    const { inputPath, segments, outputPath } = opts

    if (!segments || segments.length === 0) {
      throw new Error('No segments to export')
    }

    // Show save dialog if no output path
    let outPath = outputPath
    if (!outPath) {
      const result = await dialog.showSaveDialog(win, {
        defaultPath: 'edited_' + path.basename(inputPath),
        filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
      })
      if (result.canceled) return null
      outPath = result.filePath
    }

    // Check if input is audio-only
    const probeArgs = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      inputPath
    ]
    const probeOutput = await spawnPromise(ffprobePath, probeArgs)
    const probeData = JSON.parse(probeOutput)
    const hasVideo = probeData.streams.some((s) => s.codec_type === 'video')

    const segs = segments

    let filterComplex = ''
    const mapArgs = []

    if (hasVideo) {
      // Build video + audio filter_complex
      segs.forEach((seg, i) => {
        const s = (seg.startMs / 1000).toFixed(6)
        const e = (seg.endMs / 1000).toFixed(6)
        filterComplex += `[0:v]trim=start=${s}:end=${e},setpts=PTS-STARTPTS[v${i}];`
        filterComplex += `[0:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS[a${i}];`
      })

      const vInputs = segs.map((_, i) => `[v${i}]`).join('')
      const aInputs = segs.map((_, i) => `[a${i}]`).join('')
      filterComplex += `${vInputs}concat=n=${segs.length}:v=1:a=0[vout];`
      filterComplex += `${aInputs}concat=n=${segs.length}:v=0:a=1[aout]`

      mapArgs.push('-map', '[vout]', '-map', '[aout]')
    } else {
      // Audio only
      segs.forEach((seg, i) => {
        const s = (seg.startMs / 1000).toFixed(6)
        const e = (seg.endMs / 1000).toFixed(6)
        filterComplex += `[0:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS[a${i}];`
      })

      const aInputs = segs.map((_, i) => `[a${i}]`).join('')
      filterComplex += `${aInputs}concat=n=${segs.length}:v=0:a=1[aout]`
      mapArgs.push('-map', '[aout]')
    }

    const ffmpegArgs = [
      '-y',
      '-i', inputPath,
      '-filter_complex', filterComplex,
      ...mapArgs,
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      outPath
    ]

    win.webContents.send('progress', { type: 'exporting', progress: 0 })

    // Get duration for progress calculation
    const totalMs = segs.reduce((sum, s) => sum + (s.endMs - s.startMs), 0)
    const totalSec = totalMs / 1000

    await spawnPromise(ffmpegPath, ffmpegArgs, (chunk) => {
      const timeMatch = chunk.match(/time=(\d+):(\d+):(\d+\.\d+)/)
      if (timeMatch && totalSec > 0) {
        const h = parseInt(timeMatch[1])
        const m = parseInt(timeMatch[2])
        const s = parseFloat(timeMatch[3])
        const currentSec = h * 3600 + m * 60 + s
        const progress = Math.min(1, currentSec / totalSec)
        win.webContents.send('progress', { type: 'exporting', progress })
      }
    })

    win.webContents.send('progress', { type: 'exporting', progress: 1 })
    return outPath
  })

  // ── exportClip ───────────────────────────────────────────────────────────────
  ipcMain.handle('exportClip', async (_evt, opts) => {
    const { inputPath, startMs, endMs, title } = opts

    const safeName = (title || 'clip')
      .replace(/[^a-z0-9_\-\s]/gi, '')
      .replace(/\s+/g, '_')
      .slice(0, 50)

    const result = await dialog.showSaveDialog(win, {
      defaultPath: safeName + '.mp4',
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
    })
    if (result.canceled) return null

    const outPath = result.filePath
    const startSec = (startMs / 1000).toFixed(6)
    const durationSec = ((endMs - startMs) / 1000).toFixed(6)

    const ffmpegArgs = [
      '-y',
      '-ss', startSec,
      '-i', inputPath,
      '-t', durationSec,
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      outPath
    ]

    win.webContents.send('progress', { type: 'exportingClip', progress: 0 })

    await spawnPromise(ffmpegPath, ffmpegArgs, (chunk) => {
      const timeMatch = chunk.match(/time=(\d+):(\d+):(\d+\.\d+)/)
      if (timeMatch) {
        const h = parseInt(timeMatch[1])
        const m = parseInt(timeMatch[2])
        const s = parseFloat(timeMatch[3])
        const currentSec = h * 3600 + m * 60 + s
        const totalSec = (endMs - startMs) / 1000
        const progress = Math.min(1, currentSec / totalSec)
        win.webContents.send('progress', { type: 'exportingClip', progress })
      }
    })

    win.webContents.send('progress', { type: 'exportingClip', progress: 1 })
    return outPath
  })

  // ── findClipsAI ──────────────────────────────────────────────────────────────
  ipcMain.handle('findClipsAI', async (_evt, transcriptWords, opts) => {
    const { apiKey, platform = 'general' } = opts || {}
    if (!apiKey) throw new Error('Anthropic API key is required')

    const client = new Anthropic({ apiKey })

    // Build indexed transcript string
    const indexedTranscript = transcriptWords
      .map((w, i) => `[${i}] ${w.word}`)
      .join(' ')

    const platformGuide =
      platform === 'tiktok' || platform === 'reels' || platform === 'shorts'
        ? 'Target platform: Short-form vertical video (TikTok/Reels/Shorts). Prefer 30-60 second clips with strong hooks.'
        : platform === 'linkedin'
        ? 'Target platform: LinkedIn. Prefer 45-90 second professional clips with insights or advice.'
        : 'Target platform: General short-form video. Aim for 30-90 seconds.'

    const prompt = `Here is a transcript with word indices. Find 3-6 compelling clip candidates for short-form video. ${platformGuide}

Return ONLY a valid JSON array (no other text) in this format:
[{"title": "...", "rationale": "...", "startWordIndex": 0, "endWordIndex": 10, "score": 0.95}]

Rules:
- score is 0-1, higher = more compelling
- Each clip should be self-contained with a clear point or story
- Prefer clips with strong emotional moments, insights, or hooks

Transcript:
${indexedTranscript}`

    const resp = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }]
    })

    const text = resp.content?.[0]?.text || ''

    // Extract JSON array from response
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) throw new Error('Claude did not return valid JSON')

    const suggestions = JSON.parse(jsonMatch[0])

    // Convert word indices to timestamps
    return suggestions.map((s) => {
      const startWord = transcriptWords[s.startWordIndex]
      const endWord = transcriptWords[Math.min(s.endWordIndex, transcriptWords.length - 1)]
      return {
        ...s,
        startMs: startWord?.startMs ?? 0,
        endMs: endWord?.endMs ?? 0
      }
    })
  })

  // ── settings ─────────────────────────────────────────────────────────────────
  ipcMain.handle('settings:get', () => {
    return loadSettings()
  })

  ipcMain.handle('settings:set', (_evt, data) => {
    saveSettings(data)
    return true
  })
}

module.exports = { registerHandlers }
