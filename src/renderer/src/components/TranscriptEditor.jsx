import React, { useRef, useState, useEffect, useMemo } from 'react'

function fmt(ms) {
  if (!isFinite(ms) || ms == null) return '0:00'
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export default function TranscriptEditor({
  transcript, deletedIds, currentTimeMs,
  onSeek, onDelete, onRestore, onMakeClip,
  isWorking, onTranscribe,
}) {
  const [dragStart, setDragStart] = useState(null)  // word index
  const [dragEnd, setDragEnd] = useState(null)       // word index
  const [isDragging, setIsDragging] = useState(false)
  const [contextMenu, setContextMenu] = useState(null) // {x, y, startIdx, endIdx}
  const activeRef = useRef(null)
  const containerRef = useRef(null)

  // Currently playing word (by timestamp)
  const activeIdx = useMemo(() => {
    if (!transcript.length) return -1
    for (let i = transcript.length - 1; i >= 0; i--) {
      if (transcript[i].startMs <= currentTimeMs) return i
    }
    return -1
  }, [transcript, currentTimeMs])

  // Auto-scroll to active word
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [activeIdx])

  // Selection range (indices, inclusive)
  const selMin = dragStart != null && dragEnd != null ? Math.min(dragStart, dragEnd) : null
  const selMax = dragStart != null && dragEnd != null ? Math.max(dragStart, dragEnd) : null
  const hasSelection = selMin != null

  // Delete key handler
  useEffect(() => {
    function onKey(e) {
      if (!hasSelection) return
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        const ids = []
        for (let i = selMin; i <= selMax; i++) ids.push(transcript[i].id)
        const allDeleted = ids.every((id) => deletedIds.has(id))
        if (allDeleted) onRestore(ids)
        else onDelete(ids)
        setDragStart(null); setDragEnd(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hasSelection, selMin, selMax, transcript, deletedIds, onDelete, onRestore])

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return
    const handler = () => setContextMenu(null)
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [contextMenu])

  function onWordMouseDown(e, idx) {
    if (e.button !== 0) return  // ignore right-click / middle-click
    e.preventDefault()
    setIsDragging(true)
    setDragStart(idx)
    setDragEnd(idx)
  }

  function onWordMouseEnter(idx) {
    if (isDragging) setDragEnd(idx)
  }

  function onWordMouseUp(e, idx) {
    setIsDragging(false)
    // Single click with no drag → seek
    if (dragStart === idx && dragEnd === idx) {
      onSeek(transcript[idx].startMs)
      setDragStart(null); setDragEnd(null)
    }
    // else keep selection
  }

  function onWordContextMenu(e, idx) {
    e.preventDefault()
    // If no selection, select this word
    const start = (selMin != null && idx >= selMin && idx <= selMax) ? selMin : idx
    const end   = (selMin != null && idx >= selMin && idx <= selMax) ? selMax  : idx
    setContextMenu({ x: e.clientX, y: e.clientY, startIdx: start, endIdx: end })
  }

  function handleContextCut() {
    if (!contextMenu) return
    const ids = []
    for (let i = contextMenu.startIdx; i <= contextMenu.endIdx; i++) ids.push(transcript[i].id)
    onDelete(ids)
    setContextMenu(null); setDragStart(null); setDragEnd(null)
  }

  function handleContextMakeClip() {
    if (!contextMenu) return
    onMakeClip(contextMenu.startIdx, contextMenu.endIdx)
    setContextMenu(null); setDragStart(null); setDragEnd(null)
  }

  function handleContextRestore() {
    if (!contextMenu) return
    const ids = []
    for (let i = contextMenu.startIdx; i <= contextMenu.endIdx; i++) ids.push(transcript[i].id)
    onRestore(ids)
    setContextMenu(null)
  }

  if (!transcript.length) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-8 text-gray-500">
        {isWorking ? (
          <>
            <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm">Transcribing…</p>
          </>
        ) : (
          <>
            <p className="text-4xl mb-3 opacity-20">📝</p>
            <p className="text-sm text-gray-400 mb-4">No transcript yet.</p>
            <button
              onClick={onTranscribe}
              className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-colors"
            >
              ⚡ Transcribe now
            </button>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 transcript-body" ref={containerRef}
      onMouseLeave={() => { if (isDragging) setIsDragging(false) }}
    >
      <p className="text-xs text-gray-600 mb-3">
        Click to seek · drag to select · use the bar below to create a clip or cut
      </p>

      <div className="leading-8 text-sm text-gray-200">
        {transcript.map((word, idx) => {
          const isDeleted = deletedIds.has(word.id)
          const isActive = idx === activeIdx
          const isSelected = hasSelection && idx >= selMin && idx <= selMax
          const isFiller = word.isFiller

          let cls = 'inline cursor-pointer rounded px-0.5 transition-colors duration-75 '
          if (isDeleted) {
            cls += 'line-through text-gray-600 bg-red-950/60 hover:bg-red-900/60 '
          } else if (isActive) {
            cls += 'bg-violet-800/70 text-violet-200 '
          } else if (isSelected) {
            cls += 'bg-violet-600/40 text-violet-100 '
          } else if (isFiller) {
            cls += 'text-yellow-600/70 hover:bg-gray-800 '
          } else {
            cls += 'hover:bg-gray-800 '
          }

          return (
            <span
              key={word.id}
              ref={isActive ? activeRef : null}
              className={cls}
              onMouseDown={(e) => onWordMouseDown(e, idx)}
              onMouseEnter={() => onWordMouseEnter(idx)}
              onMouseUp={(e) => onWordMouseUp(e, idx)}
              onContextMenu={(e) => onWordContextMenu(e, idx)}
              title={`${word.startMs / 1000}s — confidence: ${Math.round((word.confidence || 1) * 100)}%`}
            >
              {word.word}
            </span>
          )
        })}
      </div>

      {/* Selection action bar */}
      {hasSelection && (
        <div className="sticky bottom-0 left-0 right-0 bg-gray-900/95 backdrop-blur border-t border-gray-700 px-3 py-2 flex items-center gap-3 shadow-lg">
          <span className="text-xs text-gray-400">
            {selMax - selMin + 1} words
            <span className="text-gray-600 ml-2">
              {fmt(transcript[selMin].startMs)} – {fmt(transcript[selMax].endMs)}
            </span>
          </span>
          <div className="flex gap-2 ml-auto">
            <button
              onClick={() => {
                const ids = []
                for (let i = selMin; i <= selMax; i++) ids.push(transcript[i].id)
                const allDeleted = ids.every((id) => deletedIds.has(id))
                if (allDeleted) onRestore(ids)
                else onDelete(ids)
                setDragStart(null); setDragEnd(null)
              }}
              className="px-3 py-1 text-xs bg-gray-800 hover:bg-gray-700 rounded transition-colors"
            >
              ✂ Cut
            </button>
            <button
              onClick={() => {
                onMakeClip(selMin, selMax)
                setDragStart(null); setDragEnd(null)
              }}
              className="px-3 py-1 text-xs bg-violet-600 hover:bg-violet-500 rounded font-medium transition-colors"
            >
              🎬 Create Clip
            </button>
          </div>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 text-sm"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button onClick={handleContextCut} className="w-full text-left px-4 py-1.5 hover:bg-gray-700 transition-colors">
            ✂️ Cut selection
          </button>
          <button onClick={handleContextMakeClip} className="w-full text-left px-4 py-1.5 hover:bg-gray-700 transition-colors">
            🎬 Make Clip
          </button>
          <button onClick={handleContextRestore} className="w-full text-left px-4 py-1.5 hover:bg-gray-700 transition-colors text-gray-400">
            ↩ Restore selection
          </button>
        </div>
      )}
    </div>
  )
}
