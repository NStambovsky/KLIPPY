import React, { useState } from 'react'

function fmt(ms) {
  if (!isFinite(ms) || ms == null) return '0:00'
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

function ScoreBar({ score }) {
  const pct = Math.round((score || 0) * 100)
  return (
    <div className="flex items-center gap-1.5 mt-1">
      <div className="flex-1 h-1 bg-gray-700 rounded overflow-hidden">
        <div className="h-full bg-violet-500 rounded" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500 tabular-nums">{pct}%</span>
    </div>
  )
}

function ClipCard({ clip, onSeek, onExport, onDelete, onRename }) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(clip.title)

  function submitRename() {
    setEditing(false)
    if (title.trim()) onRename(clip.id, title.trim())
    else setTitle(clip.title)
  }

  return (
    <div className="border-b border-gray-800 px-3 py-2.5 hover:bg-gray-900/50 transition-colors">
      {editing ? (
        <input
          autoFocus value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={submitRename}
          onKeyDown={(e) => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') { setEditing(false); setTitle(clip.title) } }}
          className="w-full bg-gray-800 text-gray-100 text-xs px-2 py-1 rounded border border-violet-500 outline-none mb-1"
        />
      ) : (
        <div className="flex items-start justify-between gap-1 mb-1">
          <button className="text-xs font-medium text-gray-200 text-left truncate flex-1 hover:text-violet-300 transition-colors" onClick={() => setEditing(true)} title="Click to rename">
            {clip.title}
          </button>
          <span className="text-xs text-gray-500 tabular-nums flex-shrink-0">{fmt(clip.endMs - clip.startMs)}</span>
        </div>
      )}
      <div className="text-xs text-gray-600 mb-1.5">{fmt(clip.startMs)} – {fmt(clip.endMs)}</div>
      <div className="flex gap-1.5">
        <button onClick={() => onSeek(clip.startMs)} className="px-2 py-0.5 text-xs bg-gray-800 hover:bg-gray-700 rounded transition-colors">▶ Play</button>
        <button onClick={() => onExport(clip)} className="px-2 py-0.5 text-xs bg-violet-600 hover:bg-violet-500 rounded transition-colors">⬇ Export</button>
        <button onClick={() => onDelete(clip.id)} className="px-2 py-0.5 text-xs text-gray-600 hover:text-red-400 transition-colors ml-auto">✕</button>
      </div>
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-gray-800/50">
      <span className="text-xs text-gray-400 flex-shrink-0">{label}</span>
      <div className="flex items-center gap-1.5">{children}</div>
    </div>
  )
}

function SegBtns({ options, value, onChange }) {
  return (
    <div className="flex gap-1">
      {options.map(([val, label]) => (
        <button key={val} onClick={() => onChange(val)}
          className={`px-2 py-0.5 text-xs rounded transition-colors ${value === val ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
          {label}
        </button>
      ))}
    </div>
  )
}

export default function ClipsPanel({
  clips, aiSuggestions, onSeek, onExportClip, onAcceptSuggestion,
  onDeleteClip, onRenameClip, onFindClips, hasTranscript, isWorking,
  captionStyle, onCaptionStyleChange,
}) {
  const [tab, setTab] = useState('clips')
  const set = (k, v) => onCaptionStyleChange(s => ({ ...s, [k]: v }))

  const FONTS = ['Impact', 'Arial Black', 'Helvetica', 'Arial', 'Courier New']

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="flex border-b border-gray-800 flex-shrink-0">
        {[['clips', `Clips${clips.length ? ` (${clips.length})` : ''}`], ['ai', '✨ AI'], ['captions', '💬 Captions']].map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${tab === t ? 'text-violet-400 border-b-2 border-violet-500' : 'text-gray-500 hover:text-gray-300'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Clips tab ── */}
      {tab === 'clips' && (
        <div className="flex-1 overflow-y-auto">
          {clips.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4 text-gray-600">
              <p className="text-3xl mb-2 opacity-20">🎬</p>
              <p className="text-sm">No clips yet.</p>
              <p className="text-xs mt-1">Select words in the transcript,<br/>right-click → Make Clip</p>
            </div>
          ) : clips.map((clip) => (
            <ClipCard key={clip.id} clip={clip} onSeek={onSeek} onExport={onExportClip} onDelete={onDeleteClip} onRename={onRenameClip} />
          ))}
        </div>
      )}

      {/* ── AI tab ── */}
      {tab === 'ai' && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="p-3 border-b border-gray-800 flex-shrink-0">
            <button onClick={onFindClips} disabled={!hasTranscript || isWorking}
              className="w-full py-1.5 text-xs bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded font-medium transition-colors">
              {isWorking ? '…Analyzing' : '✨ Find Clips with AI'}
            </button>
            <p className="text-xs text-gray-600 mt-2">Requires Anthropic API key in Settings.</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {aiSuggestions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4 text-gray-600">
                <p className="text-3xl mb-2 opacity-20">✨</p>
                <p className="text-sm">No suggestions yet.</p>
              </div>
            ) : aiSuggestions.map((s, i) => (
              <div key={i} className="border-b border-gray-800 px-3 py-2.5 hover:bg-gray-900/50 transition-colors">
                <div className="flex items-start justify-between gap-1 mb-0.5">
                  <span className="text-xs font-medium text-gray-200 flex-1">{s.title}</span>
                  <span className="text-xs text-gray-500 tabular-nums flex-shrink-0">{fmt(s.endMs - s.startMs)}</span>
                </div>
                <p className="text-xs text-gray-500 mb-1 leading-relaxed">{s.rationale}</p>
                <ScoreBar score={s.score} />
                <div className="flex gap-1.5 mt-2">
                  <button onClick={() => onSeek(s.startMs)} className="px-2 py-0.5 text-xs bg-gray-800 hover:bg-gray-700 rounded transition-colors">▶ Preview</button>
                  <button onClick={() => onAcceptSuggestion(s)} className="px-2 py-0.5 text-xs bg-violet-600 hover:bg-violet-500 rounded transition-colors">+ Accept</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Captions tab ── */}
      {tab === 'captions' && (
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
          <Row label="Captions">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <div
                onClick={() => set('enabled', !captionStyle.enabled)}
                className={`w-8 h-4 rounded-full transition-colors relative ${captionStyle.enabled ? 'bg-violet-600' : 'bg-gray-700'}`}
              >
                <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${captionStyle.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>
              <span className="text-xs text-gray-400">{captionStyle.enabled ? 'On' : 'Off'}</span>
            </label>
          </Row>

          <Row label="Style">
            <SegBtns options={[['word','Word'],['sentence','Sentence']]} value={captionStyle.mode} onChange={v => set('mode', v)} />
          </Row>

          <Row label="Position">
            <SegBtns options={[['top','Top'],['middle','Mid'],['bottom','Bot']]} value={captionStyle.position} onChange={v => set('position', v)} />
          </Row>

          <Row label="Font">
            <select value={captionStyle.font} onChange={e => set('font', e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-200 outline-none">
              {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </Row>

          <Row label={`Size ${captionStyle.size}px`}>
            <input type="range" min={40} max={120} step={4} value={captionStyle.size}
              onChange={e => set('size', +e.target.value)} className="w-24 accent-violet-500" />
          </Row>

          <Row label="ALL CAPS">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <div onClick={() => set('allCaps', !captionStyle.allCaps)}
                className={`w-8 h-4 rounded-full transition-colors relative ${captionStyle.allCaps ? 'bg-violet-600' : 'bg-gray-700'}`}>
                <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${captionStyle.allCaps ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>
            </label>
          </Row>

          <Row label="Text color">
            <div className="flex items-center gap-1.5">
              <input type="color" value={captionStyle.color} onChange={e => set('color', e.target.value)}
                className="w-7 h-6 rounded cursor-pointer bg-transparent border-0" />
              <span className="text-xs text-gray-500">{captionStyle.color}</span>
            </div>
          </Row>

          <Row label="Outline color">
            <div className="flex items-center gap-1.5">
              <input type="color" value={captionStyle.outlineColor} onChange={e => set('outlineColor', e.target.value)}
                className="w-7 h-6 rounded cursor-pointer bg-transparent border-0" />
              <span className="text-xs text-gray-500">{captionStyle.outlineColor}</span>
            </div>
          </Row>

          <Row label={`Outline ${captionStyle.outlineSize}px`}>
            <input type="range" min={0} max={8} step={0.5} value={captionStyle.outlineSize}
              onChange={e => set('outlineSize', +e.target.value)} className="w-24 accent-violet-500" />
          </Row>

          <p className="text-xs text-gray-600 pt-2">
            Preview shows in the video player. Captions are burned in during export.
          </p>
        </div>
      )}
    </div>
  )
}
