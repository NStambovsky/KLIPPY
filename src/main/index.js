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
    win.webContents.openDevTools({ mode: 'detach' })
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
    const { model = 'base' } = opts || {}

    // Locate transcribe.py relative to app root
    const scriptPath = path.join(app.getAppPath(), 'transcribe.py')

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
        else reject(new Error(`Transcription failed (exit ${code}):\n\n${stderr || '(no output)'}`))
      })
      proc.on('error', (e) => {
        reject(new Error(
          `Could not start Python (tried: ${python})\n${e.message}\n\n` +
          `Make sure Python 3 is installed: brew install python3`
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
  ipcMain.handle('exportEdit', async (_e, { inputPath, segments }) => {
    if (!segments?.length) throw new Error('No segments to export')

    const result = await dialog.showSaveDialog(win, {
      defaultPath: 'edited_' + path.basename(inputPath),
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
    })
    if (result.canceled) return null

    const probeOut = await spawnPromise(ffprobePath, ['-v','quiet','-print_format','json','-show_streams', inputPath])
    const hasVideo = JSON.parse(probeOut).streams.some((s) => s.codec_type === 'video')

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
    const totalSec = segments.reduce((sum, s) => sum + (s.endMs - s.startMs), 0) / 1000

    win.webContents.send('progress', { type: 'exporting', progress: 0 })
    await spawnPromise(ffmpegPath,
      ['-y', '-i', inputPath, '-filter_complex', fc, ...mapArgs, '-c:v','libx264', '-c:a','aac', '-movflags','+faststart', result.filePath],
      (chunk) => {
        const m = chunk.match(/time=(\d+):(\d+):(\d+\.\d+)/)
        if (m && totalSec > 0) {
          const secs = +m[1]*3600 + +m[2]*60 + parseFloat(m[3])
          win.webContents.send('progress', { type: 'exporting', progress: Math.min(0.95, secs / totalSec) })
        }
      }
    )
    win.webContents.send('progress', { type: 'exporting', progress: 1 })
    return result.filePath
  })

  // exportClip
  ipcMain.handle('exportClip', async (_e, { inputPath, startMs, endMs, title }) => {
    const safeName = (title || 'clip').replace(/[^a-z0-9_\- ]/gi, '').replace(/\s+/g,'_').slice(0,50)
    const result = await dialog.showSaveDialog(win, {
      defaultPath: safeName + '.mp4',
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
    })
    if (result.canceled) return null

    const totalSec = (endMs - startMs) / 1000
    win.webContents.send('progress', { type: 'exportingClip', progress: 0 })
    await spawnPromise(ffmpegPath,
      ['-y', '-ss', (startMs/1000).toFixed(6), '-i', inputPath, '-t', totalSec.toFixed(6), '-c:v','libx264', '-c:a','aac', '-movflags','+faststart', result.filePath],
      (chunk) => {
        const m = chunk.match(/time=(\d+):(\d+):(\d+\.\d+)/)
        if (m && totalSec > 0) {
          const secs = +m[1]*3600 + +m[2]*60 + parseFloat(m[3])
          win.webContents.send('progress', { type: 'exportingClip', progress: Math.min(0.95, secs / totalSec) })
        }
      }
    )
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
      return net.fetch(pathToFileURL(filePath).toString())
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
