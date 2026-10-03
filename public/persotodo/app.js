import {
  CARD_TYPES,
  ENERGIES,
  PLANNING_HOMES,
  PRIORITIES,
  WORKFLOW_CATEGORIES,
  addDays,
  capacityForDate,
  createCard,
  deepClone,
  localDateKey,
  migrateBoard,
  mondayFor,
  moveCard,
  scheduleCard,
  validateBoard
} from '/api/persotodo/board-model.js'

const $ = selector => document.querySelector(selector)
const gate = $('#gate')
const appShell = $('#appShell')
const view = $('#view')
const saveState = $('#saveState')
const conflictBanner = $('#conflictBanner')

const state = {
  board: null,
  revision: null,
  view: 'today',
  selectedDate: localDateKey(),
  monthDate: localDateKey().slice(0, 7),
  search: '',
  priority: '',
  sprint: '',
  undo: [],
  changeVersion: 0,
  savedVersion: 0,
  saveTimer: null,
  saveInFlight: false,
  saveFailed: false,
  conflict: false,
  editingDisabled: false,
  dragCardId: null,
  laneDraft: null
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char])
}

function formatDate(dateKey, options = { weekday: 'short', month: 'short', day: 'numeric' }) {
  if (!dateKey) return 'Unscheduled'
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString(undefined, options)
}

function formatMinutes(minutes) {
  if (minutes === null || minutes === undefined) return 'Unestimated'
  const sign = minutes < 0 ? '−' : ''
  const absolute = Math.abs(minutes)
  const hours = Math.floor(absolute / 60)
  const mins = absolute % 60
  return `${sign}${hours ? `${hours}h` : ''}${hours && mins ? ' ' : ''}${mins ? `${mins}m` : hours ? '' : '0m'}`
}

function laneFor(card) {
  return state.board.lanes.find(lane => lane.id === card.laneId)
}

function isComplete(card) {
  return ['done', 'validated'].includes(laneFor(card)?.category)
}

function visibleCards(cards) {
  const query = state.search.trim().toLowerCase()
  return cards.filter(card => {
    if (state.priority && card.priority !== state.priority) return false
    if (state.sprint && card.sprint !== state.sprint) return false
    if (!query) return true
    return [card.workNumber, card.title, card.project, card.owner, card.description, card.nextAction, card.sprint]
      .some(value => value.toLowerCase().includes(query))
  })
}

function setSaveState(kind, label, retry = false) {
  saveState.className = `save-state ${kind}`
  saveState.replaceChildren()
  const dot = document.createElement('span')
  dot.className = 'save-dot'
  const text = document.createElement('span')
  text.textContent = label
  saveState.append(dot, text)
  if (retry) {
    const button = document.createElement('button')
    button.className = 'mini-button'
    button.type = 'button'
    button.textContent = 'Retry'
    button.addEventListener('click', () => flushSave())
    saveState.append(button)
  }
}

