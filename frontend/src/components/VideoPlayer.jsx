import React, { useRef, useEffect, useState, useCallback } from 'react'

function formatTime(s) {
  if (!isFinite(s) || s == null) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

/**
 * VideoPlayer
 * Props:
 *   mediaUrl        — src for the media element
 *   currentTime     — seek-to value from parent (transcript clicks)
 *   onTimeUpdate    — callback(t) on every timeupdate
 *   duration        — initial duration hint
 *   isAudio         — render audio UI
 *   clipRange       — {start, end, label} — highlight range, auto-play, auto-stop
 *   onClipEnd       — called when clip finishes playing (to clear preview state)
 */
export default function VideoPlayer({
  mediaUrl, currentTime, onTimeUpdate, duration, isAudio,
  clipRange, onClipEnd, transcript, subtitleConfig,
}) {
  const mediaRef = useRef(null)
  const seekTrackRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [vol, setVol] = useState(1)
  const [localTime, setLocalTime] = useState(0)
  const [localDuration, setLocalDuration] = useState(duration || 0)
  const [dragging, setDragging] = useState(false)
  const clipRangeRef = useRef(clipRange)
  clipRangeRef.current = clipRange

  // ── Transcript word click → seek (skipped when preview is active) ───────────
  useEffect(() => {
    const el = mediaRef.current
    if (!el || dragging || clipRangeRef.current) return
    if (Math.abs(el.currentTime - currentTime) > 0.3) {
      el.currentTime = currentTime
    }
  }, [currentTime])

  // ── Preview clip: seek to start and play; null → pause ────────────────────
  useEffect(() => {
    const el = mediaRef.current
    if (!el) return
    if (!clipRange) {
      el.pause()
      return
    }

    function doSeekAndPlay() {
      el.currentTime = clipRange.start
      // Wait for the seek to complete before playing
      el.onseeked = () => {
        el.onseeked = null
        el.play().catch(() => {})
      }
      // Fallback: if onseeked never fires (already at position), play anyway
      setTimeout(() => {
        if (el.paused && clipRangeRef.current) el.play().catch(() => {})
      }, 300)
    }

    // If media metadata isn't loaded yet, wait for it
    if (el.readyState < 1) {
      el.addEventListener('loadedmetadata', doSeekAndPlay, { once: true })
    } else {
      doSeekAndPlay()
    }
  }, [clipRange])

  // ── Event listeners ────────────────────────────────────────────────────────
  useEffect(() => {
    const el = mediaRef.current
    if (!el) return

    function onTU() {
      const t = el.currentTime
      setLocalTime(t)
      onTimeUpdate(t)
      // Auto-stop at clip end
      const cr = clipRangeRef.current
      if (cr && t >= cr.end) {
        el.pause()
        el.currentTime = cr.end
        onClipEnd?.()
      }
    }
    function onPlay()   { setPlaying(true)  }
    function onPause()  { setPlaying(false) }
    function onLoaded() { setLocalDuration(el.duration) }

    el.addEventListener('timeupdate', onTU)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('loadedmetadata', onLoaded)
    return () => {
      el.removeEventListener('timeupdate', onTU)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('loadedmetadata', onLoaded)
    }
  }, [onTimeUpdate, onClipEnd])

  function togglePlay() {
    const el = mediaRef.current
    if (!el) return
    if (playing) {
      el.pause()
    } else {
      // If a clip range is set and we're past the end, restart at beginning
      if (clipRangeRef.current && el.currentTime >= clipRangeRef.current.end) {
        el.currentTime = clipRangeRef.current.start
      }
      el.play().catch(() => {})
    }
  }

  // ── Custom seekbar ─────────────────────────────────────────────────────────
  function seekFromX(clientX) {
    const el = mediaRef.current
    const track = seekTrackRef.current
    if (!el || !track || !localDuration) return
    const rect = track.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const t = pct * localDuration
    el.currentTime = t
    setLocalTime(t)
  }

  function onTrackMouseDown(e) {
    setDragging(true)
    seekFromX(e.clientX)
  }

  useEffect(() => {
    if (!dragging) return
    function onMove(e) { seekFromX(e.clientX) }
    function onUp()   { setDragging(false) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, localDuration])

  function onVolChange(e) {
    const v = parseFloat(e.target.value)
    setVol(v)
    if (mediaRef.current) mediaRef.current.volume = v
  }

  function skip(delta) {
    const el = mediaRef.current
    if (!el) return
    el.currentTime = Math.max(0, Math.min(localDuration, el.currentTime + delta))
  }

  // ── Caption overlay ────────────────────────────────────────────────────────
  function getCaptionText() {
    if (!transcript || !subtitleConfig?.enabled) return null
    const t = localTime
    if (subtitleConfig.style === 'word') {
      for (const seg of transcript.segments || []) {
        for (const w of seg.words || []) {
          if (t >= w.start && t <= w.end + 0.05) {
            const word = w.word.trim()
            return subtitleConfig.all_caps ? word.toUpperCase() : word
          }
        }
      }
    } else {
      for (const seg of transcript.segments || []) {
        if (t >= seg.start && t <= seg.end + 0.1) {
          const text = seg.text.trim()
          return subtitleConfig.all_caps ? text.toUpperCase() : text
        }
      }
    }
    return null
  }
  const captionText = getCaptionText()

  const dur = localDuration || 1
  const timePct  = (localTime / dur) * 100
  const clipLeft  = clipRange ? (clipRange.start / dur) * 100 : 0
  const clipWidth = clipRange ? ((clipRange.end - clipRange.start) / dur) * 100 : 0

  return (
    <div className="video-player">
      {isAudio ? (
        <div className="audio-placeholder">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3">
            <path d="M9 18V5l12-2v13"/>
            <circle cx="6" cy="18" r="3"/>
            <circle cx="18" cy="16" r="3"/>
          </svg>
          <audio ref={mediaRef} src={mediaUrl} />
        </div>
      ) : (
        <div className="video-wrap" onClick={togglePlay}>
          <video ref={mediaRef} src={mediaUrl} className="video-el" />
          {captionText && subtitleConfig && (
            <div
              className={`caption-overlay caption-pos-${subtitleConfig.position || 'bottom'}`}
              style={{
                fontSize: `${subtitleConfig.font_size || 72}px`,
                fontFamily: `${subtitleConfig.font_name || 'Impact'}, 'Arial Black', sans-serif`,
                WebkitTextStroke: `${subtitleConfig.outline_size || 2.5}px #000`,
                paintOrder: 'stroke fill',
              }}
            >
              {captionText}
            </div>
          )}
        </div>
      )}

      {/* Clip preview banner */}
      {clipRange && (
        <div className="clip-preview-banner">
          <span className="clip-preview-dot" />
          Previewing: {clipRange.label || `${formatTime(clipRange.start)} – ${formatTime(clipRange.end)}`}
          <span style={{marginLeft:'auto', fontSize:10, opacity:0.7}}>
            {formatTime(clipRange.end - clipRange.start)}
          </span>
        </div>
      )}

      {/* Controls */}
      <div className="player-controls">
        {/* Custom seekbar */}
        <div className="seek-row">
          <span className="time-label">{formatTime(localTime)}</span>
          <div
            className="seek-track"
            ref={seekTrackRef}
            onMouseDown={onTrackMouseDown}
          >
            <div className="seek-bg" />
            {clipRange && (
              <div className="seek-clip-range" style={{ left: `${clipLeft}%`, width: `${clipWidth}%` }} />
            )}
            <div className="seek-played" style={{ width: `${timePct}%` }} />
            <div className="seek-thumb" style={{ left: `${timePct}%` }} />
          </div>
          <span className="time-label" style={{textAlign:'right'}}>{formatTime(localDuration)}</span>
        </div>

        <div className="ctrl-row">
          <button className="btn-ghost ctrl-btn" onClick={() => skip(-5)} title="Back 5s">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.65"/>
            </svg>
            <span style={{fontSize:10}}>5</span>
          </button>

          <button className="btn-primary ctrl-btn play-btn" onClick={togglePlay} title={playing ? 'Pause' : 'Play'}>
            {playing ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5,3 19,12 5,21"/>
              </svg>
            )}
          </button>

          <button className="btn-ghost ctrl-btn" onClick={() => skip(5)} title="Forward 5s">
            <span style={{fontSize:10}}>5</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.49-3.65"/>
            </svg>
          </button>

          <div className="vol-ctrl">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{opacity:0.5,flexShrink:0}}>
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              {vol > 0 && <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>}
            </svg>
            <input type="range" min={0} max={1} step={0.05} value={vol} onChange={onVolChange} style={{width:60}} />
          </div>
        </div>
      </div>

      <style>{`
        .video-player { display: flex; flex-direction: column; flex: 1; background: #000; min-height: 0; }
        .video-wrap { flex: 1; min-height: 0; position: relative; display: flex; cursor: pointer; background: #000; }
        .video-el { flex: 1; min-height: 0; width: 100%; object-fit: contain; background: #000; display: block; }
        .audio-placeholder { flex: 1; display: flex; align-items: center; justify-content: center; background: var(--surface2); }
        .caption-overlay {
          position: absolute; left: 50%; transform: translateX(-50%);
          color: #fff; font-weight: 900; text-align: center;
          pointer-events: none; white-space: pre-wrap; max-width: 85%;
          line-height: 1.1; letter-spacing: 0.02em;
          text-shadow: none;
        }
        .caption-pos-bottom { bottom: 8%; }
        .caption-pos-top    { top: 6%; }
        .caption-pos-middle { top: 50%; transform: translate(-50%, -50%); }

        .clip-preview-banner {
          display: flex; align-items: center; gap: 7px;
          background: var(--accent-muted); border-top: 1px solid var(--accent);
          padding: 5px 14px; font-size: 11px; color: var(--accent-hover);
          font-weight: 500; flex-shrink: 0;
        }
        .clip-preview-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: var(--accent); flex-shrink: 0;
          animation: pulse 1.2s ease-in-out infinite;
        }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }

        .player-controls { background: var(--surface); border-top: 1px solid var(--border); padding: 8px 14px; display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }

        /* Custom seekbar */
        .seek-row { display: flex; align-items: center; gap: 8px; }
        .seek-track {
          flex: 1; height: 20px; position: relative;
          display: flex; align-items: center; cursor: pointer;
        }
        .seek-bg {
          position: absolute; inset: 50% 0; transform: translateY(-50%);
          height: 4px; background: var(--surface3); border-radius: 99px;
        }
        .seek-clip-range {
          position: absolute; top: 50%; transform: translateY(-50%);
          height: 4px; background: var(--accent); opacity: 0.35;
          border-radius: 99px; pointer-events: none;
        }
        .seek-played {
          position: absolute; top: 50%; transform: translateY(-50%);
          height: 4px; background: var(--text-muted);
          border-radius: 99px; pointer-events: none; max-width: 100%;
        }
        .seek-thumb {
          position: absolute; top: 50%; transform: translate(-50%, -50%);
          width: 12px; height: 12px; border-radius: 50%;
          background: #fff; pointer-events: none;
          box-shadow: 0 1px 4px rgba(0,0,0,0.5);
          transition: transform 0.1s;
        }
        .seek-track:hover .seek-thumb { transform: translate(-50%, -50%) scale(1.3); }

        .time-label { font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums; min-width: 36px; }
        .ctrl-row { display: flex; align-items: center; justify-content: center; gap: 8px; }
        .ctrl-btn { display: flex; align-items: center; gap: 3px; padding: 6px 10px; }
        .play-btn { padding: 7px 16px; border-radius: 99px; }
        .vol-ctrl { display: flex; align-items: center; gap: 6px; margin-left: auto; }
      `}</style>
    </div>
  )
}
