// AgentDog Dashboard
const socket = io({ transports: ['websocket'] })

let sessions = []
let currentSessionId = null
let currentEvents = []
let selectedSessionIdx = -1
let selectedEventIdx = -1

// DOM
const sessionList = document.getElementById('session-list')
const eventBody = document.getElementById('event-body')
const eventPanel = document.getElementById('event-panel')
const emptyState = document.getElementById('empty-state')
const connectionStatus = document.getElementById('connection-status')
const btnClear = document.getElementById('btn-clear')

// --- Connection ---
socket.on('connect', () => {
  connectionStatus.textContent = 'connected'
  connectionStatus.className = 'badge badge-sm badge-success text-[10px]'
})
socket.on('disconnect', () => {
  connectionStatus.textContent = 'disconnected'
  connectionStatus.className = 'badge badge-sm badge-error text-[10px]'
})

// --- Sessions ---
socket.on('sessions:list', (list) => {
  sessions = list
  renderSessionList()
  // Auto-select latest session on initial load
  if (!currentSessionId && sessions.length > 0) {
    selectedSessionIdx = 0
    selectSession(sessions[0].id)
  }
})

socket.on('session:update', (session) => {
  if (!session) return
  const isNew = !sessions.find(s => s.id === session.id)
  const idx = sessions.findIndex(s => s.id === session.id)
  if (idx >= 0) sessions[idx] = session
  else sessions.unshift(session)
  renderSessionList()
  // Auto-select new sessions as they arrive
  if (isNew) {
    selectedSessionIdx = 0
    selectSession(session.id)
  }
})

socket.on('sessions:cleared', () => {
  sessions = []
  currentSessionId = null
  currentEvents = []
  selectedSessionIdx = -1
  selectedEventIdx = -1
  renderSessionList()
  showEmptyState()
})

// --- Events ---
socket.on('session:events', ({ sessionId, events }) => {
  if (sessionId !== currentSessionId) return
  currentEvents = events
  renderEvents()
})

socket.on('event', (event) => {
  if (event.sessionId !== currentSessionId) return
  currentEvents.push(event)
  appendEventRow(event, currentEvents.length - 1)
  autoScroll()
})

// --- Clear ---
btnClear.addEventListener('click', async () => {
  if (!confirm('Clear all sessions and events?')) return
  await fetch('/api/sessions', { method: 'DELETE' })
})

// --- Keyboard navigation ---
document.addEventListener('keydown', (e) => {
  // Session list navigation
  if (document.activeElement === sessionList || sessionList.contains(document.activeElement)) {
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault()
      navigateSession(1)
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault()
      navigateSession(-1)
    } else if (e.key === 'Enter' || e.key === 'ArrowRight' || e.key === 'l') {
      e.preventDefault()
      if (selectedSessionIdx >= 0 && selectedSessionIdx < sessions.length) {
        selectSession(sessions[selectedSessionIdx].id)
        // Focus event panel
        eventPanel.focus()
        selectedEventIdx = 0
        highlightEvent()
      }
    }
    return
  }

  // Event panel navigation
  if (document.activeElement === eventPanel || eventPanel.contains(document.activeElement)) {
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault()
      navigateEvent(1)
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault()
      navigateEvent(-1)
    } else if (e.key === 'ArrowLeft' || e.key === 'h' || e.key === 'Escape') {
      e.preventDefault()
      sessionList.focus()
      highlightSession()
    }
    return
  }

  // Global: focus session list
  if (e.key === 'ArrowDown' || e.key === 'j' || e.key === 'ArrowUp' || e.key === 'k') {
    e.preventDefault()
    sessionList.focus()
    if (selectedSessionIdx < 0) selectedSessionIdx = 0
    highlightSession()
  }
})

function navigateSession(delta) {
  const newIdx = Math.max(0, Math.min(sessions.length - 1, selectedSessionIdx + delta))
  if (newIdx !== selectedSessionIdx) {
    selectedSessionIdx = newIdx
    selectSession(sessions[selectedSessionIdx].id)
    highlightSession()
  }
}

function navigateEvent(delta) {
  const newIdx = Math.max(0, Math.min(currentEvents.length - 1, selectedEventIdx + delta))
  if (newIdx !== selectedEventIdx) {
    selectedEventIdx = newIdx
    highlightEvent()
  }
}

function highlightSession() {
  sessionList.querySelectorAll('.session-item').forEach((el, i) => {
    el.classList.toggle('active', i === selectedSessionIdx)
    if (i === selectedSessionIdx) el.scrollIntoView({ block: 'nearest' })
  })
}

function highlightEvent() {
  eventBody.querySelectorAll('.event-row').forEach((el, i) => {
    el.classList.toggle('selected', i === selectedEventIdx)
    if (i === selectedEventIdx) el.scrollIntoView({ block: 'nearest' })
  })
}