async function api(path, options = {}) {
  const response = await fetch(`/api/persotodo${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json', ...options.headers } : options.headers
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.error || 'Request failed.')
    error.status = response.status
    error.payload = payload
    throw error
  }
  return { payload, response }
}

function uuid() {
  return crypto.randomUUID()
}

async function loadBoard() {
  setSaveState('loading', 'Loading')
  try {
    const { payload, response } = await api('/board')
    const validation = validateBoard(payload.board)
    if (!validation.ok) throw new Error(`The database board is invalid: ${validation.errors[0]}`)
    state.board = payload.board
    state.revision = Number(response.headers.get('etag')?.replaceAll('"', '') || payload.revision)
    state.undo = []
    state.changeVersion = 0
    state.savedVersion = 0
    state.editingDisabled = false
    state.conflict = false
    conflictBanner.hidden = true
    appShell.hidden = false
    gate.hidden = true
    setSaveState('saved', 'Saved to database')
    renderAll()
  } catch (error) {
    state.editingDisabled = true
    appShell.hidden = false
    gate.hidden = true
    setSaveState('failed', 'Load failed')
    view.innerHTML = `<section class="panel loading-block"><h2>Clearspace could not load the database board.</h2><p>${escapeHtml(error.message)}</p><p>Editing is disabled so an empty board cannot replace your work. Check the API and database, then reload this page.</p></section>`
  }
}

function scheduleSave() {
  clearTimeout(state.saveTimer)
  setSaveState('saving', 'Saving')
  state.saveTimer = setTimeout(() => flushSave(), 450)
}

async function saveAttempt(snapshot, revision, requestId) {
  return api('/board', {
    method: 'PUT',
    headers: { 'If-Match': `"${revision}"`, 'X-Request-ID': requestId },
    body: JSON.stringify({ board: snapshot })
  })
}

async function flushSave() {
  clearTimeout(state.saveTimer)
  if (state.saveInFlight || state.conflict || !state.board || state.savedVersion === state.changeVersion) return
  state.saveInFlight = true
  state.saveFailed = false
  const version = state.changeVersion
  const snapshot = deepClone(state.board)
  const baseRevision = state.revision
  const requestId = uuid()
  setSaveState('saving', 'Saving')

  try {
    let result
    try {
      result = await saveAttempt(snapshot, baseRevision, requestId)
    } catch (firstError) {
      if (firstError.status) throw firstError
      result = await saveAttempt(snapshot, baseRevision, requestId)
    }
    state.revision = result.payload.revision
    state.savedVersion = Math.max(state.savedVersion, version)
    setSaveState('saved', 'Saved to database')
  } catch (error) {
    if (error.status === 412) {
      state.conflict = true
      state.editingDisabled = true
      conflictBanner.hidden = false
      setSaveState('conflict', 'Conflict')
    } else {
      state.saveFailed = true
      setSaveState('failed', 'Save failed', true)
    }
  } finally {
    state.saveInFlight = false
    if (!state.saveFailed && !state.conflict && state.savedVersion < state.changeVersion) flushSave()
  }
}

function mutate(label, change) {
  if (state.editingDisabled || !state.board) return
  const previous = deepClone(state.board)
  state.undo.push({ label, board: previous })
  if (state.undo.length > 50) state.undo.shift()
  change(state.board)
  state.board.meta.updatedAt = new Date().toISOString()
  const validation = validateBoard(state.board)
  if (!validation.ok) {
    state.board = previous
    state.undo.pop()
    window.alert(validation.errors[0])
    return
  }
  state.changeVersion += 1
  $('#undoButton').disabled = false
  renderAll()
  scheduleSave()
}

function undo() {
  const action = state.undo.pop()
  if (!action || state.editingDisabled) return
  state.board = action.board
  state.changeVersion += 1
  $('#undoButton').disabled = state.undo.length === 0
  renderAll()
  scheduleSave()
}

function updateSprintFilter() {
  const select = $('#sprintFilter')
  const current = state.sprint
  const sprints = [...new Set(state.board.cards.map(card => card.sprint).filter(Boolean))].sort()
  select.innerHTML = '<option value="">All sprints</option>' + sprints.map(sprint => `<option${sprint === current ? ' selected' : ''}>${escapeHtml(sprint)}</option>`).join('')
}

function renderAll() {
  if (!state.board) return
  updateSprintFilter()
  $('#inboxBadge').textContent = state.board.cards.filter(card => card.planningHome === 'Inbox').length
  document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === state.view))
  renderView()
}

function priorityBadge(card) {
  return `<span class="priority ${card.priority.toLowerCase()}">${escapeHtml(card.priority)}</span>`
}

function cardMarkup(card, { draggable = false, compact = false } = {}) {
  const lane = laneFor(card)
  return `<article class="work-card" data-card-id="${escapeHtml(card.id)}" ${draggable ? 'draggable="true"' : ''}>
    <div class="card-top"><div><span class="work-number">${escapeHtml(card.workNumber)} · ${escapeHtml(card.type)}</span><h3 class="card-title ${isComplete(card) ? 'done' : ''}">${escapeHtml(card.title)}</h3></div>${priorityBadge(card)}</div>
    <div class="card-meta">
      ${card.project ? `<span>${escapeHtml(card.project)}</span>` : ''}
      ${card.owner ? `<span>Owner: ${escapeHtml(card.owner)}</span>` : ''}
      ${card.estimatedMinutes === null ? '<span>Unestimated</span>' : `<span>${formatMinutes(card.estimatedMinutes)}</span>`}
      ${card.deadline ? `<span>Deadline ${formatDate(card.deadline, { month: 'short', day: 'numeric' })}</span>` : ''}
      ${card.sprint ? `<span>Sprint: ${escapeHtml(card.sprint)}</span>` : ''}
      ${compact ? '' : `<span>${escapeHtml(lane?.name ?? 'Missing lane')}</span>`}
    </div>
    ${!compact && card.nextAction ? `<p class="guidance">Next: ${escapeHtml(card.nextAction)}</p>` : ''}
    <div class="card-actions">
      <button class="mini-button" data-action="edit" data-card-id="${escapeHtml(card.id)}">Edit</button>
      <label class="sr-only" for="move-${escapeHtml(card.id)}">Move ${escapeHtml(card.title)}</label>
      <select id="move-${escapeHtml(card.id)}" class="move-select" data-action="move" data-card-id="${escapeHtml(card.id)}">
        <option value="">Move…</option>${state.board.lanes.sort((a,b) => a.order-b.order).map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('')}
      </select>
    </div>
  </article>`
}

function capacityMarkup(dateKey) {
  const capacity = capacityForDate(state.board, dateKey)
  if (capacity.off) return `<div class="capacity-card panel off"><strong>Protected day off</strong><p class="guidance">${escapeHtml(capacity.note || 'No work capacity is offered for planning.')}</p></div>`
  const percentage = capacity.planMinutes ? Math.min(100, capacity.estimatedMinutes / capacity.planMinutes * 100) : 0
  return `<div class="capacity-card panel">
    <div class="capacity-row"><strong>${capacity.overloaded ? 'Overloaded' : 'Remaining capacity'}</strong><span>${formatMinutes(capacity.remainingMinutes)}</span></div>
    <div class="capacity-bar"><div class="capacity-fill ${capacity.overloaded ? 'over' : ''}" style="width:${percentage}%"></div></div>
    <p class="guidance">${formatMinutes(capacity.estimatedMinutes)} planned of ${formatMinutes(capacity.planMinutes)} available · ${formatMinutes(capacity.bufferMinutes)} protected buffer${capacity.unestimatedCount ? ` · ${capacity.unestimatedCount} unestimated, so availability is up to ${formatMinutes(Math.max(0, capacity.remainingMinutes))}` : ''}</p>
  </div>`
}

function viewHeader(title, copy, actions = '') {
  return `<header class="view-header"><div><p class="eyebrow">Clearspace</p><h1 class="view-title">${escapeHtml(title)}</h1><p class="view-copy">${escapeHtml(copy)}</p></div>${actions ? `<div class="header-actions">${actions}</div>` : ''}</header>`
}

function renderView() {
  const renderers = { today: renderToday, inbox: renderInbox, week: renderWeek, month: renderMonth, future: renderFuture, waiting: renderWaiting, kanban: renderKanban }
  renderers[state.view]()
}

function decisionCards(dateKey) {
  return state.board.cards.map(card => {
    const reasons = []
    if (!isComplete(card) && card.scheduledDate && card.scheduledDate < dateKey) reasons.push(`unfinished plan from ${formatDate(card.scheduledDate)}`)
    if (!isComplete(card) && card.deadline && card.deadline <= dateKey) reasons.push(`deadline ${formatDate(card.deadline)}`)
    if (!isComplete(card) && card.followUpDate && card.followUpDate <= dateKey) reasons.push(`follow-up due ${formatDate(card.followUpDate)}`)
    if (!isComplete(card) && laneFor(card)?.category === 'inProgress' && !card.scheduledDate) reasons.push('in progress but unscheduled')
    return { card, reasons }
  }).filter(item => item.reasons.length)
}

function renderToday() {
  const date = state.selectedDate
  const scheduled = visibleCards(state.board.cards.filter(card => card.scheduledDate === date))
  const mainWin = scheduled.find(card => card.mainWin)
  const supporting = scheduled.filter(card => !card.mainWin && !isComplete(card))
  const completed = scheduled.filter(isComplete)
  const decisions = visibleCards(decisionCards(date).map(item => item.card)).map(card => decisionCards(date).find(item => item.card.id === card.id))
  const actions = `<div class="date-nav"><button class="button subtle" data-date-shift="-1" aria-label="Previous day">←</button><strong>${formatDate(date, { weekday: 'short', month: 'short', day: 'numeric' })}</strong><button class="button subtle" data-date-shift="1" aria-label="Next day">→</button></div>`
  view.innerHTML = viewHeader('Today', 'Choose one meaningful win, then only the support work that honestly fits.', actions) + `
    <div class="today-grid">
      <div class="stack">
        <section class="panel"><div class="panel-header"><h2>Main win</h2><button class="mini-button" data-action="new-for-date" data-date="${date}">Add work</button></div><div class="panel-body">${mainWin ? cardMarkup(mainWin) : '<div class="main-win empty">No main win selected. That is a decision, not a failure.</div>'}</div></section>
        <section class="panel"><div class="panel-header"><h2>Supporting priorities</h2><span class="guidance">Aim for two smaller priorities, not a packed day.</span></div><div class="panel-body card-list">${supporting.length ? supporting.map(card => cardMarkup(card)).join('') : '<div class="empty-state">No supporting work scheduled.</div>'}</div></section>
        <section class="panel"><div class="panel-header"><h2>Completed work</h2><span class="guidance">${completed.length} complete</span></div><div class="panel-body card-list">${completed.length ? completed.map(card => cardMarkup(card, { compact: true })).join('') : '<div class="empty-state">Completed work will remain visible here.</div>'}</div></section>
      </div>
      <aside class="stack">
        ${capacityMarkup(date)}
        <section class="panel"><div class="panel-header"><h2>Needs a decision</h2></div><div class="panel-body decision-list">${decisions.length ? decisions.map(({ card, reasons }) => `<div class="decision-item"><button class="mini-button" data-action="edit" data-card-id="${escapeHtml(card.id)}">${escapeHtml(card.workNumber)}</button> ${escapeHtml(card.title)}<span class="decision-reason">${escapeHtml(reasons.join(' · '))}</span></div>`).join('') : '<p class="guidance">No prior plans, deadlines, follow-ups, or unscheduled in-progress work need a decision.</p>'}</div></section>
      </aside>
    </div>`
}

function renderInbox() {
  const cards = visibleCards(state.board.cards.filter(card => card.planningHome === 'Inbox'))
  view.innerHTML = viewHeader('Inbox', 'Capture first. Decide next action, timing, or Someday when you are ready.') + `
    <form id="captureForm" class="capture panel"><label class="sr-only" for="captureTitle">Quick capture</label><input id="captureTitle" maxlength="500" placeholder="Capture a thought or task…" required><select id="captureDestination" aria-label="Capture destination"><option value="Inbox">Inbox</option><option value="Today">Today</option><option value="Someday">Someday</option></select><button class="button primary">Capture</button></form>
    <section class="panel"><div class="panel-header"><h2>Unprocessed</h2><span class="guidance">${cards.length} items</span></div><div class="panel-body card-list">${cards.length ? cards.map(card => cardMarkup(card)).join('') : '<div class="empty-state">Inbox clear. Nothing is being hidden or rolled forward.</div>'}</div></section>`
}

function renderWeek() {
  const monday = mondayFor(state.selectedDate)
  const days = Array.from({ length: 7 }, (_, index) => addDays(monday, index))
  const weekLabel = `${formatDate(monday, { month: 'short', day: 'numeric' })} – ${formatDate(days[6], { month: 'short', day: 'numeric' })}`
  const outcome = state.board.outcomes.weekly[monday] ?? ''
  const columns = days.map(date => {
    const cards = visibleCards(state.board.cards.filter(card => card.scheduledDate === date)).sort((a,b) => a.order-b.order)
    const capacity = capacityForDate(state.board, date)
    return `<section class="day-column ${capacity.off ? 'off' : ''} ${capacity.overloaded ? 'overloaded' : ''}"><div class="day-head"><strong>${formatDate(date, { weekday: 'short', day: 'numeric' })}</strong><span>${capacity.off ? 'Day off' : `${formatMinutes(capacity.remainingMinutes)} left${capacity.unestimatedCount ? ` · ${capacity.unestimatedCount} unknown` : ''}`}</span></div><div class="day-drop" data-week-date="${date}">${cards.map(card => cardMarkup(card, { draggable: true, compact: true })).join('')}</div></section>`
  }).join('')
  const ready = visibleCards(state.board.cards.filter(card => card.planningHome === 'Next' && !card.scheduledDate && !isComplete(card)))
  const actions = `<button class="button subtle" data-week-shift="-7">←</button><strong>${weekLabel}</strong><button class="button subtle" data-week-shift="7">→</button>`
  view.innerHTML = viewHeader('This week', 'Schedule against actual capacity. Moving a card changes only its plan date—not its deadline or workflow status.', actions) + `
    <label class="outcome-input">Weekly outcome<input id="weeklyOutcome" value="${escapeHtml(outcome)}" maxlength="500" placeholder="What would make this week meaningful?"></label>
    <div class="week-board">${columns}</div>
    <section class="panel ready-strip"><div class="panel-header"><h2>Ready to plan</h2><span class="guidance">Unscheduled Next work</span></div><div class="panel-body horizontal-cards">${ready.length ? ready.map(card => cardMarkup(card, { draggable: true, compact: true })).join('') : '<div class="empty-state">No ready unscheduled work.</div>'}</div></section>`
}

function renderMonth() {
  const [year, month] = state.monthDate.split('-').map(Number)
  const first = `${state.monthDate}-01`
  const firstDate = new Date(`${first}T12:00:00`)
  const start = addDays(first, -firstDate.getDay())
  const days = Array.from({ length: 42 }, (_, index) => addDays(start, index))
  const outcome = state.board.outcomes.monthly[state.monthDate] ?? ''
  const cells = days.map(date => {
    const capacity = capacityForDate(state.board, date)
    const cards = state.board.cards.filter(card => card.scheduledDate === date)
    const deadlines = state.board.cards.filter(card => card.deadline === date)
    return `<button class="month-day ${date.slice(0,7) === state.monthDate ? '' : 'outside'} ${capacity.off ? 'off' : ''} ${capacity.overloaded ? 'overloaded' : ''}" data-open-date="${date}"><span class="month-date">${Number(date.slice(-2))}</span><span class="month-stats"><span>${capacity.off ? 'Protected off' : `${cards.length} planned · ${formatMinutes(Math.max(0, capacity.remainingMinutes))} open`}</span>${capacity.unestimatedCount ? `<span>${capacity.unestimatedCount} unestimated</span>` : ''}${deadlines.length ? `<span class="deadline-dot">${deadlines.length} deadline${deadlines.length === 1 ? '' : 's'}</span>` : ''}${capacity.note ? `<span>${escapeHtml(capacity.note)}</span>` : ''}</span></button>`
  }).join('')
  const actions = `<button class="button subtle" data-month-shift="-1">←</button><strong>${new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong><button class="button subtle" data-month-shift="1">→</button>`
  view.innerHTML = viewHeader('Month', 'See planned work, true deadlines, protected time off, and overload without treating days off as empty space.', actions) + `
    <label class="outcome-input">Monthly outcome<input id="monthlyOutcome" value="${escapeHtml(outcome)}" maxlength="500" placeholder="What matters most this month?"></label>
    <div class="month-grid">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day => `<div class="month-weekday">${day}</div>`).join('')}${cells}</div>`
}

function renderFuture() {
  const today = localDateKey()
  const ready = visibleCards(state.board.cards.filter(card => card.planningHome === 'Next' && !card.scheduledDate && !isComplete(card)))
  const future = visibleCards(state.board.cards.filter(card => card.scheduledDate && card.scheduledDate > today && card.planningHome !== 'Someday'))
  const someday = visibleCards(state.board.cards.filter(card => card.planningHome === 'Someday'))
  view.innerHTML = viewHeader('Future / Someday', 'Separate ready work, real future commitments, and ideas that do not need invented deadlines.') + `<div class="section-grid">
    ${columnMarkup('Ready to plan', ready, 'Unscheduled Next work')}
    ${columnMarkup('Future commitments', future, 'Work with an entered schedule')}
    ${columnMarkup('Someday', someday, 'Ideas without overdue pressure')}
  </div>`
}

function columnMarkup(title, cards, subtitle) {
  return `<section class="panel section-column"><div class="panel-header"><div><h2>${escapeHtml(title)}</h2><span class="guidance">${escapeHtml(subtitle)}</span></div></div><div class="panel-body">${cards.length ? cards.map(card => cardMarkup(card, { compact: true })).join('') : '<div class="empty-state">Nothing here.</div>'}</div></section>`
}

function renderWaiting() {
  const today = localDateKey()
  const waiting = visibleCards(state.board.cards.filter(card => card.waitingOn || laneFor(card)?.category === 'blockers'))
  const due = waiting.filter(card => card.followUpDate && card.followUpDate <= today)
  const future = waiting.filter(card => card.followUpDate && card.followUpDate > today)
  const missing = waiting.filter(card => !card.followUpDate)
  const group = (title, cards, note) => `<section class="waiting-group panel"><div class="panel-header"><div><h2>${title}</h2><span class="guidance">${note}</span></div></div><div class="panel-body card-list">${cards.length ? cards.map(card => `${cardMarkup(card)}${card.timingNote ? `<p class="guidance">Timing note: ${escapeHtml(card.timingNote)}. This is a note, not a timed notification.</p>` : ''}`).join('') : '<div class="empty-state">Nothing in this group.</div>'}</div></section>`
  view.innerHTML = viewHeader('Waiting', 'Name the dependency and the next unblock action. Follow-up dates are planning cues; Clearspace does not send timed notifications.') + group('Follow up now', due, 'Due today or earlier') + group('Future follow-ups', future, 'Already given a deliberate date') + group('Missing follow-up date', missing, 'Needs a decision about when to check again')
}

function renderKanban() {
  const cards = visibleCards(state.board.cards)
  const lanes = [...state.board.lanes].sort((a,b) => a.order-b.order)
  const markup = lanes.map(lane => {
    const laneCards = cards.filter(card => card.laneId === lane.id).sort((a,b) => a.order-b.order)
    const totalInLane = state.board.cards.filter(card => card.laneId === lane.id).length
    const warning = lane.wipLimit !== null && totalInLane > lane.wipLimit
    return `<section class="lane ${warning ? 'wip-warning' : ''}" style="--lane-color:${escapeHtml(lane.color)}"><div class="lane-header"><span class="lane-title">${escapeHtml(lane.name)}</span><span class="lane-count">${totalInLane}${lane.wipLimit ? ` / ${lane.wipLimit}` : ''}</span></div>${warning ? '<div class="wip-text">WIP limit exceeded—finish or renegotiate before adding more.</div>' : ''}<div class="lane-body" data-lane-id="${escapeHtml(lane.id)}">${laneCards.map(card => cardMarkup(card, { draggable: true })).join('')}</div></section>`
  }).join('')
  view.innerHTML = viewHeader('Kanban', 'Move work through the system. Done means implementation complete; Validated means acceptance criteria and Definition of Done are met.') + `<div class="kanban-toolbar"><button id="configureLanes" class="button subtle">Configure lanes</button></div><div class="kanban">${markup}</div>`
}

function setView(name) {
  state.view = name
  $('.sidebar').classList.remove('open')
  renderAll()
  view.focus()
}

function openCardDialog(cardId = null, defaults = {}) {
  if (state.editingDisabled) return
  const card = cardId ? state.board.cards.find(item => item.id === cardId) : null
  $('#cardDialogTitle').textContent = card ? `${card.workNumber} · Edit work` : 'New work'
  $('#cardId').value = card?.id ?? ''
  $('#cardTitle').value = card?.title ?? defaults.title ?? ''
  $('#cardType').value = card?.type ?? 'Task'
  $('#cardPriority').value = card?.priority ?? 'Medium'
  $('#cardProject').value = card?.project ?? ''
  $('#cardOwner').value = card?.owner ?? ''
  $('#cardLane').innerHTML = [...state.board.lanes].sort((a,b) => a.order-b.order).map(lane => `<option value="${escapeHtml(lane.id)}">${escapeHtml(lane.name)}</option>`).join('')
  $('#cardLane').value = card?.laneId ?? defaults.laneId ?? state.board.lanes[0].id
  $('#cardHome').value = card?.planningHome ?? defaults.planningHome ?? 'Inbox'
  $('#cardDescription').value = card?.description ?? ''
  $('#cardNextAction').value = card?.nextAction ?? ''
  $('#cardAcceptance').value = card?.acceptanceCriteria ?? ''
  $('#cardBlocker').value = card?.blocker ?? ''
  $('#cardUnblock').value = card?.unblockAction ?? ''
  $('#cardWaiting').value = card?.waitingOn ?? ''
  $('#cardFollowUp').value = card?.followUpDate ?? ''
  $('#cardTiming').value = card?.timingNote ?? ''
  $('#cardScheduled').value = card?.scheduledDate ?? defaults.scheduledDate ?? ''
  $('#cardDeadline').value = card?.deadline ?? ''
  $('#cardEstimate').value = card?.estimatedMinutes ?? ''
  $('#cardPoints').value = card?.storyPoints ?? ''
  $('#cardEnergy').value = card?.energy ?? 'any'
  $('#cardSprint').value = card?.sprint ?? ''
  $('#cardMainWin').checked = card?.mainWin ?? defaults.mainWin ?? false
  $('#cardFormError').textContent = ''
  $('#cardDialog').showModal()
  $('#cardTitle').focus()
}

function saveCardFromDialog() {
  const id = $('#cardId').value
  const values = {
    title: $('#cardTitle').value.trim(), type: $('#cardType').value, priority: $('#cardPriority').value,
    project: $('#cardProject').value.trim(), owner: $('#cardOwner').value.trim(), laneId: $('#cardLane').value,
    planningHome: $('#cardHome').value, description: $('#cardDescription').value.trim(), nextAction: $('#cardNextAction').value.trim(),
    acceptanceCriteria: $('#cardAcceptance').value.trim(), blocker: $('#cardBlocker').value.trim(), unblockAction: $('#cardUnblock').value.trim(),
    waitingOn: $('#cardWaiting').value.trim(), followUpDate: $('#cardFollowUp').value || null, timingNote: $('#cardTiming').value.trim(),
    scheduledDate: $('#cardScheduled').value || null, deadline: $('#cardDeadline').value || null,
    estimatedMinutes: $('#cardEstimate').value === '' ? null : Number($('#cardEstimate').value),
    storyPoints: $('#cardPoints').value === '' ? null : Number($('#cardPoints').value), energy: $('#cardEnergy').value,
    sprint: $('#cardSprint').value.trim(), mainWin: $('#cardMainWin').checked
  }
  if (!values.title) { $('#cardFormError').textContent = 'A title is required.'; return false }
  if (values.mainWin && !values.scheduledDate) { $('#cardFormError').textContent = 'A main win needs a scheduled date.'; return false }
  mutate(id ? 'Edit card' : 'Create card', board => {
    if (values.mainWin) board.cards.forEach(card => { if (card.id !== id && card.scheduledDate === values.scheduledDate) card.mainWin = false })
    if (id) Object.assign(board.cards.find(card => card.id === id), values, { updatedAt: new Date().toISOString() })
    else board.cards.push(createCard(board, values))
  })
  return true
}

function deleteCard(cardId) {
  const card = state.board.cards.find(item => item.id === cardId)
  if (!card) return
  mutate(`Delete ${card.workNumber}`, board => { board.cards = board.cards.filter(item => item.id !== cardId) })
}

function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}

function openLaneDialog() {
  state.laneDraft = deepClone(state.board.lanes).sort((a,b) => a.order-b.order)
  renderLaneEditor()
  $('#laneDialog').showModal()
}

function renderLaneEditor() {
  $('#laneEditor').innerHTML = state.laneDraft.map((lane, index) => `<div class="lane-row" data-lane-index="${index}"><input type="color" value="${escapeHtml(lane.color)}" aria-label="Lane color"><input value="${escapeHtml(lane.name)}" maxlength="80" aria-label="Lane name"><select aria-label="Workflow category">${WORKFLOW_CATEGORIES.map(category => `<option value="${category}" ${category === lane.category ? 'selected' : ''}>${category}</option>`).join('')}</select><input type="number" min="1" max="999" value="${lane.wipLimit ?? ''}" placeholder="No WIP" aria-label="WIP limit"><button type="button" class="mini-button" data-lane-up="${index}" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" class="mini-button" data-lane-delete="${index}" ${state.board.cards.some(card => card.laneId === lane.id) ? 'disabled title="Lane is not empty"' : ''}>Delete</button></div>`).join('')
}

