import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import VideoPlayer from './components/VideoPlayer'
import TranscriptEditor from './components/TranscriptEditor'
import ClipsPanel from './components/ClipsPanel'
import SettingsModal from './components/SettingsModal'

const FILLER_WORDS = new Set([
  'um', 'uh', 'like', 'basically', 'literally', 'honestly',
  'actually', 'right', 'okay', 'so', 'well', 'you know',
  'i mean', 'sort of', 'kind of',
])

function computeKeptSegments(transcript, deletedIds) {
  if (!transcript.length) return []
  const kept = transcript.filter((w) => !deletedIds.has(w.id))
  if (!kept.length) return []
  const GAP = 150 // ms — merge words within this gap
  const segs = []
  let start = kept[0].startMs
  let end = kept[0].endMs
  for (let i = 1; i < kept.length; i++) {
    const w = kept[i]
    if (w.startMs - end <= GAP) {
      end = Math.max(end, w.endMs)
    } else {
      segs.push({ startMs: start, endMs: end })
      start = w.startMs
      end = w.endMs
    }
  }
  segs.push({ startMs: start, endMs: end })
  return segs
}

export default function App() {
  const [sourceFile, setSourceFile] = useState(null)
  const [transcript, setTranscript] = useState([])
  const [deletedIds, setDeletedIds] = useState(new Set())
  const [undoStack, setUndoStack] = useState([])
  const [redoStack, setRedoStack] = useState([])
  const [clips, setClips] = useState([])
  const [aiSuggestions, setAiSuggestions] = useState([])
  const [currentTimeMs, setCurrentTimeMs] = useState(0)
  const [seekTrigger, setSeekTrigger] = useState(null)
  const [settings, setSettings] = useState({ anthropicKey: '', whisperModel: 'base' })
  const [status, setStatus] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [error, setError] = useState(null)

  const keptSegments = useMemo(
    () => computeKeptSegments(transcript, deletedIds),
    [transcript, deletedIds]
  )

  // Load settings on mount
  useEffect(() => {
    window.klippy.settings.get().then((s) => {
      if (s) setSettings(s)
    })
  }, [])

  // Listen to progress events from main process
  useEffect(() => {
    return window.klippy.on('progress', ({ type, progress }) => {
      setStatus({ type, progress })
      if (progress >= 1) setTimeout(() => setStatus((s) => (s?.type === type ? null : s)), 1200)
    })
  }, [])

  // Listen to menu triggers from main process
  useEffect(() => {
    const u1 = window.klippy.on('menu:import', handleImport)
    const u2 = window.klippy.on('menu:settings', () => setShowSettings(true))
    const u3 = window.klippy.on('menu:exportEdit', handleExportEdit)
    const u4 = window.klippy.on('menu:removeFillers', handleRemoveFillers)
    const u5 = window.klippy.on('menu:restoreAll', handleRestoreAll)
    return () => { u1(); u2(); u3(); u4(); u5() }
  }, [sourceFile, keptSegments, transcript, deletedIds]) // eslint-disable-line

  async function handleImport() {
    try {
      const filePath = await window.klippy.openFile()
      if (!filePath) return
      setError(null)
      setTranscript([])
      setDeletedIds(new Set())
      setClips([])
      setAiSuggestions([])
      setUndoStack([])
      setRedoStack([])
      const info = await window.klippy.getFileInfo(filePath)
      setSourceFile({ path: filePath, ...info })
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleTranscribe() {
    if (!sourceFile) return
    setError(null)
    try {
      const words = await window.klippy.transcribe(sourceFile.audioPath, {
        model: settings.whisperModel || 'base',
      })
      setTranscript(
        words.map((w) => ({
          ...w,
          isFiller: FILLER_WORDS.has(w.word.trim().toLowerCase()),
        }))
      )
      setDeletedIds(new Set())
      setUndoStack([])
      setRedoStack([])
    } catch (e) {
      setError(e.message)
    }
  }

  // ── Editing ────────────────────────────────────────────────────────────────
  function pushUndo(prev) {
    setUndoStack((s) => [...s.slice(-49), prev])
    setRedoStack([])
  }

  const applyDelete = useCallback((ids) => {
    setDeletedIds((prev) => {
      pushUndo(new Set(prev))
      const next = new Set(prev)
      ids.forEach((id) => next.add(id))
      return next
    })
  }, [])

  const applyRestore = useCallback((ids) => {
    setDeletedIds((prev) => {
      pushUndo(new Set(prev))
      const next = new Set(prev)
      ids.forEach((id) => next.delete(id))
      return next
    })
  }, [])

  function handleRemoveFillers() {
    const ids = transcript.filter((w) => w.isFiller).map((w) => w.id)
    if (ids.length) applyDelete(ids)
  }

  function handleRestoreAll() {
    if (!deletedIds.size) return
    pushUndo(new Set(deletedIds))
    setDeletedIds(new Set())
    setRedoStack([])
  }

  function undo() {
    setUndoStack((stack) => {
      if (!stack.length) return stack
      const prev = stack[stack.length - 1]
      setRedoStack((r) => [...r, new Set(deletedIds)])
      setDeletedIds(prev)
      return stack.slice(0, -1)
    })
  }

  function redo() {
    setRedoStack((stack) => {
      if (!stack.length) return stack
      const next = stack[stack.length - 1]
      setUndoStack((u) => [...u, new Set(deletedIds)])
      setDeletedIds(next)
      return stack.slice(0, -1)
    })
  }

  // Global undo/redo keyboard shortcut
  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [deletedIds, undoStack, redoStack]) // eslint-disable-line

  // ── Clips ──────────────────────────────────────────────────────────────────
  const handleMakeClip = useCallback((startIdx, endIdx) => {
    const words = transcript.slice(startIdx, endIdx + 1).filter((w) => !deletedIds.has(w.id))
    if (!words.length) return
    const title = words.slice(0, 6).map((w) => w.word.trim()).join(' ')
    setClips((c) => [
      ...c,
      {
        id: Date.now(),
        title,
        startMs: transcript[startIdx].startMs,
        endMs: transcript[endIdx].endMs,
      },
    ])
  }, [transcript, deletedIds])

  const handleAcceptSuggestion = useCallback((suggestion) => {
    setClips((c) => [
      ...c,
      {
        id: Date.now(),
        title: suggestion.title,
        startMs: suggestion.startMs,
        endMs: suggestion.endMs,
      },
    ])
    setAiSuggestions((s) => s.filter((x) => x !== suggestion))
  }, [])

  const handleSeek = useCallback((ms) => {
    setSeekTrigger({ ms, ts: Date.now() })
  }, [])

  // ── AI ─────────────────────────────────────────────────────────────────────
  async function handleFindClips() {
    if (!transcript.length) return
    if (!settings.anthropicKey) { setShowSettings(true); return }
    setError(null)
    setStatus({ type: 'findingClips', progress: 0.5 })
    try {
      const suggestions = await window.klippy.findClipsAI(transcript, {
        apiKey: settings.anthropicKey,
        platform: 'general',
      })
      setAiSuggestions(suggestions)
    } catch (e) {
      setError(e.message)
    } finally {
      setStatus(null)
    }
  }

  // ── Export ─────────────────────────────────────────────────────────────────
  async function handleExportEdit() {
    if (!sourceFile || !keptSegments.length) return
    setError(null)
    try {
      await window.klippy.exportEdit({ inputPath: sourceFile.path, segments: keptSegments })
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleExportClip(clip) {
    if (!sourceFile) return
    setError(null)
    try {
      await window.klippy.exportClip({
        inputPath: sourceFile.path,
        startMs: clip.startMs,
        endMs: clip.endMs,
        title: clip.title,
      })
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleSaveSettings(newSettings) {
    setSettings(newSettings)
    await window.klippy.settings.set(newSettings)
    setShowSettings(false)
  }

  // ── Status label ───────────────────────────────────────────────────────────
  const statusLabel = status
    ? status.type === 'extracting' ? 'Extracting audio…'
    : status.type === 'transcribing' ? 'Transcribing…'
    : status.type === 'exporting' ? 'Exporting…'
    : status.type === 'exportingClip' ? 'Exporting clip…'
    : status.type === 'findingClips' ? 'Finding clips…'
    : 'Working…'
    : null

  const isWorking = !!status
  const hasTranscript = transcript.length > 0
  const deletedCount = deletedIds.size

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100 overflow-hidden">
      {/* Topbar */}
      <header className="flex items-center gap-3 px-4 h-11 bg-gray-900 border-b border-gray-800 flex-shrink-0 drag-region">
        <span className="font-bold tracking-wider text-violet-400 text-sm no-drag">KLIPPY</span>

        {statusLabel && (
          <div className="flex items-center gap-2 text-xs text-gray-400 no-drag">
            <span className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
            {statusLabel}
            {status.progress > 0 && status.progress < 1 && (
              <span className="text-gray-500">
                {Math.round(status.progress * 100)}%
              </span>
            )}
          </div>
        )}

        {error && (
          <div className="relative no-drag">
            <button
              className="flex items-center gap-2 text-xs text-red-400 bg-red-950/40 border border-red-900/50 rounded px-2 py-1 max-w-xs hover:max-w-2xl transition-all"
              title={error}
              onClick={() => {
                navigator.clipboard?.writeText(error)
                alert('Error copied to clipboard:\n\n' + error)
              }}
            >
              <span>⚠</span>
              <span className="truncate">{error.split('\n')[0]}</span>
              <span className="text-red-600 flex-shrink-0">click for details</span>
            </button>
            <button onClick={() => setError(null)} className="absolute -top-1 -right-1 w-4 h-4 text-gray-600 hover:text-gray-300 text-xs bg-gray-900 rounded-full flex items-center justify-center">✕</button>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2 no-drag">
          {hasTranscript && deletedCount > 0 && (
            <span className="text-xs text-gray-500">{deletedCount} cut</span>
          )}

          {!sourceFile ? (
            <button
              onClick={handleImport}
              className="px-3 py-1 text-xs bg-violet-600 hover:bg-violet-500 rounded font-medium transition-colors"
            >
              Import File
            </button>
          ) : !hasTranscript ? (
            <button
              onClick={handleTranscribe}
              disabled={isWorking}
              className="px-3 py-1 text-xs bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded font-medium transition-colors"
            >
              ⚡ Transcribe
            </button>
          ) : (
            <>
              <button
                onClick={handleFindClips}
                disabled={isWorking}
                className="px-3 py-1 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-50 rounded font-medium transition-colors"
              >
                ✨ Find Clips
              </button>
              <button
                onClick={handleRemoveFillers}
                disabled={isWorking}
                className="px-3 py-1 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-50 rounded font-medium transition-colors"
              >
                Remove Fillers
              </button>
              {undoStack.length > 0 && (
                <button onClick={undo} className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 rounded transition-colors" title="Undo (⌘Z)">↩</button>
              )}
              {redoStack.length > 0 && (
                <button onClick={redo} className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 rounded transition-colors" title="Redo (⌘⇧Z)">↪</button>
              )}
              {deletedCount > 0 && (
                <button onClick={handleRestoreAll} className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 rounded transition-colors">Restore all</button>
              )}
              <button
                onClick={handleExportEdit}
                disabled={isWorking || !keptSegments.length}
                className="px-3 py-1 text-xs bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded font-medium transition-colors"
              >
                ⬇ Export Edit
              </button>
              <button
                onClick={handleImport}
                className="px-2 py-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                New file
              </button>
            </>
          )}

          <button
            onClick={() => setShowSettings(true)}
            className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
            title="Settings"
          >
            ⚙
          </button>
        </div>
      </header>

      {/* Main workspace */}
      {!sourceFile ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-5xl mb-4 opacity-20">◈</div>
            <h2 className="text-xl font-semibold text-gray-300 mb-2">Drop a video or audio file</h2>
            <p className="text-sm text-gray-500 mb-6">MP4, MOV, MKV, MP3, WAV, M4A supported</p>
            <button
              onClick={handleImport}
              className="px-6 py-2.5 bg-violet-600 hover:bg-violet-500 rounded-lg font-medium transition-colors"
            >
              Import File
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0">
          {/* Left: Video Player */}
          <div className="flex flex-col w-80 flex-shrink-0 border-r border-gray-800">
            <VideoPlayer
              mediaUrl={sourceFile.mediaUrl}
              durationMs={sourceFile.durationMs}
              currentTimeMs={currentTimeMs}
              onTimeUpdate={setCurrentTimeMs}
              seekTrigger={seekTrigger}
            />
          </div>

          {/* Center: Transcript */}
          <div className="flex flex-col flex-1 min-w-0 border-r border-gray-800">
            <div className="px-3 py-2 border-b border-gray-800 text-xs text-gray-500 flex-shrink-0">
              Transcript
              {hasTranscript && (
                <span className="ml-2 text-gray-600">
                  {transcript.length - deletedCount} / {transcript.length} words
                </span>
              )}
            </div>
            <TranscriptEditor
              transcript={transcript}
              deletedIds={deletedIds}
              currentTimeMs={currentTimeMs}
              onSeek={handleSeek}
              onDelete={applyDelete}
              onRestore={applyRestore}
              onMakeClip={handleMakeClip}
              isWorking={isWorking}
              onTranscribe={handleTranscribe}
            />
          </div>

          {/* Right: Clips */}
          <div className="flex flex-col w-72 flex-shrink-0">
            <ClipsPanel
              clips={clips}
              aiSuggestions={aiSuggestions}
              onSeek={handleSeek}
              onExportClip={handleExportClip}
              onAcceptSuggestion={handleAcceptSuggestion}
              onDeleteClip={(id) => setClips((c) => c.filter((x) => x.id !== id))}
              onRenameClip={(id, title) => setClips((c) => c.map((x) => x.id === id ? { ...x, title } : x))}
              onFindClips={handleFindClips}
              hasTranscript={hasTranscript}
              isWorking={isWorking}
            />
          </div>
        </div>
      )}

      {showSettings && (
        <SettingsModal
          settings={settings}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}
