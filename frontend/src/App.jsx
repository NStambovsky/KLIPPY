import React, { useState, useCallback, useRef, useEffect } from 'react'
import UploadZone from './components/UploadZone.jsx'
import VideoPlayer from './components/VideoPlayer.jsx'
import TranscriptEditor from './components/TranscriptEditor.jsx'
import ClipsPanel from './components/ClipsPanel.jsx'

const AUDIO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac'])

async function safeJson(res) {
  const text = await res.text()
  if (!text) return {}
  try { return JSON.parse(text) } catch { return { detail: text } }
}

export default function App() {
  const [uploadedFile, setUploadedFile] = useState(null) // {file_id, filename, duration, media_url}
  const [transcript, setTranscript] = useState(null)
  const [transcribeJob, setTranscribeJob] = useState(null) // {job_id, status}
  const [transcribing, setTranscribing] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [seekTo, setSeekTo] = useState(0)
  const [previewRange, setPreviewRange] = useState(null)
  const [subtitleConfig, setSubtitleConfig] = useState({
    enabled: false, style: 'word', position: 'bottom',
    font_size: 72, all_caps: true, outline_size: 2.5,
    max_chars: 28, font_name: 'Impact',
  })
  const [keptSegments, setKeptSegments] = useState([])
  const [toasts, setToasts] = useState([])
  const [modelSize, setModelSize] = useState('base')
  const pollRef = useRef(null)
  const videoRef = useRef(null)  // ref to VideoPlayer (exposes seekAndPlay)

  const isAudio = uploadedFile
    ? AUDIO_EXTS.has('.' + (uploadedFile.filename?.split('.').pop() || '').toLowerCase())
    : false

  function addToast(message, type = 'info') {
    const id = Date.now()
    setToasts(t => [...t, { id, message, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000)
  }

  function handleUpload(fileInfo) {
    setUploadedFile(fileInfo)
    setTranscript(null)
    setTranscribeJob(null)
    setKeptSegments([])
    setCurrentTime(0)
    setSeekTo(0)
    addToast(`Uploaded: ${fileInfo.filename}`, 'success')
  }

  async function startTranscribe() {
    if (!uploadedFile || transcribing) return
    setTranscribing(true)
    setTranscript(null)

    try {
      const res = await fetch('/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: uploadedFile.file_id, model_size: modelSize }),
      })
      const data = await safeJson(res)
      if (!res.ok) {
        addToast(data.detail || 'Transcription failed', 'error')
        setTranscribing(false)
        return
      }

      // Cached result
      if (data.status === 'done' && data.transcript) {
        setTranscript(data.transcript)
        setTranscribing(false)
        addToast('Transcript loaded from cache', 'success')
        return
      }

      // Poll job
      pollJob(data.job_id)
    } catch (e) {
      addToast(e.message, 'error')
      setTranscribing(false)
    }
  }

  function pollJob(jobId) {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/job/${jobId}`)
        const job = await safeJson(res)
        if (job.status === 'done') {
          clearInterval(pollRef.current)
          setTranscript(job.result)
          setTranscribing(false)
          addToast('Transcription complete!', 'success')
        } else if (job.status === 'error') {
          clearInterval(pollRef.current)
          setTranscribing(false)
          addToast(job.error || 'Transcription failed', 'error')
        }
      } catch {
        clearInterval(pollRef.current)
        setTranscribing(false)
      }
    }, 1500)
  }

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const handleTimeUpdate = useCallback(t => setCurrentTime(t), [])
  const handleSeek = useCallback(t => { setSeekTo(t); setPreviewRange(null) }, [])
  const handlePreviewClip = useCallback((start, end, label) => {
    if (start == null) { setPreviewRange(null); return }
    setPreviewRange({ start, end, label })
    // seekAndPlay must be called synchronously within the user gesture
    videoRef.current?.seekAndPlay(start)
  }, [])
  const handleSegmentsChange = useCallback(segs => setKeptSegments(segs), [])

  function newFile() {
    setUploadedFile(null)
    setTranscript(null)
    setTranscribeJob(null)
    setKeptSegments([])
    setCurrentTime(0)
    setSeekTo(0)
    setPreviewRange(null)
  }

  const lang = transcript?.language
  const wordCount = transcript?.segments?.reduce((a, s) => a + (s.words?.length || 0), 0) || 0

  return (
    <div className="app">
      {/* Topbar */}
      <header className="topbar">
        <div className="topbar-logo">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="8" y1="6" x2="21" y2="6"/>
            <line x1="8" y1="12" x2="21" y2="12"/>
            <line x1="8" y1="18" x2="21" y2="18"/>
            <line x1="3" y1="6" x2="3.01" y2="6"/>
            <line x1="3" y1="12" x2="3.01" y2="12"/>
            <line x1="3" y1="18" x2="3.01" y2="18"/>
          </svg>
          KLIPPY
        </div>

        {uploadedFile && (
          <div style={{display:'flex', alignItems:'center', gap:8}}>
            <span style={{fontSize:12, color:'var(--text-muted)', maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
              {uploadedFile.filename}
            </span>
            {lang && <span className="badge badge-accent">{lang.toUpperCase()}</span>}
            {wordCount > 0 && <span className="badge">{wordCount.toLocaleString()} words</span>}
          </div>
        )}

        <div className="topbar-actions">
          {uploadedFile && !transcript && (
            <>
              <select
                value={modelSize}
                onChange={e => setModelSize(e.target.value)}
                style={{background:'var(--surface3)', border:'1px solid var(--border)', color:'var(--text)', borderRadius:6, padding:'4px 8px', fontSize:12}}
                title="Whisper model size — larger = more accurate but slower"
              >
                <option value="tiny">Tiny (fastest)</option>
                <option value="base">Base (recommended)</option>
                <option value="small">Small</option>
                <option value="medium">Medium (accurate)</option>
              </select>
              <button
                className="btn-primary"
                onClick={startTranscribe}
                disabled={transcribing}
              >
                {transcribing ? <><span className="spinner" style={{width:12,height:12,borderWidth:2}} /> Transcribing…</> : '⚡ Transcribe'}
              </button>
            </>
          )}
          {transcript && (
            <button className="btn-secondary" onClick={startTranscribe} disabled={transcribing}>
              {transcribing ? <><span className="spinner" style={{width:12,height:12,borderWidth:2}} /> Re-transcribing…</> : '↺ Re-transcribe'}
            </button>
          )}
          {uploadedFile && (
            <button className="btn-ghost" onClick={newFile}>New file</button>
          )}
        </div>
      </header>

      {/* Main workspace */}
      {!uploadedFile ? (
        <div style={{flex:1, display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg)'}}>
          <div style={{width:'100%', maxWidth:600}}>
            <div style={{textAlign:'center', marginBottom:32}}>
              <h1 style={{fontSize:28, fontWeight:700, color:'var(--text)', letterSpacing:-1}}>
                Transcript-based video editing
              </h1>
              <p style={{color:'var(--text-muted)', marginTop:8, fontSize:14}}>
                Upload a video or audio file. Edit the transcript to cut content.<br/>
                Auto-clip your best moments.
              </p>
            </div>
            <UploadZone onUpload={handleUpload} />
          </div>
        </div>
      ) : (
        <div className="workspace">
          {/* LEFT — Transcript */}
          <div className="panel-left">
            <div className="panel-header">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
                <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
                <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
              </svg>
              Transcript
              {transcribing && <span className="spinner" style={{width:12,height:12,borderWidth:2,marginLeft:4}} />}
            </div>

            {!transcript && !transcribing ? (
              <div className="empty-state">
                <span className="empty-state-icon">⚡</span>
                <span className="empty-state-title">No transcript</span>
                <span className="empty-state-desc">
                  Click "Transcribe" to generate a word-level<br/>transcript and start editing
                </span>
                <button className="btn-primary" style={{marginTop:8}} onClick={startTranscribe}>
                  ⚡ Transcribe now
                </button>
              </div>
            ) : transcribing && !transcript ? (
              <div className="empty-state">
                <span className="spinner" style={{width:28,height:28,borderWidth:3}} />
                <span className="empty-state-title">Transcribing…</span>
                <span className="empty-state-desc">This may take a moment depending<br/>on file length and model size</span>
              </div>
            ) : (
              <TranscriptEditor
                transcript={transcript}
                currentTime={currentTime}
                onSeek={handleSeek}
                onSegmentsChange={handleSegmentsChange}
              />
            )}
          </div>

          {/* CENTER — Video */}
          <div className="panel-center">
            <div className="panel-header">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
              </svg>
              {isAudio ? 'Audio' : 'Video'}
            </div>
            <VideoPlayer
              ref={videoRef}
              mediaUrl={uploadedFile.media_url}
              currentTime={seekTo}
              onTimeUpdate={handleTimeUpdate}
              duration={uploadedFile.duration}
              isAudio={isAudio}
              clipRange={previewRange}
              onClipEnd={() => setPreviewRange(null)}
              keptSegments={keptSegments}
              transcript={transcript}
              subtitleConfig={subtitleConfig}
            />
          </div>

          {/* RIGHT — Clips */}
          <div className="panel-right">
            <div className="panel-header">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
                <line x1="20" y1="4" x2="8.12" y2="15.88"/>
                <line x1="14.47" y1="14.48" x2="20" y2="20"/>
                <line x1="8.12" y1="8.12" x2="12" y2="12"/>
              </svg>
              Clips
            </div>
            <ClipsPanel
              fileId={uploadedFile?.file_id}
              keptSegments={keptSegments}
              onPreviewClip={handlePreviewClip}
              previewRange={previewRange}
              subtitleConfig={subtitleConfig}
              onSubtitleConfigChange={setSubtitleConfig}
              onToast={addToast}
            />
          </div>
        </div>
      )}

      {/* Toasts */}
      <div className="toasts">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>
        ))}
      </div>
    </div>
  )
}
