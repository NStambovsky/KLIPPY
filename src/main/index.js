const { app, BrowserWindow, Menu, ipcMain, protocol, dialog, net } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { spawn } = require('child_process')
const { pathToFileURL } = require('url')

const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk')

// ─── FFmpeg path resolution ────────────────────────────────────────────────────
function findBin(name) {
  if (process.env[name.toUpperCase() + '_PATH']) return process.env[name.toUpperCase() + '_PATH']
  const candidates = [
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return name
}
const ffmpegPath = findBin('ffmpeg')
const ffprobePath = findBin('ffprobe')

// ─── Settings ──────────────────────────────────────────────────────────────────
function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json')
}
function loadSettings() {
  try {
    const p = getSettingsPath()
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {}
  return { openaiKey: '', anthropicKey: '', whisperModel: 'whisper-1' }
}
function saveSettings(data) {
  const p = getSettingsPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(data, null, 2))
}

// ─── Check libass / subtitles filter availability (cached) ────────────────────
let _subtitlesFilterAvailable = null
async function hasSubtitlesFilter() {
  if (_subtitlesFilterAvailable !== null) return _subtitlesFilterAvailable
  try {
    const combined = await new Promise((resolve) => {
      const proc = spawn(ffmpegPath, ['-filters'])
      let out = ''
      proc.stdout.on('data', (d) => { out += d })
      proc.stderr.on('data', (d) => { out += d })
      proc.on('close', () => resolve(out))
      proc.on('error', () => resolve(''))
    })
    _subtitlesFilterAvailable = /\bsubtitles\b/.test(combined)
  } catch {
    _subtitlesFilterAvailable = false
  }
  return _subtitlesFilterAvailable
}

// ─── ASS subtitle helpers ──────────────────────────────────────────────────────
function hexToAss(hex) {
  // '#RRGGBB' → '&H00BBGGRR'
  const r = (hex || '#ffffff').slice(1, 3)
  const g = (hex || '#ffffff').slice(3, 5)
  const b = (hex || '#ffffff').slice(5, 7)
  return `&H00${b}${g}${r}`.toUpperCase()
}

function msToAssTime(ms) {
  const totalCs = Math.round(Math.max(0, ms) / 10)
  const cs = totalCs % 100
  const totalSec = Math.floor(totalCs / 100)
  const sec = totalSec % 60
  const totalMin = Math.floor(totalSec / 60)
  const min = totalMin % 60
  const hr = Math.floor(totalMin / 60)
  return `${hr}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

function buildAssFile(words, captionStyle) {
  const { font = 'Impact', size = 72, color = '#ffffff', outlineColor = '#000000',
    outlineSize = 2, position = 'bottom', mode = 'word', allCaps = true } = captionStyle

  const alignment = position === 'top' ? 8 : position === 'middle' ? 5 : 2
  const marginV = 80

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BorderStyle, Outline, Shadow, Alignment, MarginV
Style: Default,${font},${size},${hexToAss(color)},${hexToAss(outlineColor)},1,${outlineSize},0,${alignment},${marginV}

[Events]
Format: Layer, Start, End, Style, Text
`
  const lines = []

  if (mode === 'word') {
    for (const w of words) {
      const text = allCaps ? w.word.trim().toUpperCase() : w.word.trim()
      if (!text) continue
      lines.push(`Dialogue: 0,${msToAssTime(w.startMs)},${msToAssTime(w.endMs + 50)},Default,,${text}`)
    }
  } else {
    let sentWords = []
    for (let i = 0; i < words.length; i++) {
      sentWords.push(words[i])
      const isLast = i === words.length - 1
      const nextGap = isLast ? Infinity : (words[i + 1].startMs - words[i].endMs)
      if (nextGap > 800 || isLast) {
        const text = sentWords.map((w) => w.word).join('').trim()
        const display = allCaps ? text.toUpperCase() : text
        if (display) {
          lines.push(`Dialogue: 0,${msToAssTime(sentWords[0].startMs)},${msToAssTime(sentWords[sentWords.length - 1].endMs + 100)},Default,,${display}`)
        }
        sentWords = []
      }
    }
  }

  return header + lines.join('\n') + '\n'
}