function readLaneDraft() {
  document.querySelectorAll('.lane-row').forEach((row, index) => {
    const [color, name, category, wip] = row.querySelectorAll('input,select')
    Object.assign(state.laneDraft[index], { color: color.value, name: name.value.trim(), category: category.value, wipLimit: wip.value ? Number(wip.value) : null })
  })
}

function openCapacityDialog() {
  const names = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  $('#weekdayCapacity').innerHTML = names.map((name, day) => `<label>${name}<input data-weekday="${day}" type="number" min="0" max="24" step="0.25" value="${state.board.capacity.weekdays[String(day)] / 60}"></label>`).join('')
  $('#bufferPercent').value = state.board.capacity.bufferPercent
  $('#overrideDate').value = state.selectedDate
  loadOverrideFields()
  renderOverrides()
  $('#capacityDialog').showModal()
}

function loadOverrideFields() {
  const override = state.board.capacity.overrides[$('#overrideDate').value]
  $('#overrideHours').value = override ? override.minutes / 60 : ''
  $('#overrideOff').checked = override?.off ?? false
  $('#overrideNote').value = override?.note ?? ''
}

function renderOverrides() {
  const entries = Object.entries(state.board.capacity.overrides).sort(([a],[b]) => a.localeCompare(b))
  $('#overrideList').innerHTML = entries.map(([date, item]) => `<div class="override-row"><span><strong>${formatDate(date)}</strong> · ${item.off ? 'Day off' : `${formatMinutes(item.minutes)} available`} ${item.note ? `· ${escapeHtml(item.note)}` : ''}</span><button type="button" class="mini-button" data-remove-override="${date}">Remove</button></div>`).join('')
}

