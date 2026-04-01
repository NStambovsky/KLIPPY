import React, { useState, useEffect, useCallback } from 'react'

async function safeJson(res) {
  const text = await res.text()
  if (!text) return {}
  try { return JSON.parse(text) } catch { return { detail: text } }
}

function formatDur(s) {
  if (!isFinite(s) || s == null) return '–'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * ClipsPanel — right sidebar
 * Shows:
 *  1. Auto-clip suggestions (from /auto-clip)
 *  2. Exported clips (from /clips)
 */
export default function ClipsPanel({ fileId, keptSegments, onSeekToClip, onToast }) {
  const [autoClips, setAutoClips] = useState([])
  const [exportedClips, setExportedClips] = useState([])
  const [loadingAuto, setLoadingAuto] = useState(false)
  const [exportingJob, setExportingJob] = useState(null) // {jobId, outputName}
  const [exportingId, setExportingId] = useState(null) // which clip is being exported
  const [numClips, setNumClips] = useState(5)
  const [targetDur, setTargetDur] = useState(60)
  const [tab, setTab] = useState('auto') // 'auto' | 'exports'

  // Load exported clips on mount and after export
  const loadExports = useCallback(async () => {
    try {
      const res = await fetch('/clips')
      if (res.ok) {
        const data = await res.json()
        setExportedClips(data.clips || [])
      }
    } catch {}
  }, [])

  useEffect(() => { loadExports() }, [loadExports])

  async function runAutoClip() {
    if (!fileId) return
    setLoadingAuto(true)
    setAutoClips([])
    try {
      const res = await fetch('/auto-clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: fileId, num_clips: numClips, target_duration: targetDur }),
      })
      const data = await safeJson(res)
      if (!res.ok) {
        onToast(data.detail || 'Auto-clip failed', 'error')
        return
      }
      setAutoClips(data.clips || [])
      if (!data.clips?.length) onToast('No clips found — try a longer video', 'info')
    } catch (e) {
      onToast(e.message, 'error')
    } finally {
      setLoadingAuto(false)
    }
  }

  async function exportCurrentEdit() {
    if (!fileId || !keptSegments?.length) {
      onToast('Nothing to export — transcript is empty or fully cut', 'error')
      return
    }
    setExportingId('edit')
    try {
      const res = await fetch('/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_id: fileId,
          kept_segments: keptSegments,
          output_name: `edit_${Date.now()}`,
        }),
      })
      const data = await safeJson(res)
      if (!res.ok) {
        onToast(data.detail || 'Export failed', 'error')
        setExportingId(null)
        return
      }
      pollJob(data.job_id, data.output_name, 'edit')
    } catch (e) {
      onToast(e.message, 'error')
      setExportingId(null)
    }
  }

  async function exportAutoClip(clip, idx) {
    if (!fileId) return
    setExportingId(idx)
    try {
      const res = await fetch('/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_id: fileId,
          kept_segments: [{ start: clip.start, end: clip.end }],
          output_name: `autoclip_${idx + 1}_${Date.now()}`,
        }),
      })
      const data = await safeJson(res)
      if (!res.ok) {
        onToast(data.detail || 'Export failed', 'error')
        setExportingId(null)
        return
      }
      pollJob(data.job_id, data.output_name, idx)
    } catch (e) {
      onToast(e.message, 'error')
      setExportingId(null)
    }
  }

  function pollJob(jobId, outputName, exportId) {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/job/${jobId}`)
        const job = await safeJson(res)
        if (job.status === 'done') {
          clearInterval(interval)
          setExportingId(null)
          onToast(`Exported: ${outputName}`, 'success')
          loadExports()
          setTab('exports')
        } else if (job.status === 'error') {
          clearInterval(interval)
          setExportingId(null)
          onToast(job.error || 'Export failed', 'error')
        }
      } catch {
        clearInterval(interval)
        setExportingId(null)
      }
    }, 1000)
  }

  async function deleteExport(name) {
    try {
      await fetch(`/clip/${encodeURIComponent(name)}`, { method: 'DELETE' })
      loadExports()
    } catch {}
  }

  return (
    <div className="clips-panel">
      {/* Export current edit button always visible */}
      <div className="export-edit-bar">
        <button
          className="btn-primary export-btn"
          onClick={exportCurrentEdit}
          disabled={exportingId === 'edit' || !fileId || !keptSegments?.length}
        >
          {exportingId === 'edit' ? (
            <><span className="spinner" /> Exporting…</>
          ) : (
            <>⬇ Export Edit</>
          )}
        </button>
        <span style={{fontSize:11, color:'var(--text-dim)', marginTop:2}}>
          {keptSegments?.length
            ? `${keptSegments.length} segment${keptSegments.length !== 1 ? 's' : ''} kept`
            : 'Edit the transcript to trim'}
        </span>
      </div>

      {/* Tabs */}
      <div className="clips-tabs">
        <button className={`tab-btn ${tab === 'auto' ? 'active' : ''}`} onClick={() => setTab('auto')}>
          Auto-Clips
        </button>
        <button className={`tab-btn ${tab === 'exports' ? 'active' : ''}`} onClick={() => setTab('exports')}>
          Exports {exportedClips.length > 0 && <span className="badge">{exportedClips.length}</span>}
        </button>
      </div>

      {tab === 'auto' && (
        <div className="clips-tab-body">
          {/* Auto-clip settings */}
          <div className="autoclip-settings">
            <label>
              <span>Clips</span>
              <select value={numClips} onChange={e => setNumClips(+e.target.value)}>
                {[3,5,8,10].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label>
              <span>Target length</span>
              <select value={targetDur} onChange={e => setTargetDur(+e.target.value)}>
                <option value={30}>30s</option>
                <option value={60}>60s</option>
                <option value={90}>90s</option>
              </select>
            </label>
            <button
              className="btn-primary"
              onClick={runAutoClip}
              disabled={!fileId || loadingAuto}
              style={{marginTop: 4}}
            >
              {loadingAuto ? <><span className="spinner" /> Analyzing…</> : '✦ Find Clips'}
            </button>
          </div>

          {/* Auto clip list */}
          {autoClips.length === 0 && !loadingAuto && (
            <div className="empty-state" style={{paddingTop: 24}}>
              <span className="empty-state-icon">✦</span>
              <span className="empty-state-title">No clips yet</span>
              <span className="empty-state-desc">Transcribe a file then click "Find Clips"</span>
            </div>
          )}

          <div className="clip-list">
            {autoClips.map((clip, i) => (
              <div key={i} className="clip-card">
                <div className="clip-card-header">
                  <span className="clip-title">{clip.title || `Clip ${i + 1}`}</span>
                  <span className="badge badge-accent">{formatDur(clip.end - clip.start)}</span>
                </div>
                <div className="clip-meta">
                  {formatTime(clip.start)} – {formatTime(clip.end)}
                  <span className="clip-score">score {(clip.score * 100).toFixed(0)}%</span>
                </div>
                <p className="clip-preview">{clip.text?.slice(0, 100)}{clip.text?.length > 100 ? '…' : ''}</p>
                <div className="clip-actions">
                  <button className="btn-ghost" onClick={() => onSeekToClip(clip.start)} title="Preview">
                    ▶ Preview
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => exportAutoClip(clip, i)}
                    disabled={exportingId === i}
                  >
                    {exportingId === i ? <><span className="spinner" /> …</> : '⬇ Export'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'exports' && (
        <div className="clips-tab-body">
          {exportedClips.length === 0 ? (
            <div className="empty-state" style={{paddingTop: 24}}>
              <span className="empty-state-icon">📁</span>
              <span className="empty-state-title">No exports yet</span>
              <span className="empty-state-desc">Export a clip or your current edit</span>
            </div>
          ) : (
            <div className="clip-list">
              {exportedClips.map(clip => (
                <div key={clip.name} className="clip-card">
                  <div className="clip-card-header">
                    <span className="clip-title" style={{fontSize:12}}>{clip.name}</span>
                    <span className="badge">{formatSize(clip.size)}</span>
                  </div>
                  <div className="clip-actions" style={{marginTop: 8}}>
                    <a
                      href={clip.url}
                      download={clip.name}
                      className="btn-primary"
                      style={{textDecoration:'none', display:'flex', alignItems:'center', gap:4, padding:'5px 12px', fontSize:12, borderRadius: 6}}
                    >
                      ⬇ Download
                    </a>
                    <button className="btn-danger" onClick={() => deleteExport(clip.name)}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <style>{`
        .clips-panel { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
        .export-edit-bar {
          padding: 10px 12px;
          border-bottom: 1px solid var(--border);
          display: flex; flex-direction: column; gap: 4px;
          flex-shrink: 0;
        }
        .export-btn { display: flex; align-items: center; gap: 6px; justify-content: center; width: 100%; padding: 8px; }
        .clips-tabs {
          display: flex; border-bottom: 1px solid var(--border);
          flex-shrink: 0;
        }
        .tab-btn {
          flex: 1; padding: 8px; font-size: 12px; font-weight: 500;
          background: transparent; color: var(--text-muted); border: none;
          border-bottom: 2px solid transparent;
          border-radius: 0; cursor: pointer;
          display: flex; align-items: center; justify-content: center; gap: 5px;
          transition: all 0.15s;
        }
        .tab-btn:hover { color: var(--text); background: var(--surface2); }
        .tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); }
        .clips-tab-body { flex: 1; overflow-y: auto; }
        .autoclip-settings {
          padding: 10px 12px;
          display: flex; flex-direction: column; gap: 8px;
          border-bottom: 1px solid var(--border);
        }
        .autoclip-settings label {
          display: flex; align-items: center; justify-content: space-between;
          font-size: 12px; color: var(--text-muted);
        }
        .autoclip-settings select {
          background: var(--surface3); border: 1px solid var(--border);
          color: var(--text); border-radius: 5px; padding: 3px 6px;
          font-size: 12px; cursor: pointer;
        }
        .clip-list { display: flex; flex-direction: column; gap: 0; }
        .clip-card {
          padding: 10px 12px;
          border-bottom: 1px solid var(--border);
          transition: background 0.1s;
        }
        .clip-card:hover { background: var(--surface2); }
        .clip-card-header { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 3px; }
        .clip-title { font-size: 12px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .clip-meta { font-size: 10px; color: var(--text-dim); display: flex; gap: 8px; align-items: center; margin-bottom: 4px; }
        .clip-score { color: var(--accent); font-weight: 600; }
        .clip-preview { font-size: 11px; color: var(--text-muted); line-height: 1.5; margin-bottom: 6px; }
        .clip-actions { display: flex; gap: 5px; }
        .clip-actions button, .clip-actions a { font-size: 11px; padding: 4px 8px; }
      `}</style>
    </div>
  )
}

function formatTime(s) {
  if (!isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}
