import { useState, useCallback, useRef } from 'react'
import { sendMessage } from '../services/chatApi.js'
import { useTripState } from './useTripState.jsx'

export function useChat() {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: 'こんにちは！ Buzz Trip へようこそ 🚐⚡\n\nID. Buzzでのロードトリップを一緒に計画しましょう。\nどこへ行きたいですか？',
    },
  ])
  const [isStreaming, setIsStreaming] = useState(false)
  const [toolStatus, setToolStatus] = useState(null)
  const sessionId = useRef(`session-${Date.now()}`)
  const { setTripPlan } = useTripState()

  const send = useCallback(
    async (text) => {
      if (!text.trim() || isStreaming) return

      // Add user message
      setMessages((prev) => [...prev, { role: 'user', content: text }])
      setIsStreaming(true)
      setToolStatus(null)

      // Accumulate assistant response
      let assistantText = ''
      const assistantIdx = { current: -1 }

      await sendMessage(text, sessionId.current, {
        onToken(chunk) {
          assistantText += chunk
          setMessages((prev) => {
            const msgs = [...prev]
            if (assistantIdx.current === -1) {
              assistantIdx.current = msgs.length
              msgs.push({ role: 'assistant', content: assistantText })
            } else {
              msgs[assistantIdx.current] = { role: 'assistant', content: assistantText }
            }
            return msgs
          })
        },

        onToolStart({ label }) {
          setToolStatus(label)
        },

        onProgress(text) {
          setToolStatus(text)
        },

        onTripPlan(plan) {
          setTripPlan(plan)
          setToolStatus(null)
        },

        onToolDone() {
          setToolStatus(null)
        },

        onDone() {
          setIsStreaming(false)
          setToolStatus(null)
        },

        onError(msg) {
          setMessages((prev) => [
            ...prev,
            { role: 'error', content: msg || 'エラーが発生しました。もう一度お試しください。' },
          ])
          setIsStreaming(false)
          setToolStatus(null)
        },
      })
    },
    [isStreaming, setTripPlan]
  )

  const clearChat = useCallback(() => {
    setMessages([
      {
        role: 'assistant',
        content: 'こんにちは！ Buzz Trip へようこそ 🚐⚡\n\nID. Buzzでのロードトリップを一緒に計画しましょう。\nどこへ行きたいですか？',
      },
    ])
    setTripPlan(null)
    sessionId.current = `session-${Date.now()}`
  }, [setTripPlan])

  return { messages, isStreaming, toolStatus, send, clearChat }
}