async function openRevisions() {
  $('#revisionList').innerHTML = '<div class="loading-block">Loading revisions…</div>'
  $('#revisionsDialog').showModal()
  try {
    const { payload } = await api('/revisions')
    $('#revisionList').innerHTML = payload.revisions.length ? payload.revisions.map(item => `<div class="revision-row"><span><strong>Revision ${item.revision}</strong><br><span class="guidance">${new Date(item.savedAt).toLocaleString()} · ${item.cardCount} cards</span></span><a class="mini-button" href="/api/persotodo/revisions/${item.revision}?download=1">Download</a><button type="button" class="mini-button" data-restore-revision="${item.revision}">Restore</button></div>`).join('') : '<div class="empty-state">No earlier revisions yet.</div>'
  } catch (error) {
    $('#revisionList').innerHTML = `<div class="form-error">${escapeHtml(error.message)}</div>`
  }
}

document.addEventListener('click', async event => {
  const nav = event.target.closest('[data-view]')
  if (nav) setView(nav.dataset.view)
  const action = event.target.closest('[data-action]')
  if (action?.dataset.action === 'edit') openCardDialog(action.dataset.cardId)
  if (action?.dataset.action === 'new-for-date') openCardDialog(null, { scheduledDate: action.dataset.date, planningHome: 'Next' })
  const shift = event.target.closest('[data-date-shift]')
  if (shift) { state.selectedDate = addDays(state.selectedDate, Number(shift.dataset.dateShift)); renderView() }
  const weekShift = event.target.closest('[data-week-shift]')
  if (weekShift) { state.selectedDate = addDays(state.selectedDate, Number(weekShift.dataset.weekShift)); renderView() }
  const monthShift = event.target.closest('[data-month-shift]')
  if (monthShift) {
    const date = new Date(`${state.monthDate}-15T12:00:00`); date.setMonth(date.getMonth() + Number(monthShift.dataset.monthShift)); state.monthDate = localDateKey(date).slice(0,7); renderView()
  }
  const openDate = event.target.closest('[data-open-date]')
  if (openDate) { state.selectedDate = openDate.dataset.openDate; setView('today') }
  if (event.target.closest('#configureLanes')) openLaneDialog()
  const laneUp = event.target.closest('[data-lane-up]')
  if (laneUp) { readLaneDraft(); const index = Number(laneUp.dataset.laneUp); [state.laneDraft[index-1], state.laneDraft[index]] = [state.laneDraft[index], state.laneDraft[index-1]]; renderLaneEditor() }
  const laneDelete = event.target.closest('[data-lane-delete]')
  if (laneDelete) { readLaneDraft(); state.laneDraft.splice(Number(laneDelete.dataset.laneDelete), 1); renderLaneEditor() }
  const removeOverride = event.target.closest('[data-remove-override]')
  if (removeOverride) {
    mutate('Remove capacity override', board => { delete board.capacity.overrides[removeOverride.dataset.removeOverride] })
    renderOverrides()
  }
  const restore = event.target.closest('[data-restore-revision]')
  if (restore && window.confirm(`Restore revision ${restore.dataset.restoreRevision} over the current board? The current board will remain in saved revisions.`)) {
    const { payload } = await api(`/revisions/${restore.dataset.restoreRevision}`)
    mutate(`Restore revision ${restore.dataset.restoreRevision}`, board => Object.keys(board).forEach(key => delete board[key]) || Object.assign(board, deepClone(payload.board)))
    $('#revisionsDialog').close()
  }
})

