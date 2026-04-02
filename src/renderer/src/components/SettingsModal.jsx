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

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">OpenAI API Key <span className="text-gray-600">(for Whisper transcription)</span></label>
            <input
              type="password"
              value={form.openaiKey || ''}
              onChange={(e) => set('openaiKey', e.target.value)}
              placeholder="sk-..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 outline-none focus:border-violet-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Anthropic API Key <span className="text-gray-600">(for AI clip suggestions)</span></label>
            <input
              type="password"
              value={form.anthropicKey || ''}
              onChange={(e) => set('anthropicKey', e.target.value)}
              placeholder="sk-ant-..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 outline-none focus:border-violet-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Whisper Model</label>
            <select
              value={form.whisperModel || 'whisper-1'}
              onChange={(e) => set('whisperModel', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 outline-none focus:border-violet-500 transition-colors"
            >
              <option value="whisper-1">whisper-1 (standard)</option>
            </select>
          </div>

          <p className="text-xs text-gray-600">
            API keys are stored locally on your machine and never sent anywhere except to OpenAI/Anthropic.
          </p>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(form)}
            className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-500 rounded-lg font-medium transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
