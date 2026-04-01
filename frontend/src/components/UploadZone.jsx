import React, { useRef, useState } from 'react'

const ACCEPTED = '.mp4,.mov,.mkv,.webm,.avi,.mp3,.wav,.m4a,.ogg,.flac,.aac'

export default function UploadZone({ onUpload }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)

  async function handleFiles(files) {
    const file = files[0]
    if (!file) return
    setError(null)
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/upload', { method: 'POST', body: form })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Upload failed')
      }
      const data = await res.json()
      onUpload(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    handleFiles(e.dataTransfer.files)
  }

  return (
    <div className="upload-zone-wrap">
      <div
        className={`upload-zone ${dragging ? 'dragging' : ''} ${uploading ? 'uploading' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !uploading && inputRef.current.click()}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && inputRef.current.click()}
        aria-label="Upload video or audio file"
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
            <p className="upload-label">
              {dragging ? 'Drop to upload' : 'Drop video or audio here'}
            </p>
            <p className="upload-sub">or click to browse</p>
            <p className="upload-formats">MP4 · MOV · MKV · MP3 · WAV · M4A · and more</p>
          </>
        )}
      </div>
      {error && <p className="upload-error">{error}</p>}

      <style>{`
        .upload-zone-wrap { padding: 32px; display: flex; flex-direction: column; align-items: center; gap: 8px; height: 100%; justify-content: center; }
        .upload-zone {
          width: 100%; max-width: 480px; min-height: 220px;
          border: 2px dashed var(--border);
          border-radius: var(--radius-lg);
          display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
          cursor: pointer; transition: all 0.2s;
          background: var(--surface2);
          padding: 32px;
          color: var(--text-muted);
          text-align: center;
        }
        .upload-zone:hover, .upload-zone.dragging {
          border-color: var(--accent);
          background: var(--accent-muted);
          color: var(--text);
        }
        .upload-zone.uploading { cursor: not-allowed; border-color: var(--border); }
        .upload-icon { opacity: 0.5; }
        .upload-zone:hover .upload-icon, .upload-zone.dragging .upload-icon { opacity: 1; }
        .upload-label { font-size: 15px; font-weight: 600; color: var(--text); }
        .upload-sub { font-size: 12px; color: var(--text-muted); }
        .upload-formats { font-size: 11px; color: var(--text-dim); margin-top: 4px; }
        .upload-error { color: var(--danger); font-size: 13px; }
      `}</style>
    </div>
  )
}