document.addEventListener('change', event => {
  const move = event.target.closest('[data-action="move"]')
  if (move?.value) mutate('Move card', board => moveCard(board, move.dataset.cardId, move.value, board.cards.filter(card => card.laneId === move.value).length))
  if (event.target.id === 'weeklyOutcome') mutate('Edit weekly outcome', board => { board.outcomes.weekly[mondayFor(state.selectedDate)] = event.target.value.trim() })
  if (event.target.id === 'monthlyOutcome') mutate('Edit monthly outcome', board => { board.outcomes.monthly[state.monthDate] = event.target.value.trim() })
  if (event.target.id === 'overrideDate') loadOverrideFields()
})

document.addEventListener('submit', event => {
  if (event.target.id !== 'captureForm') return
  event.preventDefault()
  const title = $('#captureTitle').value.trim()
  const destination = $('#captureDestination').value
  if (!title) return
  mutate('Capture work', board => {
    board.cards.push(createCard(board, { title, planningHome: destination === 'Someday' ? 'Someday' : destination === 'Today' ? 'Next' : 'Inbox', scheduledDate: destination === 'Today' ? localDateKey() : null }))
  })
})

$('#pinForm').addEventListener('submit', async event => {
  event.preventDefault(); $('#unlock').disabled = true; $('#pinError').textContent = ''
  try { await api('/session', { method: 'POST', body: JSON.stringify({ pin: $('#pin').value }) }); await loadBoard() }
  catch (error) { $('#pinError').textContent = error.message; $('#pin').value = ''; $('#pin').focus() }
  finally { $('#unlock').disabled = false }
})

