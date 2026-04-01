import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'

/**
 * TranscriptEditor
 * - Displays word-level transcript synced to video playback
 * - Click word → seek video
 * - Select range of words → mark as deleted
 * - "Show filler" toggle to highlight filler words
 * - Undo/redo stack
 * - Exports kept segments for clip export
 */

export default function TranscriptEditor({
  transcript,
  currentTime,
  onSeek,
  onSegmentsChange,
}) {
  const { segments = [], duration = 0 } = transcript || {}

  // deletedWordIds: Set of "{segId}-{wordIdx}"
  const [deletedIds, setDeletedIds] = useState(new Set())
  const [undoStack, setUndoStack] = useState([])
  const [redoStack, setRedoStack] = useState([])
  const [showFiller, setShowFiller] = useState(true)
  const [selecting, setSelecting] = useState(false)
  const [selectStart, setSelectStart] = useState(null) // {segId, wordIdx}
  const [hoverWord, setHoverWord] = useState(null)
  const activeRef = useRef(null)
  const containerRef = useRef(null)

  // Flatten all words with their global position info
  const allWords = useMemo(() => {
    const result = []
    segments.forEach(seg => {
      (seg.words || []).forEach((w, wi) => {
        result.push({
          id: `${seg.id}-${wi}`,
          segId: seg.id,
          wordIdx: wi,
          word: w.word,
          start: w.start,
          end: w.end,
          isFiller: w.is_filler,
          prob: w.probability,
        })
      })
    })
    return result
  }, [segments])

  // Compute active word index based on currentTime
  const activeWordId = useMemo(() => {
    for (let i = allWords.length - 1; i >= 0; i--) {
      if (allWords[i].start <= currentTime) return allWords[i].id
    }
    return null
  }, [allWords, currentTime])

  // Auto-scroll to active word
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [activeWordId])

  // Recompute kept segments and notify parent whenever deletedIds changes
  useEffect(() => {
    const kept = computeKeptSegments(allWords, deletedIds, duration)
    onSegmentsChange(kept)
  }, [deletedIds, allWords, duration, onSegmentsChange])

  function pushUndo(prev) {
    setUndoStack(s => [...s.slice(-49), prev])
    setRedoStack([])
  }

  function undo() {
    setUndoStack(s => {
      if (!s.length) return s
      const prev = s[s.length - 1]
      setRedoStack(r => [...r, deletedIds])
      setDeletedIds(prev)
      return s.slice(0, -1)
    })
  }

  function redo() {
    setRedoStack(s => {
      if (!s.length) return s
      const next = s[s.length - 1]
      setUndoStack(u => [...u, deletedIds])
      setDeletedIds(next)
      return s.slice(0, -1)
    })
  }

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [deletedIds, undoStack, redoStack])

  function wordKey(segId, wordIdx) {
    return `${segId}-${wordIdx}`
  }

  function getWordsBetween(startW, endW) {
    const ids = []
    let inRange = false
    for (const w of allWords) {
      const key = wordKey(w.segId, w.wordIdx)
      if (key === startW || key === endW) {
        ids.push(key)
        if (startW === endW) break
        inRange = !inRange
      } else if (inRange) {
        ids.push(key)
      }
    }
    return ids
  }

  function onWordMouseDown(e, segId, wordIdx) {
    e.preventDefault()
    const key = wordKey(segId, wordIdx)
    setSelecting(true)
    setSelectStart(key)
  }

  function onWordMouseUp(e, segId, wordIdx) {
    if (!selecting) return
    const key = wordKey(segId, wordIdx)
    const range = selectStart ? getWordsBetween(selectStart, key) : [key]

    if (range.length > 0) {
      // Toggle: if ALL already deleted → restore; else delete all
      const allDeleted = range.every(id => deletedIds.has(id))
      pushUndo(new Set(deletedIds))
      setDeletedIds(prev => {
        const next = new Set(prev)
        if (allDeleted) range.forEach(id => next.delete(id))
        else range.forEach(id => next.add(id))
        return next
      })
    }

    setSelecting(false)
    setSelectStart(null)
  }

  function onWordClick(segId, wordIdx, start) {
    if (selecting) return
    onSeek(start)
  }

  function restoreAll() {
    pushUndo(new Set(deletedIds))
    setDeletedIds(new Set())
  }

  function deleteFillerWords() {
    pushUndo(new Set(deletedIds))
    setDeletedIds(prev => {
      const next = new Set(prev)
      allWords.forEach(w => { if (w.isFiller) next.add(wordKey(w.segId, w.wordIdx)) })
      return next
    })
  }

  const deletedCount = deletedIds.size
  const totalWords = allWords.length

  return (
    <div className="transcript-editor" ref={containerRef}>
      {/* Toolbar */}
      <div className="transcript-toolbar">
        <div className="transcript-stats">
          <span className="badge">
            {totalWords - deletedCount} / {totalWords} words
          </span>
          {deletedCount > 0 && (
            <span className="badge badge-warning">{deletedCount} cut</span>
          )}
        </div>
        <div className="transcript-toolbar-btns">
          <button className="btn-ghost" title="Remove filler words" onClick={deleteFillerWords}>
            Remove fillers
          </button>
          <button
            className={`btn-ghost filler-toggle ${showFiller ? 'active' : ''}`}
            onClick={() => setShowFiller(f => !f)}
            title="Highlight filler words"
          >
            Fillers
          </button>
          <button className="btn-ghost" onClick={undo} disabled={!undoStack.length} title="Undo (Ctrl+Z)">
            ↩
          </button>
          <button className="btn-ghost" onClick={redo} disabled={!redoStack.length} title="Redo (Ctrl+Y)">
            ↪
          </button>
          {deletedCount > 0 && (
            <button className="btn-ghost" onClick={restoreAll} title="Restore all cuts">
              Restore all
            </button>
          )}
        </div>
      </div>

      {/* Hint */}
      <div className="transcript-hint">
        Click a word to seek · Click &amp; drag to select · Click selected words to restore
      </div>

      {/* Transcript body */}
      <div className="transcript-body" onMouseLeave={() => { setSelecting(false); setSelectStart(null) }}>
        {segments.length === 0 && (
          <div className="empty-state">
            <span className="empty-state-icon">📝</span>
            <span className="empty-state-title">No transcript yet</span>
            <span className="empty-state-desc">Click "Transcribe" to generate a word-level transcript</span>
          </div>
        )}

        {segments.map(seg => (
          <div key={seg.id} className="seg-block">
            <div className="seg-time">{formatTime(seg.start)}</div>
            <div className="seg-words">
              {(seg.words || []).map((word, wi) => {
                const key = wordKey(seg.id, wi)
                const isDeleted = deletedIds.has(key)
                const isActive = `${seg.id}-${wi}` === activeWordId
                const isFiller = word.is_filler

                return (
                  <span
                    key={wi}
                    ref={isActive ? activeRef : null}
                    className={[
                      'word',
                      isDeleted ? 'word-deleted' : '',
                      isActive ? 'word-active' : '',
                      isFiller && showFiller ? 'word-filler' : '',
                    ].filter(Boolean).join(' ')}
                    onMouseDown={e => onWordMouseDown(e, seg.id, wi)}
                    onMouseUp={e => onWordMouseUp(e, seg.id, wi)}
                    onClick={() => !isDeleted && onWordClick(seg.id, wi, word.start)}
                    title={`${word.word.trim()} (${word.start.toFixed(2)}s–${word.end.toFixed(2)}s)`}
                  >
                    {word.word}
                  </span>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <style>{`
        .transcript-editor {
          display: flex; flex-direction: column; height: 100%; overflow: hidden;
        }
        .transcript-toolbar {
          display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
          padding: 8px 12px;
          border-bottom: 1px solid var(--border);
          flex-shrink: 0;
          background: var(--surface);
        }
        .transcript-stats { display: flex; gap: 5px; align-items: center; }
        .transcript-toolbar-btns { display: flex; gap: 3px; margin-left: auto; flex-wrap: wrap; }
        .filler-toggle.active { color: var(--warning); }
        .transcript-hint {
          font-size: 10px; color: var(--text-dim);
          padding: 4px 12px; border-bottom: 1px solid var(--border);
          flex-shrink: 0;
        }
        .transcript-body {
          flex: 1; overflow-y: auto; padding: 12px;
          user-select: none;
        }
        .seg-block {
          display: flex; gap: 8px; margin-bottom: 10px;
          align-items: flex-start;
        }
        .seg-time {
          font-size: 10px; color: var(--text-dim);
          font-variant-numeric: tabular-nums;
          min-width: 36px; padding-top: 2px;
          flex-shrink: 0;
        }
        .seg-words { flex: 1; line-height: 1.8; }
        .word {
          display: inline;
          cursor: pointer;
          padding: 1px 0;
          border-radius: 3px;
          transition: background 0.1s, color 0.1s;
          white-space: pre-wrap;
        }
        .word:hover { background: var(--surface3); }
        .word-active { background: var(--accent-muted) !important; color: var(--accent-hover); }
        .word-deleted {
          text-decoration: line-through;
          color: var(--text-dim);
          background: var(--deleted);
          cursor: pointer;
        }
        .word-deleted:hover { background: var(--danger); color: #fff; }
        .word-filler { background: var(--filler); }
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

/**
 * Compute time ranges to keep based on which words are NOT deleted.
 * Merges adjacent kept words into contiguous time segments.
 */
function computeKeptSegments(allWords, deletedIds, totalDuration) {
  if (!allWords.length) return []

  const kept = allWords.filter(w => !deletedIds.has(`${w.segId}-${w.wordIdx}`))
  if (!kept.length) return []

  const ranges = []
  let start = kept[0].start
  let end = kept[0].end
  const GAP = 0.05 // merge words within 50ms

  for (let i = 1; i < kept.length; i++) {
    const w = kept[i]
    if (w.start - end <= GAP) {
      end = Math.max(end, w.end)
    } else {
      ranges.push({ start: Math.max(0, start - 0.05), end: Math.min(totalDuration, end + 0.05) })
      start = w.start
      end = w.end
    }
  }
  ranges.push({ start: Math.max(0, start - 0.05), end: Math.min(totalDuration, end + 0.05) })

  return ranges
}