// drawtext-based caption burn-in (no libass needed — always available in ffmpeg)
function escapeDrawtext(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, '\u2019')  // curly apostrophe — avoids quote escaping complexity
    .replace(/:/g, '\\:')
    .replace(/%/g, '%%')
}

function buildDrawtextFilter(words, captionStyle) {
  const { size = 72, color = '#ffffff', outlineColor = '#000000', outlineSize = 2,
    position = 'bottom', allCaps = true, font = 'Impact' } = captionStyle

  const fontColor = '0x' + (color.replace('#', '') || 'ffffff')
  const borderColor = '0x' + (outlineColor.replace('#', '') || '000000')
  const yExpr = position === 'top' ? '80' : position === 'middle' ? '(h-text_h)/2' : 'h-text_h-80'
  // Use fontconfig name — avoids picking up wrong/corrupted font files from disk
  const fontPart = `font='${escapeDrawtext(font)}'`

  const parts = words.map((w) => {
    const raw = (allCaps ? w.word.trim().toUpperCase() : w.word.trim())
    if (!raw) return null
    const text = escapeDrawtext(raw)
    const t0 = Math.max(0, w.startMs / 1000).toFixed(3)
    const t1 = ((w.endMs + 50) / 1000).toFixed(3)
    return `drawtext=${fontPart}:text='${text}':fontsize=${size}:fontcolor=${fontColor}:borderw=${outlineSize}:bordercolor=${borderColor}:x=(w-text_w)/2:y=${yExpr}:enable='between(t,${t0},${t1})'`
  }).filter(Boolean)

  return parts.length ? parts.join(',') : null
}

function buildDrawtextFilterSentences(words, captionStyle) {
  const { size = 72, color = '#ffffff', outlineColor = '#000000', outlineSize = 2,
    position = 'bottom', allCaps = true, font = 'Impact' } = captionStyle

  const fontColor = '0x' + (color.replace('#', '') || 'ffffff')
  const borderColor = '0x' + (outlineColor.replace('#', '') || '000000')
  const yExpr = position === 'top' ? '80' : position === 'middle' ? '(h-text_h)/2' : 'h-text_h-80'
  const fontPart = `font='${escapeDrawtext(font)}'`

  const parts = []
  let sentWords = []
  for (let i = 0; i < words.length; i++) {
    sentWords.push(words[i])
    const isLast = i === words.length - 1
    const nextGap = isLast ? Infinity : (words[i + 1].startMs - words[i].endMs)
    if (nextGap > 800 || isLast) {
      const raw = sentWords.map((w) => w.word).join('').trim()
      const display = allCaps ? raw.toUpperCase() : raw
      if (display) {
        const text = escapeDrawtext(display)
        const t0 = Math.max(0, sentWords[0].startMs / 1000).toFixed(3)
        const t1 = ((sentWords[sentWords.length - 1].endMs + 100) / 1000).toFixed(3)
        parts.push(`drawtext=${fontPart}:text='${text}':fontsize=${Math.round(size * 0.6)}:fontcolor=${fontColor}:borderw=${outlineSize}:bordercolor=${borderColor}:x=(w-text_w)/2:y=${yExpr}:enable='between(t,${t0},${t1})'`)
      }
      sentWords = []
    }
  }
  return parts.length ? parts.join(',') : null
}