$('#cardForm').addEventListener('submit', event => {
  event.preventDefault()
  if (event.submitter?.value === 'cancel') { $('#cardDialog').close(); return }
  if (saveCardFromDialog()) $('#cardDialog').close()
})

$('#laneForm').addEventListener('submit', event => {
  event.preventDefault()
  if (event.submitter?.value === 'cancel') { $('#laneDialog').close(); return }
  readLaneDraft()
  if (!state.laneDraft.length || state.laneDraft.some(lane => !lane.name)) return
  mutate('Configure lanes', board => { board.lanes = state.laneDraft.map((lane, order) => ({ ...lane, order })) })
  $('#laneDialog').close()
})

$('#capacityForm').addEventListener('submit', event => {
  event.preventDefault()
  if (event.submitter?.value === 'cancel') { $('#capacityDialog').close(); return }
  mutate('Change capacity defaults', board => {
    document.querySelectorAll('[data-weekday]').forEach(input => { board.capacity.weekdays[input.dataset.weekday] = Math.round(Number(input.value) * 60) })
    board.capacity.bufferPercent = Number($('#bufferPercent').value)
  })
  $('#capacityDialog').close()
})

$('#addLaneButton').addEventListener('click', () => { readLaneDraft(); state.laneDraft.push({ id: `lane-${uuid()}`, name: 'New lane', color: '#6f7c77', category: 'backlog', wipLimit: null, order: state.laneDraft.length }); renderLaneEditor() })
$('#saveOverride').addEventListener('click', () => {
  const date = $('#overrideDate').value
  if (!date) return
  mutate('Save capacity override', board => { board.capacity.overrides[date] = { minutes: Math.round(Number($('#overrideHours').value || 0) * 60), off: $('#overrideOff').checked, note: $('#overrideNote').value.trim() } })
  renderOverrides()
})

