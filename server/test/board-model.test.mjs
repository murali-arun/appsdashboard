import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  capacityForDate,
  createCard,
  createEmptyBoard,
  migrateBoard,
  moveCard,
  scheduleCard,
  validateBoard
} from '../src/board-model.mjs'

test('capacity honors buffers, completed work, unknown estimates, overload, and days off', () => {
  const board = createEmptyBoard('2026-10-02T12:00:00.000Z')
  board.cards.push(createCard(board, { title: 'Known work', scheduledDate: '2026-10-05', estimatedMinutes: 300, laneId: 'lane-done' }))
  board.cards.push(createCard(board, { title: 'Unknown work', scheduledDate: '2026-10-05', estimatedMinutes: null }))
  const monday = capacityForDate(board, '2026-10-05')
  assert.equal(monday.planMinutes, 360)
  assert.equal(monday.bufferMinutes, 120)
  assert.equal(monday.estimatedMinutes, 300)
  assert.equal(monday.remainingMinutes, 60)
  assert.equal(monday.unestimatedCount, 1)

  board.cards.push(createCard(board, { title: 'Overload', scheduledDate: '2026-10-05', estimatedMinutes: 90 }))
  assert.equal(capacityForDate(board, '2026-10-05').overloaded, true)
  assert.equal(capacityForDate(board, '2026-10-04').off, true)
  board.capacity.overrides['2026-10-06'] = { minutes: 0, off: true, note: 'Time off' }
  assert.equal(capacityForDate(board, '2026-10-06').note, 'Time off')
})

test('main win is unique per scheduled day', () => {
  const board = createEmptyBoard()
  board.cards.push(createCard(board, { title: 'One', scheduledDate: '2026-10-05', mainWin: true }))
  board.cards.push(createCard(board, { title: 'Two', scheduledDate: '2026-10-05', mainWin: true }))
  const validation = validateBoard(board)
  assert.equal(validation.ok, false)
  assert.match(validation.errors.join(' '), /both main wins/)
})

test('rescheduling changes neither deadline nor workflow lane', () => {
  const board = createEmptyBoard()
  const card = createCard(board, { title: 'Keep semantics', scheduledDate: '2026-10-05', deadline: '2026-10-20', laneId: 'lane-progress' })
  board.cards.push(card)
  scheduleCard(board, card.id, '2026-10-08')
  assert.equal(card.scheduledDate, '2026-10-08')
  assert.equal(card.deadline, '2026-10-20')
  assert.equal(card.laneId, 'lane-progress')
  moveCard(board, card.id, 'lane-done', 0)
  assert.equal(card.deadline, '2026-10-20')
})

test('legacy todos migrate without invented estimates or deadlines', () => {
  const board = migrateBoard([{ id: 'old-1', title: 'Old task', completed: false }])
  assert.equal(board.cards.length, 1)
  assert.equal(board.cards[0].id, 'old-1')
  assert.equal(board.cards[0].estimatedMinutes, null)
  assert.equal(board.cards[0].deadline, null)
  assert.equal(validateBoard(board).ok, true)
})

test('UI colors only priority badges, not entire cards', async () => {
  const css = await readFile(new URL('../../public/persotodo/styles.css', import.meta.url), 'utf8')
  assert.match(css, /\.priority\.high/)
  assert.match(css, /\.priority\.medium/)
  assert.match(css, /\.priority\.low/)
  assert.doesNotMatch(css, /\.work-card\.(high|medium|low)/)
})

test('hosted UI does not use localStorage', async () => {
  const script = await readFile(new URL('../../public/persotodo/app.js', import.meta.url), 'utf8')
  assert.doesNotMatch(script, /localStorage/)
})
