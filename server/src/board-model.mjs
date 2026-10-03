export const SCHEMA_VERSION = 2
export const CARD_TYPES = ['Story', 'Task', 'Bug', 'Spike']
export const PRIORITIES = ['High', 'Medium', 'Low']
export const ENERGIES = ['any', 'deep', 'light']
export const PLANNING_HOMES = ['Inbox', 'Next', 'Someday']
export const WORKFLOW_CATEGORIES = ['backlog', 'planned', 'inProgress', 'blockers', 'done', 'validated']

export const DEFAULT_LANES = [
  { id: 'lane-backlog', name: 'Backlog', color: '#7b8580', category: 'backlog', wipLimit: null, order: 0 },
  { id: 'lane-planned', name: 'Planned', color: '#55756b', category: 'planned', wipLimit: null, order: 1 },
  { id: 'lane-progress', name: 'In Progress', color: '#315f52', category: 'inProgress', wipLimit: 5, order: 2 },
  { id: 'lane-blockers', name: 'Blockers', color: '#846858', category: 'blockers', wipLimit: null, order: 3 },
  { id: 'lane-done', name: 'Done', color: '#64746e', category: 'done', wipLimit: null, order: 4 },
  { id: 'lane-validated', name: 'Validated', color: '#244b40', category: 'validated', wipLimit: null, order: 5 }
]

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value))
}

export function localDateKey(date = new Date()) {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return adjusted.toISOString().slice(0, 10)
}

export function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00`)
  date.setDate(date.getDate() + days)
  return localDateKey(date)
}

export function mondayFor(dateKey) {
  const date = new Date(`${dateKey}T12:00:00`)
  const day = date.getDay()
  return addDays(dateKey, -(day === 0 ? 6 : day - 1))
}

export function createEmptyBoard(now = new Date().toISOString()) {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: { nextWorkNumber: 1, createdAt: now, updatedAt: now },
    lanes: deepClone(DEFAULT_LANES),
    cards: [],
    outcomes: { weekly: {}, monthly: {} },
    capacity: {
      weekdays: { '0': 0, '1': 480, '2': 480, '3': 480, '4': 480, '5': 480, '6': 0 },
      bufferPercent: 25,
      overrides: {}
    }
  }
}

export function createCard(board, overrides = {}, now = new Date().toISOString()) {
  const number = Number.isInteger(board.meta?.nextWorkNumber) ? board.meta.nextWorkNumber : 1
  board.meta.nextWorkNumber = number + 1
  const id = overrides.id ?? globalThis.crypto?.randomUUID?.() ?? `card-${Date.now()}-${Math.random().toString(16).slice(2)}`
  return {
    id,
    workNumber: overrides.workNumber ?? `CS-${number}`,
    title: overrides.title?.trim() ?? '',
    type: overrides.type ?? 'Task',
    priority: overrides.priority ?? 'Medium',
    project: overrides.project ?? '',
    owner: overrides.owner ?? '',
    laneId: overrides.laneId ?? board.lanes[0].id,
    description: overrides.description ?? '',
    nextAction: overrides.nextAction ?? '',
    acceptanceCriteria: overrides.acceptanceCriteria ?? '',
    blocker: overrides.blocker ?? '',
    unblockAction: overrides.unblockAction ?? '',
    waitingOn: overrides.waitingOn ?? '',
    followUpDate: overrides.followUpDate ?? null,
    timingNote: overrides.timingNote ?? '',
    scheduledDate: overrides.scheduledDate ?? null,
    deadline: overrides.deadline ?? null,
    estimatedMinutes: overrides.estimatedMinutes ?? null,
    storyPoints: overrides.storyPoints ?? null,
    energy: overrides.energy ?? 'any',
    planningHome: overrides.planningHome ?? 'Inbox',
    mainWin: overrides.mainWin ?? false,
    sprint: overrides.sprint ?? '',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    order: Number.isFinite(overrides.order) ? overrides.order : board.cards.length
  }
}

function validNullableDate(value) {
  return value === null || (typeof value === 'string' && DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00`)))
}