$('#navigation').addEventListener('click', event => { if (event.target.closest('.nav-item')) $('.sidebar').classList.remove('open') })
$('#mobileMenu').addEventListener('click', () => $('.sidebar').classList.toggle('open'))
$('#newCardButton').addEventListener('click', () => openCardDialog(null, state.view === 'today' ? { scheduledDate: state.selectedDate, planningHome: 'Next' } : {}))
$('#undoButton').addEventListener('click', undo)
$('#capacityButton').addEventListener('click', openCapacityDialog)
$('#revisionsButton').addEventListener('click', openRevisions)
$('#exportButton').addEventListener('click', () => downloadJson(`clearspace-board-${localDateKey()}.json`, state.board))
$('#conflictExport').addEventListener('click', () => downloadJson(`clearspace-unsaved-conflict-${localDateKey()}.json`, state.board))
$('#conflictReload').addEventListener('click', () => window.location.reload())
$('#importButton').addEventListener('click', () => $('#importFile').click())
$('#importFile').addEventListener('change', async event => {
  const file = event.target.files?.[0]
  if (!file) return
  try {
    const imported = migrateBoard(JSON.parse(await file.text()))
    const validation = validateBoard(imported)
    if (!validation.ok) throw new Error(validation.errors[0])
    if (window.confirm(`Import ${imported.cards.length} cards over the current board? Export first if you need a separate backup.`)) mutate('Import board', board => Object.keys(board).forEach(key => delete board[key]) || Object.assign(board, imported))
  } catch (error) { window.alert(`Import failed: ${error.message}`) }
  event.target.value = ''
})
$('#logoutButton').addEventListener('click', async () => { await api('/session', { method: 'DELETE' }).catch(() => {}); window.location.reload() })
$('#searchInput').addEventListener('input', event => { state.search = event.target.value; renderView() })
$('#priorityFilter').addEventListener('change', event => { state.priority = event.target.value; renderView() })
$('#sprintFilter').addEventListener('change', event => { state.sprint = event.target.value; renderView() })

