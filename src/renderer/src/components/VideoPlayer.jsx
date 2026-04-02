import React, { useRef, useEffect, useState } from 'react'

function fmt(ms) {
  if (!isFinite(ms) || ms == null) return '0:00'
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export default function VideoPlayer({
  mediaUrl, durationMs, onTimeUpdate, seekTrigger,
  transcript, captionStyle,
}) {
  const videoRef = useRef(null)
  const trackRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [localMs, setLocalMs] = useState(0)
  const [dur, setDur] = useState(durationMs || 0)
  const [dragging, setDragging] = useState(false)
  const [vol, setVol] = useState(1)

  // ── Robust seek: wait for seeked event, then play ──────────────────────────
  useEffect(() => {
    if (!seekTrigger || !videoRef.current) return
    const el = videoRef.current
    const targetSec = seekTrigger.ms / 1000

    el.pause()

    const doPlay = () => {
      el.removeEventListener('seeked', doPlay)
      clearTimeout(fallback)
      el.play().catch(() => {})
    }
    const fallback = setTimeout(doPlay, 600)

    el.addEventListener('seeked', doPlay, { once: true })
    el.currentTime = targetSec
  }, [seekTrigger])

  // ── Video event listeners ──────────────────────────────────────────────────
  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    const onTU = () => {
      const ms = Math.round(el.currentTime * 1000)
      setLocalMs(ms)
      onTimeUpdate(ms)
    }
    const onLoaded = () => setDur(Math.round(el.duration * 1000))
    const onPlay  = () => setPlaying(true)
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

  // ── Seekbar drag ───────────────────────────────────────────────────────────
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
    const onUp   = () => setDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, dur])

  // ── Caption text ───────────────────────────────────────────────────────────
  function getCaptionText() {
    if (!captionStyle?.enabled || !transcript?.length) return null
    const t = localMs / 1000

    if (captionStyle.mode === 'word') {
      for (const w of transcript) {
        if (t >= w.startMs / 1000 && t <= w.endMs / 1000 + 0.05) {
          return captionStyle.allCaps ? w.word.trim().toUpperCase() : w.word.trim()
        }
      }
    } else {
      // sentence mode — find the segment covering this time
      // group words into rough sentences by gaps > 0.8s
      let sentStart = 0
      for (let i = 0; i < transcript.length; i++) {
        const isLast = i === transcript.length - 1
        const nextGap = isLast ? Infinity : (transcript[i + 1].startMs - transcript[i].endMs)
        if (nextGap > 800 || isLast) {
          const sentEnd = transcript[i].endMs / 1000 + 0.1
          if (t >= sentStart && t <= sentEnd) {
            const text = transcript.slice(
              transcript.findIndex(w => w.startMs / 1000 >= sentStart),
              i + 1
            ).map(w => w.word).join('').trim()
            return captionStyle.allCaps ? text.toUpperCase() : text
          }
          sentStart = transcript[i + 1]?.startMs / 1000 ?? sentEnd
        }
      }
    }
    return null
  }

  const captionText = getCaptionText()
  const pct = dur > 0 ? (localMs / dur) * 100 : 0

  const posClass = {
    bottom: 'bottom-[8%]',
    top:    'top-[6%]',
    middle: 'top-1/2 -translate-y-1/2',
  }[captionStyle?.position || 'bottom'] || 'bottom-[8%]'

  return (
    <div className="flex flex-col flex-1 bg-black min-h-0">
      {/* Video */}
      <div className="flex-1 relative flex items-center justify-center min-h-0 cursor-pointer" onClick={togglePlay}>
        {mediaUrl ? (
          <video ref={videoRef} src={mediaUrl} className="max-w-full max-h-full object-contain block" />
        ) : (
          <div className="text-gray-600 text-sm">No file loaded</div>
        )}

        {/* Live caption overlay */}
        {captionText && (
          <div
            className={`absolute left-1/2 -translate-x-1/2 ${posClass} pointer-events-none text-center max-w-[85%] leading-tight`}
            style={{
              fontFamily: `${captionStyle.font || 'Impact'}, 'Arial Black', sans-serif`,
              fontSize: `${(captionStyle.size || 72) * 0.5}px`, // scale down for preview
              color: captionStyle.color || '#ffffff',
              WebkitTextStroke: `${captionStyle.outlineSize || 2}px ${captionStyle.outlineColor || '#000000'}`,
              paintOrder: 'stroke fill',
              fontWeight: 900,
            }}
          >
            {captionText}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex-shrink-0 bg-gray-900 border-t border-gray-800 px-3 py-2 space-y-1.5">
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

        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => { if (videoRef.current) videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 5) }}
            className="text-gray-400 hover:text-white transition-colors text-xs"
          >⟨5</button>
          <button
            onClick={togglePlay}
            className="w-8 h-8 flex items-center justify-center bg-violet-600 hover:bg-violet-500 rounded-full transition-colors"
          >
            {playing ? (
              <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            ) : (
              <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>
            )}
          </button>
          <button
            onClick={() => { if (videoRef.current) videoRef.current.currentTime = Math.min(videoRef.current.duration || 0, videoRef.current.currentTime + 5) }}
            className="text-gray-400 hover:text-white transition-colors text-xs"
          >5⟩</button>
          <input
            type="range" min={0} max={1} step={0.05} value={vol}
            onChange={(e) => { const v = +e.target.value; setVol(v); if (videoRef.current) videoRef.current.volume = v }}
            className="w-16 accent-violet-500"
          />
        </div>
      </div>
    </div>
  )
}
