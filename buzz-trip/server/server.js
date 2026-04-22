import 'dotenv/config'
import express from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { SYSTEM_PROMPT } from './system-prompt.js'
import { TOOLS } from './tools/definitions.js'
import { executeTool } from './tools/execute.js'

const app = express()
app.use(express.json())

const client = new Anthropic()

// In-memory session store (prototype only)
const sessions = new Map()
const SESSION_TTL = 30 * 60 * 1000 // 30 min

function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, { messages: [], createdAt: Date.now() })
  }
  return sessions.get(id)
}

// Cleanup old sessions periodically
setInterval(() => {
  const now = Date.now()
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL) sessions.delete(id)
  }
}, 60_000)

// SSE chat endpoint
app.post('/api/chat', async (req, res) => {
  const { message, sessionId = 'default' } = req.body
  if (!message) return res.status(400).json({ error: 'message required' })

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  const session = getSession(sessionId)
  session.messages.push({ role: 'user', content: message })

  try {
    // Tool execution loop — Claude may call tools multiple times
    let messages = [...session.messages]
    let maxIterations = 5

    while (maxIterations-- > 0) {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      })

      // Process content blocks
      let hasToolUse = false
      let textContent = ''
      const toolResults = []

      for (const block of response.content) {
        if (block.type === 'text') {
          textContent += block.text
          send('token', { text: block.text })
        } else if (block.type === 'tool_use') {
          hasToolUse = true
          send('tool_start', { tool: block.name, label: getToolLabel(block.name) })

          try {
            const result = await executeTool(block.name, block.input, (progress) => {
              send('progress', { text: progress })
            })

            // If it's a trip plan, send the full plan to the frontend
            if (block.name === 'plan_complete_trip' && result.tripPlan) {
              send('trip_plan', { plan: result.tripPlan })
            }

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result.summary || result),
            })

            send('tool_done', { tool: block.name })
          } catch (err) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify({ error: err.message }),
              is_error: true,
            })
            send('tool_error', { tool: block.name, error: err.message })
          }
        }
      }

      if (!hasToolUse) {
        // Final text response — save to session and finish
        session.messages.push({ role: 'assistant', content: textContent })
        send('done', {})
        break
      }

      // Continue the loop: add assistant response + tool results
      messages = [
        ...messages,
        { role: 'assistant', content: response.content },
        { role: 'user', content: toolResults },
      ]
    }
  } catch (err) {
    console.error('Chat error:', err)
    send('error', { message: err.message || 'Internal error' })
  }

  res.end()
})

function getToolLabel(name) {
  const labels = {
    plan_complete_trip: 'トリップを計画中...',
    find_rest_stops: '道の駅・SAを検索中...',
    find_ev_chargers: '充電スポットを検索中...',
  }
  return labels[name] || `${name} 実行中...`
}

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`Buzz Trip server running on http://localhost:${PORT}`)
})