document.addEventListener('dragstart', event => {
  const card = event.target.closest('.work-card[draggable="true"]')
  if (!card) return
  state.dragCardId = card.dataset.cardId
  card.classList.add('dragging')
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', state.dragCardId)
  $('#trashBucket').hidden = false
})
document.addEventListener('dragend', event => {
  event.target.closest('.work-card')?.classList.remove('dragging')
  state.dragCardId = null
  $('#trashBucket').hidden = true
  $('#trashBucket').classList.remove('drag-over')
})
document.addEventListener('dragover', event => { if (event.target.closest('.lane-body,.day-drop,#trashBucket')) event.preventDefault() })
document.addEventListener('drop', event => {
  const cardId = state.dragCardId || event.dataTransfer.getData('text/plain')
  if (!cardId) return
  const trash = event.target.closest('#trashBucket')
  const lane = event.target.closest('.lane-body')
  const day = event.target.closest('.day-drop')
  if (trash) deleteCard(cardId)
  else if (lane) mutate('Move card', board => moveCard(board, cardId, lane.dataset.laneId, board.cards.filter(card => card.laneId === lane.dataset.laneId).length))
  else if (day) mutate('Reschedule card', board => scheduleCard(board, cardId, day.dataset.weekDate))
})
$('#trashBucket').addEventListener('dragenter', () => $('#trashBucket').classList.add('drag-over'))
$('#trashBucket').addEventListener('dragleave', () => $('#trashBucket').classList.remove('drag-over'))

document.addEventListener('keydown', event => {
  const editingText = ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !editingText) { event.preventDefault(); undo() }
  if (event.key === 'Escape' && state.dragCardId) { state.dragCardId = null; $('#trashBucket').hidden = true }
  if (!editingText && !event.ctrlKey && !event.metaKey && !event.altKey) {
    const shortcut = { t: 'today', w: 'week', m: 'month', k: 'kanban' }[event.key.toLowerCase()]
    if (shortcut) setView(shortcut)
  }
})

window.addEventListener('beforeunload', event => {
  if (state.changeVersion > state.savedVersion || state.saveInFlight) { event.preventDefault(); event.returnValue = '' }
})

api('/session').then(({ payload }) => payload.authenticated ? loadBoard() : null).catch(() => { $('#pinError').textContent = 'Clearspace is temporarily unavailable.' })
