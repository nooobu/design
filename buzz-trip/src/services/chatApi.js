// SSE client for the chat API

export function sendMessage(message, sessionId, callbacks) {
  const { onToken, onToolStart, onProgress, onTripPlan, onToolDone, onDone, onError } = callbacks

  return fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sessionId }),
  }).then((res) => {
    if (!res.ok) throw new Error(`Server error: ${res.status}`)
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    function processBuffer() {
      const lines = buffer.split('\n')
      buffer = lines.pop() || '' // keep incomplete line

      let eventType = null
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7)
        } else if (line.startsWith('data: ') && eventType) {
          try {
            const data = JSON.parse(line.slice(6))
            switch (eventType) {
              case 'token': onToken?.(data.text); break
              case 'tool_start': onToolStart?.(data); break
              case 'progress': onProgress?.(data.text); break
              case 'trip_plan': onTripPlan?.(data.plan); break
              case 'tool_done': onToolDone?.(data); break
              case 'done': onDone?.(); break
              case 'error': onError?.(data.message); break
            }
          } catch { /* skip malformed data */ }
          eventType = null
        }
      }
    }

    function pump() {
      return reader.read().then(({ done, value }) => {
        if (done) {
          processBuffer()
          onDone?.()
          return
        }
        buffer += decoder.decode(value, { stream: true })
        processBuffer()
        return pump()
      })
    }

    return pump()
  }).catch((err) => {
    onError?.(err.message)
  })
}
