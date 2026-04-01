import React, { useRef, useEffect, useState, useCallback } from 'react'

function formatTime(s) {
  if (!isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export default function VideoPlayer({ mediaUrl, currentTime, onTimeUpdate, duration, isAudio }) {
  const mediaRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [vol, setVol] = useState(1)
  const [localTime, setLocalTime] = useState(0)
  const [localDuration, setLocalDuration] = useState(duration || 0)
  const seekingRef = useRef(false)

  // Seek when parent changes currentTime (transcript click)
  useEffect(() => {
    const el = mediaRef.current
    if (!el || seekingRef.current) return
    if (Math.abs(el.currentTime - currentTime) > 0.3) {
      el.currentTime = currentTime
    }
  }, [currentTime])

  useEffect(() => {
    const el = mediaRef.current
    if (!el) return

    function onTU() {
      setLocalTime(el.currentTime)
      onTimeUpdate(el.currentTime)
    }
    function onPlay() { setPlaying(true) }
    function onPause() { setPlaying(false) }
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
  }, [onTimeUpdate])

  function togglePlay() {
    const el = mediaRef.current
    if (!el) return
    playing ? el.pause() : el.play()
  }

  function onVolChange(e) {
    const v = parseFloat(e.target.value)
    setVol(v)
    if (mediaRef.current) mediaRef.current.volume = v
  }

  function onSeek(e) {
    const v = parseFloat(e.target.value)
    setLocalTime(v)
    if (mediaRef.current) mediaRef.current.currentTime = v
  }

  function skip(delta) {
    const el = mediaRef.current
    if (!el) return
    el.currentTime = Math.max(0, Math.min(localDuration, el.currentTime + delta))
  }

  const pct = localDuration > 0 ? (localTime / localDuration) * 100 : 0

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
        <video
          ref={mediaRef}
          src={mediaUrl}
          className="video-el"
          onClick={togglePlay}
        />
      )}

      {/* Controls */}
      <div className="player-controls">
        <div className="seek-row">
          <span className="time-label">{formatTime(localTime)}</span>
          <input
            type="range"
            className="seek-slider"
            min={0}
            max={localDuration || 0}
            step={0.05}
            value={localTime}
            onChange={onSeek}
            onMouseDown={() => { seekingRef.current = true }}
            onMouseUp={() => { seekingRef.current = false }}
          />
          <span className="time-label">{formatTime(localDuration)}</span>
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
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{opacity:0.5}}>
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              {vol > 0 && <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>}
            </svg>
            <input type="range" min={0} max={1} step={0.05} value={vol} onChange={onVolChange} style={{width:64}} />
          </div>
        </div>
      </div>

      <style>{`
        .video-player {
          display: flex; flex-direction: column;
          flex: 1; background: #000; min-height: 0;
        }
        .video-el {
          flex: 1; min-height: 0; width: 100%; object-fit: contain;
          cursor: pointer; background: #000;
        }
        .audio-placeholder {
          flex: 1; display: flex; align-items: center; justify-content: center;
          background: var(--surface2);
        }
        .player-controls {
          background: var(--surface); border-top: 1px solid var(--border);
          padding: 8px 14px; display: flex; flex-direction: column; gap: 6px;
          flex-shrink: 0;
        }
        .seek-row { display: flex; align-items: center; gap: 8px; }
        .seek-slider { flex: 1; cursor: pointer; }
        .time-label { font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums; min-width: 36px; }
        .ctrl-row { display: flex; align-items: center; justify-content: center; gap: 8px; }
        .ctrl-btn { display: flex; align-items: center; gap: 3px; padding: 6px 10px; }
        .play-btn { padding: 7px 16px; border-radius: 99px; }
        .vol-ctrl { display: flex; align-items: center; gap: 6px; margin-left: auto; }
      `}</style>
    </div>
  )
}