function validOptionalNumber(value, { integer = false, min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === null) return true
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value))
}

export function validateBoard(candidate) {
  const errors = []
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { ok: false, errors: ['Board must be an object.'] }
  }
  if (candidate.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion must be ${SCHEMA_VERSION}.`)
  if (!candidate.meta || !Number.isInteger(candidate.meta.nextWorkNumber) || candidate.meta.nextWorkNumber < 1) errors.push('meta.nextWorkNumber must be a positive integer.')
  if (!Array.isArray(candidate.lanes) || candidate.lanes.length === 0 || candidate.lanes.length > 30) errors.push('Board must contain 1 to 30 lanes.')
  if (!Array.isArray(candidate.cards) || candidate.cards.length > 10_000) errors.push('Board cards must be an array with at most 10,000 items.')

  const laneIds = new Set()
  for (const [index, lane] of (candidate.lanes ?? []).entries()) {
    if (!lane || !ID_PATTERN.test(lane.id ?? '')) errors.push(`Lane ${index + 1} has an invalid ID.`)
    else if (laneIds.has(lane.id)) errors.push(`Duplicate lane ID: ${lane.id}.`)
    else laneIds.add(lane.id)
    if (typeof lane?.name !== 'string' || !lane.name.trim() || lane.name.length > 80) errors.push(`Lane ${index + 1} needs a name of 1 to 80 characters.`)
    if (!WORKFLOW_CATEGORIES.includes(lane?.category)) errors.push(`Lane ${index + 1} has an invalid workflow category.`)
    if (lane?.wipLimit !== null && (!Number.isInteger(lane.wipLimit) || lane.wipLimit < 1 || lane.wipLimit > 999)) errors.push(`Lane ${index + 1} has an invalid WIP limit.`)
    if (typeof lane?.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(lane.color)) errors.push(`Lane ${index + 1} has an invalid color.`)
  }

  const cardIds = new Set()
  const workNumbers = new Set()
  const wins = new Map()
  for (const [index, card] of (candidate.cards ?? []).entries()) {
    const label = card?.workNumber || `card ${index + 1}`
    if (!card || !ID_PATTERN.test(card.id ?? '')) errors.push(`${label} has an invalid ID.`)
    else if (cardIds.has(card.id)) errors.push(`Duplicate card ID: ${card.id}.`)
    else cardIds.add(card.id)
    if (typeof card?.workNumber !== 'string' || !card.workNumber.trim() || card.workNumber.length > 40) errors.push(`${label} has an invalid work number.`)
    else if (workNumbers.has(card.workNumber)) errors.push(`Duplicate work number: ${card.workNumber}.`)
    else workNumbers.add(card.workNumber)
    if (typeof card?.title !== 'string' || !card.title.trim() || card.title.length > 500) errors.push(`${label} needs a title of 1 to 500 characters.`)
    if (!CARD_TYPES.includes(card?.type)) errors.push(`${label} has an invalid type.`)
    if (!PRIORITIES.includes(card?.priority)) errors.push(`${label} has an invalid priority.`)
    if (!laneIds.has(card?.laneId)) errors.push(`${label} references a missing lane.`)
    if (!ENERGIES.includes(card?.energy)) errors.push(`${label} has an invalid energy value.`)
    if (!PLANNING_HOMES.includes(card?.planningHome)) errors.push(`${label} has an invalid planning home.`)
    for (const field of ['followUpDate', 'scheduledDate', 'deadline']) {
      if (!validNullableDate(card?.[field])) errors.push(`${label} has an invalid ${field}.`)
    }
    if (!validOptionalNumber(card?.estimatedMinutes, { integer: true, min: 1, max: 100_000 })) errors.push(`${label} has an invalid estimate.`)
    if (!validOptionalNumber(card?.storyPoints, { min: 0, max: 10_000 })) errors.push(`${label} has invalid story points.`)
    if (typeof card?.mainWin !== 'boolean') errors.push(`${label} has an invalid main-win flag.`)
    if (card?.mainWin) {
      if (!card.scheduledDate) errors.push(`${label} is a main win without a scheduled date.`)
      else if (wins.has(card.scheduledDate)) errors.push(`${label} and ${wins.get(card.scheduledDate)} are both main wins for ${card.scheduledDate}.`)
      else wins.set(card.scheduledDate, label)
    }
    for (const field of ['project', 'owner', 'description', 'nextAction', 'acceptanceCriteria', 'blocker', 'unblockAction', 'waitingOn', 'timingNote', 'sprint']) {
      if (typeof card?.[field] !== 'string' || card[field].length > 20_000) errors.push(`${label} has an invalid ${field}.`)
    }
  }

  const capacity = candidate.capacity
  if (!capacity || typeof capacity !== 'object') errors.push('Capacity settings are required.')
  else {
    for (let day = 0; day < 7; day += 1) {
      const minutes = capacity.weekdays?.[String(day)]
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1_440) errors.push(`Capacity for weekday ${day} is invalid.`)
    }
    if (typeof capacity.bufferPercent !== 'number' || capacity.bufferPercent < 0 || capacity.bufferPercent > 90) errors.push('Buffer must be between 0 and 90 percent.')
    if (!capacity.overrides || typeof capacity.overrides !== 'object' || Array.isArray(capacity.overrides)) errors.push('Capacity overrides must be an object.')
    for (const [date, override] of Object.entries(capacity.overrides ?? {})) {
      if (!DATE_PATTERN.test(date) || typeof override !== 'object') errors.push(`Capacity override ${date} is invalid.`)
      else if (typeof override.off !== 'boolean' || !Number.isInteger(override.minutes) || override.minutes < 0 || override.minutes > 1_440 || typeof override.note !== 'string') errors.push(`Capacity override ${date} is invalid.`)
    }
  }
  if (!candidate.outcomes || typeof candidate.outcomes.weekly !== 'object' || typeof candidate.outcomes.monthly !== 'object') errors.push('Weekly and monthly outcomes are required.')
  return { ok: errors.length === 0, errors }
}

export function capacityForDate(board, dateKey) {
  const date = new Date(`${dateKey}T12:00:00`)
  const override = board.capacity.overrides[dateKey]
  const weekdayMinutes = board.capacity.weekdays[String(date.getDay())]
  const off = override ? override.off : weekdayMinutes === 0
  const totalMinutes = off ? 0 : (override?.minutes ?? weekdayMinutes)
  const bufferMinutes = off ? 0 : Math.round(totalMinutes * board.capacity.bufferPercent / 100)
  const planMinutes = Math.max(0, totalMinutes - bufferMinutes)
  const scheduled = board.cards.filter(card => card.scheduledDate === dateKey)
  const estimatedMinutes = scheduled.reduce((sum, card) => sum + (card.estimatedMinutes ?? 0), 0)
  const unestimatedCount = scheduled.filter(card => card.estimatedMinutes === null).length
  return {
    off,
    note: override?.note ?? '',
    totalMinutes,
    bufferMinutes,
    planMinutes,
    estimatedMinutes,
    unestimatedCount,
    remainingMinutes: planMinutes - estimatedMinutes,
    overloaded: estimatedMinutes > planMinutes
  }
}

export function scheduleCard(board, cardId, scheduledDate) {
  const card = board.cards.find(item => item.id === cardId)
  if (!card) return false
  card.scheduledDate = scheduledDate
  card.updatedAt = new Date().toISOString()
  return true
}

export function moveCard(board, cardId, laneId, order = 0) {
  if (!board.lanes.some(lane => lane.id === laneId)) return false
  const card = board.cards.find(item => item.id === cardId)
  if (!card) return false
  card.laneId = laneId
  card.order = order
  card.updatedAt = new Date().toISOString()
  return true
}

export function migrateBoard(input) {
  if (input?.schemaVersion === SCHEMA_VERSION) return deepClone(input)
  const board = createEmptyBoard()
  if (input?.schemaVersion === 1 && Array.isArray(input.lanes) && input.lanes.length) {
    board.lanes = input.lanes.slice(0, 30).map((lane, order) => ({
      id: typeof lane.id === 'string' && ID_PATTERN.test(lane.id) ? lane.id : `legacy-lane-${order + 1}`,
      name: typeof lane.name === 'string' && lane.name.trim() ? lane.name.trim().slice(0, 80) : `Lane ${order + 1}`,
      color: typeof lane.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(lane.color) ? lane.color : '#6f7c77',
      category: WORKFLOW_CATEGORIES.includes(lane.category) ? lane.category : 'backlog',
      wipLimit: Number.isInteger(lane.wipLimit) && lane.wipLimit > 0 ? lane.wipLimit : null,
      order
    }))
  }
  const legacyCards = Array.isArray(input) ? input : (input?.todos ?? input?.cards ?? [])
  if (!Array.isArray(legacyCards)) throw new Error('This file is not a recognized Clearspace or legacy board.')
  for (const legacy of legacyCards) {
    if (!legacy || typeof legacy.title !== 'string' || !legacy.title.trim()) continue
    const done = Boolean(legacy.completed ?? legacy.done)
    const card = createCard(board, {
      id: typeof legacy.id === 'string' && ID_PATTERN.test(legacy.id) ? legacy.id : undefined,
      workNumber: typeof legacy.workNumber === 'string' ? legacy.workNumber : undefined,
      title: legacy.title,
      type: CARD_TYPES.includes(legacy.type) ? legacy.type : 'Task',
      priority: PRIORITIES.includes(legacy.priority) ? legacy.priority : 'Medium',
      project: legacy.project ?? '',
      owner: legacy.owner ?? '',
      laneId: legacy.laneId && board.lanes.some(lane => lane.id === legacy.laneId)
        ? legacy.laneId
        : done
          ? (board.lanes.find(lane => lane.category === 'done')?.id ?? board.lanes[0].id)
          : board.lanes[0].id,
      description: legacy.description ?? '',
      nextAction: legacy.nextAction ?? '',
      acceptanceCriteria: legacy.acceptanceCriteria ?? '',
      blocker: legacy.blocker ?? '',
      unblockAction: legacy.unblockAction ?? '',
      waitingOn: legacy.waitingOn ?? '',
      followUpDate: validNullableDate(legacy.followUpDate) ? legacy.followUpDate : null,
      timingNote: legacy.timingNote ?? '',
      scheduledDate: validNullableDate(legacy.scheduledDate) ? legacy.scheduledDate : null,
      deadline: validNullableDate(legacy.deadline) ? legacy.deadline : null,
      estimatedMinutes: validOptionalNumber(legacy.estimatedMinutes, { integer: true, min: 1 }) ? legacy.estimatedMinutes : null,
      storyPoints: validOptionalNumber(legacy.storyPoints, { min: 0 }) ? legacy.storyPoints : null,
      energy: ENERGIES.includes(legacy.energy) ? legacy.energy : 'any',
      planningHome: PLANNING_HOMES.includes(legacy.planningHome) ? legacy.planningHome : 'Inbox',
      mainWin: Boolean(legacy.mainWin) && Boolean(legacy.scheduledDate),
      sprint: legacy.sprint ?? '',
      createdAt: legacy.createdAt ?? new Date().toISOString(),
      updatedAt: legacy.updatedAt ?? new Date().toISOString()
    })
    board.cards.push(card)
  }
  if (input?.schemaVersion === 1 && input.outcomes?.weekly && input.outcomes?.monthly) board.outcomes = deepClone(input.outcomes)
  if (input?.schemaVersion === 1 && input.capacity?.weekdays && typeof input.capacity.bufferPercent === 'number') {
    board.capacity = {
      weekdays: { ...board.capacity.weekdays, ...input.capacity.weekdays },
      bufferPercent: input.capacity.bufferPercent,
      overrides: deepClone(input.capacity.overrides ?? {})
    }
  }
  const highestNumber = board.cards.reduce((highest, card) => {
    const match = card.workNumber.match(/^CS-(\d+)$/)
    return match ? Math.max(highest, Number(match[1])) : highest
  }, 0)
  board.meta.nextWorkNumber = Math.max(board.meta.nextWorkNumber, highestNumber + 1)
  return board
}
