import React, { useState } from 'react'

export default function SettingsModal({ settings, onSave, onClose }) {
  const [form, setForm] = useState({ ...settings })
  function set(key, val) { setForm((f) => ({ ...f, [key]: val })) }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold">Settings</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg">✕</button>
        </div>

        <div className="space-y-5">
          {/* Whisper model — no API key needed */}
          <div>
            <label className="block text-xs font-medium text-gray-300 mb-1">
              Whisper Model
              <span className="text-gray-500 font-normal ml-1">(runs locally, no API key)</span>
            </label>
            <select
              value={form.whisperModel || 'base'}
              onChange={(e) => set('whisperModel', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 outline-none focus:border-violet-500 transition-colors"
            >
              <option value="tiny">tiny — fastest, less accurate</option>
              <option value="base">base — recommended (default)</option>
              <option value="small">small — more accurate, slower</option>
              <option value="medium">medium — most accurate, slow</option>
            </select>
            <p className="text-xs text-gray-600 mt-1">
              First use downloads the model (~75MB for base). Cached after that.
            </p>
          </div>

          <hr className="border-gray-800" />

          {/* Anthropic key — optional, only for AI clips */}
          <div>
            <label className="block text-xs font-medium text-gray-300 mb-1">
              Anthropic API Key
              <span className="text-gray-500 font-normal ml-1">(optional — for ✨ AI Clip Suggestions only)</span>
            </label>
            <input
              type="password"
              value={form.anthropicKey || ''}
              onChange={(e) => set('anthropicKey', e.target.value)}
              placeholder="sk-ant-..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 outline-none focus:border-violet-500 transition-colors"
            />
            <p className="text-xs text-gray-600 mt-1">
              Get one at console.anthropic.com. Not required to use the app.
            </p>
          </div>

          <hr className="border-gray-800" />

          {/* Custom FFmpeg paths — for users whose system ffmpeg lacks libfreetype/libass */}
          <div>
            <label className="block text-xs font-medium text-gray-300 mb-1">
              Custom FFmpeg path
              <span className="text-gray-500 font-normal ml-1">(optional — only needed for caption export)</span>
            </label>
            <input
              type="text"
              value={form.ffmpegPath || ''}
              onChange={(e) => set('ffmpegPath', e.target.value)}
              placeholder="/usr/local/bin/ffmpeg"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 outline-none focus:border-violet-500 transition-colors font-mono"
            />
            <p className="text-xs text-gray-600 mt-1">
              Point to an ffmpeg binary with libfreetype or libass for caption burn-in. Leave blank to use the default.
            </p>
          </div>

          <p className="text-xs text-gray-600">
            All settings stored locally on your machine.
          </p>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors">Cancel</button>
          <button onClick={() => onSave(form)} className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-500 rounded-lg font-medium transition-colors">Save</button>
        </div>
      </div>
    </div>
  )
}