// --- Render sessions ---
function renderSessionList() {
  if (sessions.length === 0) {
    sessionList.innerHTML = '<div class="p-4 text-center opacity-40 text-xs">No sessions yet</div>'
    return
  }

  sessionList.innerHTML = sessions.map((s, i) => {
    const isActive = s.id === currentSessionId
    const src = s.source === 'claude-code' ? 'C' : 'X'
    const srcClass = s.source === 'claude-code' ? 'badge-primary' : 'badge-secondary'
    const status = s.status === 'active' ? '<span class="loading loading-dots loading-xs"></span>'
      : s.status === 'error' ? '<span class="text-error text-[10px]">err</span>'
      : '<span class="opacity-40 text-[10px]">done</span>'
    const shortId = s.id.length > 14 ? s.id.slice(0, 14) + '..' : s.id
    const time = new Date(s.startTime).toLocaleTimeString()
    const dur = s.lastEventTime - s.startTime
    const durStr = dur > 60000 ? Math.floor(dur / 60000) + 'm' : Math.floor(dur / 1000) + 's'

    return `<div class="session-item px-3 py-1.5 border-b border-base-200 flex items-center gap-2 ${isActive ? 'active' : ''}" data-idx="${i}" data-sid="${s.id}" tabindex="0">
      <span class="badge ${srcClass} badge-xs font-bold">${src}</span>
      <div class="flex-1 min-w-0">
        <div class="text-xs truncate">${shortId}</div>
        <div class="text-[10px] opacity-40">${time} · ${durStr}</div>
      </div>
      <div class="text-right">
        <div class="text-xs font-bold">${s.eventCount}</div>
        <div>${status}</div>
      </div>
    </div>`
  }).join('')

  sessionList.querySelectorAll('.session-item').forEach(el => {
    el.addEventListener('click', () => {
      selectedSessionIdx = parseInt(el.dataset.idx)
      selectSession(el.dataset.sid)
    })
  })
}

function selectSession(sessionId) {
  if (currentSessionId) socket.emit('unsubscribe', currentSessionId)
  currentSessionId = sessionId
  currentEvents = []
  selectedEventIdx = -1
  eventBody.innerHTML = ''
  emptyState.classList.add('hidden')
  eventPanel.classList.remove('hidden')
  socket.emit('subscribe', sessionId)
  renderSessionList()
}

function showEmptyState() {
  emptyState.classList.remove('hidden')
  eventPanel.classList.add('hidden')
  eventBody.innerHTML = ''
}

// --- Render events ---
function renderEvents() {
  eventBody.innerHTML = ''
  currentEvents.forEach((e, i) => appendEventRow(e, i))
  autoScroll()
}

function appendEventRow(event, idx) {
  const tr = document.createElement('tr')
  tr.className = 'event-row border-b border-base-200 hover:bg-base-200 transition-colors'
  tr.tabIndex = 0
  tr.dataset.idx = idx

  const color = {
    session: 'text-info', message: 'text-success', tool: 'text-warning',
    error: 'text-error', system: 'opacity-40',
  }[event.category] || ''

  const dotColor = {
    session: 'bg-info', message: 'bg-success', tool: 'bg-warning',
    error: 'bg-error', system: 'bg-base-content/20',
  }[event.category] || 'bg-base-content/20'

  const time = new Date(event.timestamp).toLocaleTimeString()
  const label = formatLabel(event)
  const preview = formatPreview(event)

  tr.innerHTML = `
    <td class="pl-3 pr-1 py-1 align-top w-0">
      <div class="w-2 h-2 rounded-full ${dotColor} mt-1.5"></div>
    </td>
    <td class="pr-2 py-1 align-top w-0 whitespace-nowrap">
      <span class="text-[10px] opacity-40">${time}</span>
    </td>
    <td class="py-1 pr-3">
      <div class="flex items-baseline gap-1.5">
        <span class="${color} text-xs font-semibold whitespace-nowrap">${label}</span>
      </div>
      ${preview ? `<pre class="event-detail text-[10px] opacity-60 mt-0.5 whitespace-pre-wrap break-all leading-tight">${preview}</pre>` : ''}
    </td>
  `

  eventBody.appendChild(tr)
}

function formatLabel(e) {
  switch (e.type) {
    case 'session.start': return 'session.start'
    case 'session.end': return 'session.end'
    case 'message.user': return 'message.user'
    case 'message.assistant': return 'message.assistant'
    case 'tool.start': return `tool.start [${e.toolName || '?'}]`
    case 'tool.end': return `tool.end [${e.toolName || '?'}]`
    case 'turn.start': return 'turn.start'
    case 'error': return 'error'
    default: return e.type
  }
}

function formatPreview(e) {
  const parts = []
  if (e.text) parts.push(esc(truncate(e.text, 200)))
  if (e.toolInput) parts.push(esc(truncate(stringify(e.toolInput), 200)))
  if (e.toolOutput) parts.push(esc(truncate(stringify(e.toolOutput), 200)))
  if (e.error) parts.push(esc(truncate(e.error, 200)))
  return parts.join('\n')
}

function stringify(v) {
  if (typeof v === 'string') return v
  try { return JSON.stringify(v, null, 2) } catch { return String(v) }
}

function truncate(s, n) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n) + '...' : s
}

function esc(s) {
  if (!s) return ''
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function autoScroll() {
  eventPanel.scrollTop = eventPanel.scrollHeight
}
