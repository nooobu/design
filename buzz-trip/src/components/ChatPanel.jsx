import { useState, useRef, useEffect } from 'react'
import { useChat } from '../hooks/useChat.jsx'
import { useTripState } from '../hooks/useTripState.jsx'
import './ChatPanel.css'

export default function ChatPanel() {
  const { messages, isStreaming, toolStatus, send, clearChat } = useChat()
  const { tripPlan, selectStop } = useTripState()
  const [input, setInput] = useState('')
  const [isComposing, setIsComposing] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [voiceEnabled, setVoiceEnabled] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const recognitionRef = useRef(null)
  const prevMsgCountRef = useRef(0)

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, toolStatus])

  // TTS: speak new AI messages when voice is enabled
  useEffect(() => {
    if (!voiceEnabled) return
    if (isStreaming) return // wait until streaming finishes

    const lastMsg = messages[messages.length - 1]
    if (messages.length > prevMsgCountRef.current && lastMsg?.role === 'assistant') {
      speakText(lastMsg.content)
    }
    prevMsgCountRef.current = messages.length
  }, [messages, isStreaming, voiceEnabled])

  const toggleVoiceMode = () => {
    const next = !voiceEnabled
    setVoiceEnabled(next)
    // Stop any current speech when disabling
    if (!next) {
      window.speechSynthesis?.cancel()
      setIsSpeaking(false)
    }
  }

  function speakText(text) {
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()

    // Clean markdown/emoji for cleaner speech
    const clean = text
      .replace(/#{1,3}\s*/g, '')
      .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
      .replace(/\|[^\n]+\|/g, '')
      .replace(/---+/g, '')
      .replace(/[🚐⚡🗺️✅🛣️📍🏠🏁🏪😊🎉⛺]/g, '')
      .replace(/\n{2,}/g, '。')
      .trim()

    if (!clean) return

    const utterance = new SpeechSynthesisUtterance(clean)
    utterance.lang = 'ja-JP'
    utterance.rate = 1.1
    utterance.pitch = 1.0

    // Try to pick a Japanese voice
    const voices = window.speechSynthesis.getVoices()
    const jaVoice = voices.find(v => v.lang.startsWith('ja')) || voices.find(v => v.lang.includes('JP'))
    if (jaVoice) utterance.voice = jaVoice

    utterance.onstart = () => setIsSpeaking(true)
    utterance.onend = () => setIsSpeaking(false)
    utterance.onerror = () => setIsSpeaking(false)

    window.speechSynthesis.speak(utterance)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!input.trim() || isStreaming) return
    send(input.trim())
    setInput('')
  }

  // IME: don't send on Enter while composing Japanese
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  // Voice input via Web Speech API
  const toggleVoice = () => {
    if (isListening) {
      recognitionRef.current?.stop()
      setIsListening(false)
      return
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert('このブラウザは音声入力に対応していません。Chromeをお使いください。')
      return
    }

    const recognition = new SpeechRecognition()
    recognition.lang = 'ja-JP'
    recognition.interimResults = true
    recognition.continuous = false
    recognitionRef.current = recognition

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((r) => r[0].transcript)
        .join('')
      setInput(transcript)

      // Auto-send when speech ends (final result)
      if (event.results[event.results.length - 1].isFinal) {
        setIsListening(false)
        if (transcript.trim()) {
          send(transcript.trim())
          setInput('')
        }
      }
    }

    recognition.onerror = () => setIsListening(false)
    recognition.onend = () => setIsListening(false)

    recognition.start()
    setIsListening(true)
  }

  return (
    <aside className="chat-panel">
      <div className="chat-header">
        <div className="chat-logo">
          <span className="chat-logo-icon">⚡</span>
          <div>
            <div className="chat-logo-title">Buzz Trip</div>
            <div className="chat-logo-sub">AI Trip Planner</div>
          </div>
        </div>
        <div className="chat-header-actions">
          <button
            className={`chat-voice-toggle ${voiceEnabled ? 'active' : ''} ${isSpeaking ? 'speaking' : ''}`}
            onClick={toggleVoiceMode}
            title={voiceEnabled ? 'サイレントモード' : '音声モード'}
          >
            {voiceEnabled ? '🔊' : '🔇'}
          </button>
          <button className="chat-clear" onClick={clearChat} title="New chat">
            ✕
          </button>
        </div>
      </div>

      <div className="chat-messages">
        {messages.map((msg, i) => (
          <ChatMessage key={i} msg={msg} />
        ))}

        {toolStatus && (
          <div className="chat-tool-status">
            <span className="tool-spinner" />
            {toolStatus}
          </div>
        )}

        {/* Inline trip summary card */}
        {tripPlan && messages.length > 1 && !isStreaming && (
          <div className="trip-summary-card">
            <div className="trip-card-header">🗺️ Trip Plan</div>
            <div className="trip-card-stats">
              <div className="trip-card-stat">
                <span className="stat-value">{Math.round(tripPlan.distanceKm)} km</span>
                <span className="stat-label">距離</span>
              </div>
              <div className="trip-card-stat">
                <span className="stat-value">{Math.floor(tripPlan.durationMin / 60)}h {Math.round(tripPlan.durationMin % 60)}m</span>
                <span className="stat-label">時間</span>
              </div>
              <div className="trip-card-stat">
                <span className="stat-value">{tripPlan.stops.filter(s => s.type === 'charge').length}</span>
                <span className="stat-label">充電</span>
              </div>
              <div className="trip-card-stat">
                <span className="stat-value">{tripPlan.batteryAtDest}%</span>
                <span className="stat-label">到着時</span>
              </div>
            </div>
            <div className="trip-card-stops">
              {tripPlan.stops.map((stop, i) => (
                <div
                  key={i}
                  className={`trip-card-stop ${stop.type}`}
                  onClick={() => selectStop(i)}
                >
                  <span className="stop-dot">{stopIcon(stop)}</span>
                  <span className="stop-label">{stopName(stop)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input-form" onSubmit={handleSubmit}>
        <button
          type="button"
          className={`chat-mic ${isListening ? 'listening' : ''}`}
          onClick={toggleVoice}
          disabled={isStreaming}
          title="音声入力"
        >
          {isListening ? '⏹' : '🎤'}
        </button>
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          placeholder={isListening ? '話してください...' : '話しかけるか、テキストを入力...'}
          rows={1}
          disabled={isStreaming || isListening}
        />
        <button
          type="submit"
          className="chat-send"
          disabled={isStreaming || !input.trim()}
        >
          ↑
        </button>
      </form>
    </aside>
  )
}

function ChatMessage({ msg }) {
  if (msg.role === 'user') {
    return (
      <div className="chat-msg chat-msg-user">
        <div className="msg-bubble msg-user">{msg.content}</div>
      </div>
    )
  }
  if (msg.role === 'error') {
    return (
      <div className="chat-msg chat-msg-error">
        <div className="msg-bubble msg-error">{msg.content}</div>
      </div>
    )
  }
  return (
    <div className="chat-msg chat-msg-ai">
      <div className="msg-avatar">🚐</div>
      <div className="msg-bubble msg-ai">{msg.content}</div>
    </div>
  )
}

function stopIcon(stop) {
  switch (stop.type) {
    case 'start': return '🏠'
    case 'end': return '🏁'
    case 'charge': return '⚡'
    case 'road_station': return stop.station?.subtype === 'michinoeki' ? '🏪' : '🛣️'
    default: return '📍'
  }
}

function stopName(stop) {
  switch (stop.type) {
    case 'start': return stop.name?.split(',')[0] || 'Start'
    case 'end': return stop.name?.split(',')[0] || 'Destination'
    case 'charge': return stop.charger?.name || 'Charging Stop'
    case 'road_station': return stop.station?.name || 'Rest Area'
    default: return 'Stop'
  }
}
