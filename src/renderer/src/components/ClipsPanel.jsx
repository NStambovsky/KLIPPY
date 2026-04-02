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

  const dur = clip.endMs - clip.startMs

  return (
    <div className="border-b border-gray-800 px-3 py-2.5 hover:bg-gray-900/50 transition-colors">
      {editing ? (
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={submitRename}
          onKeyDown={(e) => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') { setEditing(false); setTitle(clip.title) } }}
          className="w-full bg-gray-800 text-gray-100 text-xs px-2 py-1 rounded border border-violet-500 outline-none mb-1"
        />
      ) : (
        <div className="flex items-start justify-between gap-1 mb-1">
          <button
            className="text-xs font-medium text-gray-200 text-left truncate flex-1 hover:text-violet-300 transition-colors"
            onClick={() => setEditing(true)}
            title="Click to rename"
          >
            {clip.title}
          </button>
          <span className="text-xs text-gray-500 tabular-nums flex-shrink-0">{fmt(dur)}</span>
        </div>
      )}
      <div className="text-xs text-gray-600 mb-1.5">{fmt(clip.startMs)} – {fmt(clip.endMs)}</div>
      <div className="flex gap-1.5">
        <button
          onClick={() => onSeek(clip.startMs)}
          className="px-2 py-0.5 text-xs bg-gray-800 hover:bg-gray-700 rounded transition-colors"
        >
          ▶ Play
        </button>
        <button
          onClick={() => onExport(clip)}
          className="px-2 py-0.5 text-xs bg-violet-600 hover:bg-violet-500 rounded transition-colors"
        >
          ⬇ Export
        </button>
        <button
          onClick={() => onDelete(clip.id)}
          className="px-2 py-0.5 text-xs text-gray-600 hover:text-red-400 transition-colors ml-auto"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

function SuggestionCard({ suggestion, onSeek, onAccept }) {
  return (
    <div className="border-b border-gray-800 px-3 py-2.5 hover:bg-gray-900/50 transition-colors">
      <div className="flex items-start justify-between gap-1 mb-0.5">
        <span className="text-xs font-medium text-gray-200 flex-1">{suggestion.title}</span>
        <span className="text-xs text-gray-500 tabular-nums flex-shrink-0">
          {fmt(suggestion.endMs - suggestion.startMs)}
        </span>
      </div>
      <p className="text-xs text-gray-500 mb-1 leading-relaxed">{suggestion.rationale}</p>
      <ScoreBar score={suggestion.score} />
      <div className="flex gap-1.5 mt-2">
        <button
          onClick={() => onSeek(suggestion.startMs)}
          className="px-2 py-0.5 text-xs bg-gray-800 hover:bg-gray-700 rounded transition-colors"
        >
          ▶ Preview
        </button>
        <button
          onClick={() => onAccept(suggestion)}
          className="px-2 py-0.5 text-xs bg-violet-600 hover:bg-violet-500 rounded transition-colors"
        >
          + Accept
        </button>
      </div>
    </div>
  )
}

export default function ClipsPanel({
  clips, aiSuggestions,
  onSeek, onExportClip, onAcceptSuggestion,
  onDeleteClip, onRenameClip,
  onFindClips, hasTranscript, isWorking,
}) {
  const [tab, setTab] = useState('clips')

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="flex border-b border-gray-800 flex-shrink-0">
        {['clips', 'ai'].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${
              tab === t
                ? 'text-violet-400 border-b-2 border-violet-500'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {t === 'clips' ? `Clips${clips.length ? ` (${clips.length})` : ''}` : '✨ AI Suggestions'}
          </button>
        ))}
      </div>

      {tab === 'clips' && (
        <div className="flex-1 overflow-y-auto">
          {clips.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4 text-gray-600">
              <p className="text-3xl mb-2 opacity-20">🎬</p>
              <p className="text-sm">No clips yet.</p>
              <p className="text-xs mt-1">Select words in the transcript and right-click → Make Clip</p>
            </div>
          ) : (
            clips.map((clip) => (
              <ClipCard
                key={clip.id}
                clip={clip}
                onSeek={onSeek}
                onExport={onExportClip}
                onDelete={onDeleteClip}
                onRename={onRenameClip}
              />
            ))
          )}
        </div>
      )}

      {tab === 'ai' && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="p-3 border-b border-gray-800 flex-shrink-0">
            <button
              onClick={onFindClips}
              disabled={!hasTranscript || isWorking}
              className="w-full py-1.5 text-xs bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded font-medium transition-colors"
            >
              {isWorking ? '…Analyzing' : '✨ Find Clips with AI'}
            </button>
            <p className="text-xs text-gray-600 mt-2">
              Uses Claude to identify the most compelling moments in your transcript.
            </p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {aiSuggestions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4 text-gray-600">
                <p className="text-3xl mb-2 opacity-20">✨</p>
                <p className="text-sm">No suggestions yet.</p>
                <p className="text-xs mt-1">Transcribe a file and click Find Clips</p>
              </div>
            ) : (
              aiSuggestions.map((s, i) => (
                <SuggestionCard
                  key={i}
                  suggestion={s}
                  onSeek={onSeek}
                  onAccept={onAcceptSuggestion}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