// Burn captions into srcPath → dstPath using libass or drawtext fallback
// Returns null on success, or a warning string if captions were skipped
async function burnCaptions(srcPath, dstPath, words, captionStyle, progressType, progressBase, progressRange, win) {
  const totalSec = words.length > 0 ? (words[words.length - 1].endMs / 1000) + 1 : 1
  const tmpDir = path.join(os.tmpdir(), 'klippy')

  const sendProg = (frac) => win.webContents.send('progress', { type: progressType, progress: progressBase + frac * progressRange })

  // Try libass subtitles filter first
  if (await hasSubtitlesFilter()) {
    const assContent = buildAssFile(words, captionStyle)
    const assPath = path.join(tmpDir, `caps_${Date.now()}.ass`)
    fs.writeFileSync(assPath, assContent, 'utf8')
    sendProg(0)
    try {
      await spawnPromise(ffmpegPath,
        ['-y', '-i', srcPath, '-vf', `subtitles=${assPath.replace(/\\/g, '/')}`, '-c:a', 'copy', '-movflags', '+faststart', dstPath],
        (chunk) => {
          const m = chunk.match(/time=(\d+):(\d+):(\d+\.\d+)/)
          if (m) sendProg(Math.min(0.95, (+m[1]*3600 + +m[2]*60 + parseFloat(m[3])) / totalSec))
        }
      )
      try { fs.unlinkSync(assPath) } catch {}
      return null  // success
    } catch {
      try { fs.unlinkSync(assPath) } catch {}
      // fall through to drawtext
    }
  }

  // Fallback: drawtext (no libass needed, always available)
  const buildFilter = (style) => captionStyle.mode === 'sentence'
    ? buildDrawtextFilterSentences(words, style)
    : buildDrawtextFilter(words, style)

  // Try with the chosen font, then fall back to 'Sans' if font lookup fails
  for (const styleOverride of [captionStyle, { ...captionStyle, font: 'Sans' }]) {
    const vfFilter = buildFilter(styleOverride)
    if (!vfFilter) break

    sendProg(0)
    try {
      await spawnPromise(ffmpegPath,
        ['-y', '-i', srcPath, '-vf', vfFilter, '-c:a', 'copy', '-movflags', '+faststart', dstPath],
        (chunk) => {
          const m = chunk.match(/time=(\d+):(\d+):(\d+\.\d+)/)
          if (m) sendProg(Math.min(0.95, (+m[1]*3600 + +m[2]*60 + parseFloat(m[3])) / totalSec))
        }
      )
      return null  // success
    } catch {
      // try next font fallback
    }
  }

  // All methods failed — export without captions
  fs.copyFileSync(srcPath, dstPath)
  return 'Caption burn-in failed (font not found). Install ffmpeg with libass: brew reinstall ffmpeg'
}

// Remap transcript words to a new timeline defined by kept segments
function remapWordsToSegments(transcript, segments) {
  const result = []
  let outputOffset = 0
  for (const seg of segments) {
    const inSeg = transcript.filter((w) => w.startMs >= seg.startMs - 50 && w.endMs <= seg.endMs + 50)
    for (const w of inSeg) {
      result.push({
        ...w,
        startMs: w.startMs - seg.startMs + outputOffset,
        endMs: w.endMs - seg.startMs + outputOffset,
      })
    }
    outputOffset += seg.endMs - seg.startMs
  }
  return result
}

// ─── Spawn helper ──────────────────────────────────────────────────────────────
function spawnPromise(bin, args, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args)
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => { stdout += d.toString() })
    proc.stderr.on('data', (d) => {
      const chunk = d.toString()
      stderr += chunk
      if (onProgress) onProgress(chunk)
    })
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`Exit ${code}: ${stderr.slice(-500)}`))
    })
    proc.on('error', reject)
  })
}

