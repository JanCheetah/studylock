import { useState } from 'react'
import { hasApiKey, setApiKey, clearApiKey, getUsageStats, resetUsageStats, type AIUsageStats } from '../lib/openrouter'

export function AISettingsPanel() {
  const [keyInput, setKeyInput] = useState('')
  const [isConfigured, setIsConfigured] = useState(hasApiKey())
  const [showKey, setShowKey] = useState(false)
  const [usage, setUsage] = useState<AIUsageStats>(getUsageStats())

  const handleSaveKey = () => {
    if (keyInput.trim()) {
      setApiKey(keyInput.trim())
      setIsConfigured(true)
      setKeyInput('')
    }
  }

  const handleRemoveKey = () => {
    clearApiKey()
    setIsConfigured(false)
    setKeyInput('')
  }

  const handleResetUsage = () => {
    resetUsageStats()
    setUsage(getUsageStats())
  }

  const refreshUsage = () => setUsage(getUsageStats())

  return (
    <div className="ai-settings-card">
      <div className="ai-settings-header">
        <span className={`ai-status-dot ${isConfigured ? 'active' : ''}`} />
        <strong>AI Engine</strong>
        <small>{isConfigured ? 'Aktiv' : 'Nicht konfiguriert'}</small>
      </div>

      {!isConfigured ? (
        <div className="ai-key-form">
          <input
            type={showKey ? 'text' : 'password'}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="OpenRouter API Key"
            onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
          />
          <div className="ai-key-actions">
            <button className="mini" onClick={handleSaveKey} disabled={!keyInput.trim()}>
              Key speichern
            </button>
            <button className="secondary mini" onClick={() => setShowKey(!showKey)}>
              {showKey ? 'Verbergen' : 'Zeigen'}
            </button>
          </div>
        </div>
      ) : (
        <div className="ai-info">
          <div className="ai-model-badge">
            <span>openrouter/optimus-alpha</span>
          </div>
          <div className="ai-usage" onClick={refreshUsage}>
            <span>{usage.totalCalls} Calls</span>
            <span>≈{Math.round((usage.totalPromptTokens + usage.totalCompletionTokens) / 1000)}k Tokens</span>
          </div>
          <div className="ai-key-actions">
            <button className="secondary mini danger" onClick={handleRemoveKey}>
              Key entfernen
            </button>
            <button className="secondary mini" onClick={handleResetUsage}>
              Zähler zurücksetzen
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default AISettingsPanel
