import React, { useRef, useState } from 'react'

const ACCEPTED = '.mp4,.mov,.mkv,.webm,.avi,.mp3,.wav,.m4a,.ogg,.flac,.aac'

async function safeJson(res) {
  const text = await res.text()
  if (!text) return {}
  try { return JSON.parse(text) } catch { return { detail: text } }
}

export default function UploadZone({ onUpload }) {
  const inputRef = useRef(null)
  const [tab, setTab] = useState('file') // 'file' | 'url'
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [error, setError] = useState(null)
  const [downloadProgress, setDownloadProgress] = useState(null)

  async function handleFiles(files) {
    const file = files[0]
    if (!file) return
    setError(null)
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/upload', { method: 'POST', body: form })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data.detail || 'Upload failed')
      onUpload(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  async function handleUrl() {
    const url = urlInput.trim()
    if (!url) return
    setError(null)
    setUploading(true)
    setDownloadProgress('Starting download…')

    try {
      const res = await fetch('/download-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data.detail || 'Download failed')

      // Poll the job
      const jobId = data.job_id
      await new Promise((resolve, reject) => {
        const interval = setInterval(async () => {
          try {
            const jr = await fetch(`/job/${jobId}`)
            const job = await safeJson(jr)
            if (job.status === 'done') {
              clearInterval(interval)
              resolve(job.result)
            } else if (job.status === 'error') {
              clearInterval(interval)
              reject(new Error(job.error || 'Download failed'))
            } else {
              setDownloadProgress('Downloading…')
            }
          } catch (e) {
            clearInterval(interval)
            reject(e)
          }
        }, 1500)
      }).then(result => {
        onUpload(result)
        setUrlInput('')
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
      setDownloadProgress(null)
    }
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    handleFiles(e.dataTransfer.files)
  }

  return (
    <div className="upload-zone-wrap">
      {/* Tabs */}
      <div className="upload-tabs">
        <button
          className={`upload-tab ${tab === 'file' ? 'active' : ''}`}
          onClick={() => setTab('file')}
        >
          Upload file
        </button>
        <button
          className={`upload-tab ${tab === 'url' ? 'active' : ''}`}
          onClick={() => setTab('url')}
        >
          YouTube / URL
        </button>
      </div>

      {tab === 'file' ? (
        <div
          className={`upload-zone ${dragging ? 'dragging' : ''} ${uploading ? 'uploading' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => !uploading && inputRef.current.click()}
          role="button"
          tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && inputRef.current.click()}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED}
            style={{ display: 'none' }}
            onChange={e => handleFiles(e.target.files)}
          />
          {uploading ? (
            <>
              <div className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
              <p className="upload-label">Uploading…</p>
            </>
          ) : (
            <>
              <div className="upload-icon">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </div>
              <p className="upload-label">{dragging ? 'Drop to upload' : 'Drop video or audio here'}</p>
              <p className="upload-sub">or click to browse</p>
              <p className="upload-formats">MP4 · MOV · MKV · MP3 · WAV · M4A · and more</p>
            </>
          )}
        </div>
      ) : (
        <div className="url-zone">
          <div className="url-icon">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor" opacity="0.15">
              <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>
            </svg>
          </div>
          <p className="upload-label" style={{marginBottom: 12}}>Paste a YouTube link</p>
          <div className="url-input-row">
            <input
              type="url"
              className="url-input"
              placeholder="https://youtube.com/watch?v=..."
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !uploading && handleUrl()}
              disabled={uploading}
            />
            <button
              className="btn-primary"
              onClick={handleUrl}
              disabled={uploading || !urlInput.trim()}
            >
              {uploading ? <><span className="spinner" style={{width:12,height:12,borderWidth:2}} /> {downloadProgress || 'Working…'}</> : 'Import'}
            </button>
          </div>
          <p className="upload-sub" style={{marginTop: 8}}>
            Works with YouTube, Twitter/X, Vimeo, and most video sites
          </p>
        </div>
      )}

      {error && <p className="upload-error">{error}</p>}

      <style>{`
        .upload-zone-wrap { padding: 32px; display: flex; flex-direction: column; align-items: center; gap: 12px; height: 100%; justify-content: center; }
        .upload-tabs { display: flex; gap: 0; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
        .upload-tab {
          padding: 7px 20px; font-size: 13px; font-weight: 500;
          background: transparent; color: var(--text-muted);
          border: none; border-radius: 0; cursor: pointer; transition: all 0.15s;
        }
        .upload-tab:hover { background: var(--surface2); color: var(--text); }
        .upload-tab.active { background: var(--accent); color: #fff; }
        .upload-zone {
          width: 100%; max-width: 480px; min-height: 200px;
          border: 2px dashed var(--border); border-radius: var(--radius-lg);
          display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
          cursor: pointer; transition: all 0.2s; background: var(--surface2);
          padding: 32px; color: var(--text-muted); text-align: center;
        }
        .upload-zone:hover, .upload-zone.dragging { border-color: var(--accent); background: var(--accent-muted); color: var(--text); }
        .upload-zone.uploading { cursor: not-allowed; border-color: var(--border); }
        .upload-icon { opacity: 0.5; }
        .upload-zone:hover .upload-icon, .upload-zone.dragging .upload-icon { opacity: 1; }
        .url-zone {
          width: 100%; max-width: 480px; min-height: 200px;
          border: 1px solid var(--border); border-radius: var(--radius-lg);
          display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
          background: var(--surface2); padding: 32px; text-align: center;
        }
        .url-icon { margin-bottom: 4px; }
        .url-input-row { display: flex; gap: 8px; width: 100%; }
        .url-input {
          flex: 1; background: var(--surface3); border: 1px solid var(--border);
          color: var(--text); border-radius: var(--radius); padding: 7px 12px;
          font-size: 13px; outline: none; transition: border-color 0.15s;
        }
        .url-input:focus { border-color: var(--accent); }
        .url-input::placeholder { color: var(--text-dim); }
        .upload-label { font-size: 15px; font-weight: 600; color: var(--text); }
        .upload-sub { font-size: 12px; color: var(--text-muted); }
        .upload-formats { font-size: 11px; color: var(--text-dim); margin-top: 4px; }
        .upload-error { color: var(--danger); font-size: 13px; max-width: 480px; text-align: center; }
      `}</style>
    </div>
  )
}