// ─── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    backgroundColor: '#0a0a0f',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
    // Only open DevTools if explicitly requested
    if (process.env.KLIPPY_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

// ─── Menu ──────────────────────────────────────────────────────────────────────
function buildMenu(win) {
  const send = (ch) => () => win.webContents.send(ch)
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Import Video/Audio...', accelerator: 'CmdOrCtrl+O', click: send('menu:import') },
        { type: 'separator' },
        { label: 'Export Edit...', accelerator: 'CmdOrCtrl+E', click: send('menu:exportEdit') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Remove Filler Words', click: send('menu:removeFillers') },
        { label: 'Restore All Cuts', click: send('menu:restoreAll') },
        { type: 'separator' },
        { role: 'undo' }, { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' }, { role: 'togglefullscreen' },
      ],
    },
  ]

  if (process.platform === 'darwin') {
    template.unshift({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: send('menu:settings') },
        { type: 'separator' },
        { role: 'services' }, { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' }, { role: 'quit' },
      ],
    })
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────
function registerHandlers(win) {
  // openFile
  ipcMain.handle('openFile', async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Video/Audio', extensions: ['mp4','mov','avi','mkv','webm','m4v','mp3','wav','aac','m4a','flac'] }],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // getFileInfo — ffprobe duration + ffmpeg audio extract
  ipcMain.handle('getFileInfo', async (_e, filePath) => {
    const probeOut = await spawnPromise(ffprobePath, [
      '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath,
    ])
    const probe = JSON.parse(probeOut)
    const durationSec = parseFloat(probe.format?.duration || probe.streams?.[0]?.duration || 0)
    const durationMs = Math.round(durationSec * 1000)

    const tmpDir = path.join(os.tmpdir(), 'klippy')
    fs.mkdirSync(tmpDir, { recursive: true })
    const audioPath = path.join(tmpDir, `audio_${Date.now()}.wav`)

    win.webContents.send('progress', { type: 'extracting', progress: 0.1 })
    await spawnPromise(ffmpegPath, [
      '-y', '-i', filePath, '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', audioPath,
    ], (chunk) => {
      const m = chunk.match(/time=(\d+):(\d+):(\d+\.\d+)/)
      if (m && durationSec > 0) {
        const secs = +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3])
        win.webContents.send('progress', { type: 'extracting', progress: Math.min(0.95, secs / durationSec) })
      }
    })
    win.webContents.send('progress', { type: 'extracting', progress: 1 })

    return { durationMs, audioPath, mediaUrl: 'media://' + encodeURIComponent(filePath) }
  })

  // transcribe — local faster-whisper via Python (no API key needed)
  ipcMain.handle('transcribe', async (_e, audioPath, opts) => {
    const VALID_MODELS = new Set(['tiny','tiny.en','base','base.en','small','small.en','medium','medium.en','large','large-v1','large-v2','large-v3','turbo'])
    const rawModel = opts?.model || 'base'
    const model = VALID_MODELS.has(rawModel) ? rawModel : 'base'

    // Locate transcribe.py — try both app root and relative to __dirname
    let scriptPath = path.join(app.getAppPath(), 'transcribe.py')
    if (!fs.existsSync(scriptPath)) {
      scriptPath = path.join(__dirname, '../../transcribe.py')
    }
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`transcribe.py not found.\nLooked in:\n  ${path.join(app.getAppPath(), 'transcribe.py')}\n  ${path.join(__dirname, '../../transcribe.py')}`)
    }

    win.webContents.send('progress', { type: 'transcribing', progress: 0.05 })

    // Find python3 — prefer the one that has faster-whisper installed
    const pythonCandidates = [
      '/opt/homebrew/bin/python3',  // Apple Silicon Homebrew
      '/usr/local/bin/python3',     // Intel Homebrew
      '/usr/bin/python3',
      'python3',
    ]
    let python = 'python3'
    // Pick the first candidate where faster-whisper is importable
    for (const p of pythonCandidates) {
      if (!fs.existsSync(p) && p !== 'python3') continue
      try {
        const { status } = require('child_process').spawnSync(p, ['-c', 'import faster_whisper'])
        if (status === 0) { python = p; break }
      } catch {}
    }

    let stdout = ''
    let stderr = ''
    await new Promise((resolve, reject) => {
      const proc = spawn(python, [scriptPath, audioPath, model])
      proc.stdout.on('data', (d) => { stdout += d.toString() })
      proc.stderr.on('data', (d) => {
        stderr += d.toString()
        // faster-whisper logs progress to stderr — parse percentage
        const m = d.toString().match(/(\d+)%/)
        if (m) win.webContents.send('progress', { type: 'transcribing', progress: Math.min(0.95, +m[1] / 100) })
      })
      proc.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(
          `Transcription failed (exit ${code})\nPython: ${python}\nScript: ${scriptPath}\n\n${stderr || stdout || '(no output)'}`
        ))
      })
      proc.on('error', (e) => {
        reject(new Error(
          `Could not start Python.\nTried: ${python}\nError: ${e.message}\n\nRun KLIPPY.command to install dependencies, or: brew install python3 && pip3 install faster-whisper`
        ))
      })
    })

    let result
    try { result = JSON.parse(stdout) } catch {
      throw new Error(`Transcription output parse error:\n${stdout.slice(0, 300)}`)
    }
    if (result.error) throw new Error(result.error)

    win.webContents.send('progress', { type: 'transcribing', progress: 1 })

    return (result.words || []).map((w, i) => ({
      id: i,
      word: w.word,
      startMs: w.startMs,
      endMs: w.endMs,
      confidence: w.confidence ?? 1,
    }))
  })

  // exportEdit — FFmpeg multi-segment concat
  ipcMain.handle('exportEdit', async (_e, { inputPath, segments, captionStyle, transcript }) => {
    if (!segments?.length) throw new Error('No segments to export')

    const result = await dialog.showSaveDialog(win, {
      defaultPath: 'edited_' + path.basename(inputPath),
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
    })
    if (result.canceled) return null

    const probeOut = await spawnPromise(ffprobePath, ['-v','quiet','-print_format','json','-show_streams', inputPath])
    const hasVideo = JSON.parse(probeOut).streams.some((s) => s.codec_type === 'video')

    const tmpDir = path.join(os.tmpdir(), 'klippy')
    fs.mkdirSync(tmpDir, { recursive: true })
    const totalSec = segments.reduce((sum, s) => sum + (s.endMs - s.startMs), 0) / 1000
    const useCaptions = captionStyle && hasVideo && transcript?.length

    // If captions, export to temp first, then burn in
    const exportTarget = useCaptions ? path.join(tmpDir, `edit_tmp_${Date.now()}.mp4`) : result.filePath

    let fc = ''
    if (hasVideo) {
      segments.forEach((s, i) => {
        const st = (s.startMs / 1000).toFixed(6), en = (s.endMs / 1000).toFixed(6)
        fc += `[0:v]trim=start=${st}:end=${en},setpts=PTS-STARTPTS[v${i}];`
        fc += `[0:a]atrim=start=${st}:end=${en},asetpts=PTS-STARTPTS[a${i}];`
      })
      fc += segments.map((_,i) => `[v${i}]`).join('') + `concat=n=${segments.length}:v=1:a=0[vout];`
      fc += segments.map((_,i) => `[a${i}]`).join('') + `concat=n=${segments.length}:v=0:a=1[aout]`
    } else {
      segments.forEach((s, i) => {
        const st = (s.startMs / 1000).toFixed(6), en = (s.endMs / 1000).toFixed(6)
        fc += `[0:a]atrim=start=${st}:end=${en},asetpts=PTS-STARTPTS[a${i}];`
      })
      fc += segments.map((_,i) => `[a${i}]`).join('') + `concat=n=${segments.length}:v=0:a=1[aout]`
    }

    const mapArgs = hasVideo ? ['-map','[vout]','-map','[aout]'] : ['-map','[aout]']

    win.webContents.send('progress', { type: 'exporting', progress: 0 })
    await spawnPromise(ffmpegPath,
      ['-y', '-i', inputPath, '-filter_complex', fc, ...mapArgs, '-c:v','libx264', '-c:a','aac', '-movflags','+faststart', exportTarget],
      (chunk) => {
        const m = chunk.match(/time=(\d+):(\d+):(\d+\.\d+)/)
        if (m && totalSec > 0) {
          const secs = +m[1]*3600 + +m[2]*60 + parseFloat(m[3])
          win.webContents.send('progress', { type: 'exporting', progress: Math.min(useCaptions ? 0.6 : 0.95, secs / totalSec) })
        }
      }
    )

    if (useCaptions) {
      const remapped = remapWordsToSegments(transcript, segments)
      const warn = await burnCaptions(exportTarget, result.filePath, remapped, captionStyle, 'exporting', 0.65, 0.3, win)
      try { fs.unlinkSync(exportTarget) } catch {}
      if (warn) win.webContents.send('captionWarning', warn)
    }

    win.webContents.send('progress', { type: 'exporting', progress: 1 })
    return result.filePath
  })

  // exportClip
  ipcMain.handle('exportClip', async (_e, { inputPath, startMs, endMs, title, captionStyle, transcript }) => {
    const safeName = (title || 'clip').replace(/[^a-z0-9_\- ]/gi, '').replace(/\s+/g,'_').slice(0,50)
    const result = await dialog.showSaveDialog(win, {
      defaultPath: safeName + '.mp4',
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
    })
    if (result.canceled) return null

    const totalSec = (endMs - startMs) / 1000
    const tmpDir = path.join(os.tmpdir(), 'klippy')
    fs.mkdirSync(tmpDir, { recursive: true })

    // Check if video track exists
    const probeOut = await spawnPromise(ffprobePath, ['-v','quiet','-print_format','json','-show_streams', inputPath])
    const hasVideo = JSON.parse(probeOut).streams.some((s) => s.codec_type === 'video')
    const useCaptions = captionStyle && hasVideo && transcript?.length

    const exportTarget = useCaptions ? path.join(tmpDir, `clip_tmp_${Date.now()}.mp4`) : result.filePath

    win.webContents.send('progress', { type: 'exportingClip', progress: 0 })
    await spawnPromise(ffmpegPath,
      ['-y', '-ss', (startMs/1000).toFixed(6), '-i', inputPath, '-t', totalSec.toFixed(6), '-c:v','libx264', '-c:a','aac', '-movflags','+faststart', exportTarget],
      (chunk) => {
        const m = chunk.match(/time=(\d+):(\d+):(\d+\.\d+)/)
        if (m && totalSec > 0) {
          const secs = +m[1]*3600 + +m[2]*60 + parseFloat(m[3])
          win.webContents.send('progress', { type: 'exportingClip', progress: Math.min(useCaptions ? 0.6 : 0.95, secs / totalSec) })
        }
      }
    )

    if (useCaptions) {
      const clipWords = (transcript || [])
        .filter((w) => w.startMs >= startMs - 100 && w.endMs <= endMs + 100)
        .map((w) => ({ ...w, startMs: w.startMs - startMs, endMs: w.endMs - startMs }))
      const warn = await burnCaptions(exportTarget, result.filePath, clipWords, captionStyle, 'exportingClip', 0.65, 0.3, win)
      try { fs.unlinkSync(exportTarget) } catch {}
      if (warn) win.webContents.send('captionWarning', warn)
    }

    win.webContents.send('progress', { type: 'exportingClip', progress: 1 })
    return result.filePath
  })

  // findClipsAI — Claude
  ipcMain.handle('findClipsAI', async (_e, transcriptWords, opts) => {
    const { apiKey, platform = 'general' } = opts || {}
    if (!apiKey) throw new Error('Anthropic API key required — open Settings (⌘,)')

    const client = new Anthropic({ apiKey })
    const platformGuide =
      ['tiktok','reels','shorts'].includes(platform)
        ? 'Target: TikTok/Reels/Shorts. Prefer 30-60s clips with strong hooks.'
        : platform === 'linkedin'
        ? 'Target: LinkedIn. Prefer 45-90s professional clips.'
        : 'Target: general short-form. Aim for 30-90s.'

    const indexed = transcriptWords.map((w, i) => `[${i}]${w.word}`).join(' ')

    const resp = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `Find 3-6 compelling short-form video clips from this transcript. ${platformGuide}

Return ONLY a valid JSON array, no other text:
[{"title":"...","rationale":"...","startWordIndex":0,"endWordIndex":10,"score":0.9}]

score is 0-1. Each clip must be self-contained with a clear point.

Transcript:
${indexed}`,
      }],
    })

    const text = resp.content?.[0]?.text || ''
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) throw new Error('Claude returned unexpected format')

    return JSON.parse(match[0]).map((s) => ({
      ...s,
      startMs: transcriptWords[s.startWordIndex]?.startMs ?? 0,
      endMs: transcriptWords[Math.min(s.endWordIndex, transcriptWords.length - 1)]?.endMs ?? 0,
    }))
  })

  // settings
  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:set', (_e, data) => { saveSettings(data); return true })
}

// ─── Bootstrap ─────────────────────────────────────────────────────────────────
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { secure: true, supportFetchAPI: true, bypassCSP: true, stream: true } },
])

app.whenReady().then(() => {
  protocol.handle('media', (req) => {
    try {
      const filePath = decodeURIComponent(req.url.slice('media://'.length))
      // Forward Range header so the video element can seek (partial content)
      const headers = {}
      const range = req.headers.get('range')
      if (range) headers['range'] = range
      return net.fetch(pathToFileURL(filePath).toString(), { headers })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })

  const win = createWindow()
  buildMenu(win)
  registerHandlers(win)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
