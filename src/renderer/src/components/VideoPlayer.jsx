import React, { useRef, useEffect, useState } from 'react'

function fmt(ms) {
  if (!isFinite(ms) || ms == null) return '0:00'
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export default function VideoPlayer({ mediaUrl, durationMs, currentTimeMs, onTimeUpdate, seekTrigger }) {
  const videoRef = useRef(null)
  const trackRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [localMs, setLocalMs] = useState(0)
  const [dur, setDur] = useState(durationMs || 0)
  const [dragging, setDragging] = useState(false)
  const [vol, setVol] = useState(1)

  // seekTrigger → seek the video
  useEffect(() => {
    if (!seekTrigger || !videoRef.current) return
    videoRef.current.currentTime = seekTrigger.ms / 1000
    videoRef.current.play().catch(() => {})
  }, [seekTrigger])

  // Wire up video events
  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    const onTU = () => {
      const ms = Math.round(el.currentTime * 1000)
      setLocalMs(ms)
      onTimeUpdate(ms)
    }
    const onLoaded = () => setDur(Math.round(el.duration * 1000))
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    el.addEventListener('timeupdate', onTU)
    el.addEventListener('loadedmetadata', onLoaded)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    return () => {
      el.removeEventListener('timeupdate', onTU)
      el.removeEventListener('loadedmetadata', onLoaded)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
    }
  }, [onTimeUpdate])

  function togglePlay() {
    const el = videoRef.current
    if (!el) return
    if (playing) el.pause()
    else el.play().catch(() => {})
  }

  function seekFromX(clientX) {
    const el = videoRef.current
    const track = trackRef.current
    if (!el || !track || !dur) return
    const rect = track.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    el.currentTime = (pct * dur) / 1000
    setLocalMs(pct * dur)
  }

  useEffect(() => {
    if (!dragging) return
    const onMove = (e) => seekFromX(e.clientX)
    const onUp = () => setDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [dragging, dur])

  const pct = dur > 0 ? (localMs / dur) * 100 : 0

  return (
    <div className="flex flex-col flex-1 bg-black min-h-0">
      {/* Video */}
      <div className="flex-1 flex items-center justify-center min-h-0 cursor-pointer" onClick={togglePlay}>
        {mediaUrl ? (
          <video
            ref={videoRef}
            src={mediaUrl}
            className="max-w-full max-h-full object-contain"
            style={{ display: 'block' }}
          />
        ) : (
          <div className="text-gray-600 text-sm">No file loaded</div>
        )}
      </div>

      {/* Controls */}
      <div className="flex-shrink-0 bg-gray-900 border-t border-gray-800 px-3 py-2 space-y-1.5">
        {/* Seekbar */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 tabular-nums w-9">{fmt(localMs)}</span>
          <div
            ref={trackRef}
            className="flex-1 h-4 flex items-center cursor-pointer group"
            onMouseDown={(e) => { setDragging(true); seekFromX(e.clientX) }}
          >
            <div className="relative w-full h-1 bg-gray-700 rounded group-hover:h-1.5 transition-all">
              <div className="absolute left-0 top-0 h-full bg-violet-500 rounded" style={{ width: `${pct}%` }} />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ left: `${pct}%` }}
              />
            </div>
          </div>
          <span className="text-xs text-gray-500 tabular-nums w-9 text-right">{fmt(dur)}</span>
        </div>

        {/* Buttons */}
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => { if (videoRef.current) videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 5) }}
            className="text-gray-400 hover:text-white transition-colors text-xs"
            title="Back 5s"
          >
            ⟨5
          </button>
          <button
            onClick={togglePlay}
            className="w-8 h-8 flex items-center justify-center bg-violet-600 hover:bg-violet-500 rounded-full transition-colors"
          >
            {playing ? (
              <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
              </svg>
            ) : (
              <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24">
                <polygon points="5,3 19,12 5,21"/>
              </svg>
            )}
          </button>
          <button
            onClick={() => { if (videoRef.current) videoRef.current.currentTime = Math.min(videoRef.current.duration || 0, videoRef.current.currentTime + 5) }}
            className="text-gray-400 hover:text-white transition-colors text-xs"
            title="Forward 5s"
          >
            5⟩
          </button>
          <input
            type="range" min={0} max={1} step={0.05} value={vol}
            onChange={(e) => { const v = +e.target.value; setVol(v); if (videoRef.current) videoRef.current.volume = v }}
            className="w-16 accent-violet-500"
            title="Volume"
          />
        </div>
      </div>
    </div>
  )
}
