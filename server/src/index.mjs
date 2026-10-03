import { createApiServer } from './app.mjs'
import { createCard, createEmptyBoard } from './board-model.mjs'
import { PostgresTodoRepository } from './db.mjs'

const required = ['DATABASE_URL', 'PERSOTODO_PIN', 'PERSOTODO_SESSION_SECRET']
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required`)
}

if (!/^\d{4}$/.test(process.env.PERSOTODO_PIN)) {
  throw new Error('PERSOTODO_PIN must contain exactly four digits')
}

const repository = new PostgresTodoRepository(process.env.DATABASE_URL)
await repository.migrate()

if (!await repository.loadBoard()) {
  const board = createEmptyBoard()
  for (const legacy of await repository.legacyTodos()) {
    board.cards.push(createCard(board, {
      id: `legacy-${legacy.id}`,
      title: legacy.title,
      laneId: legacy.completed ? 'lane-done' : 'lane-backlog',
      planningHome: legacy.completed ? 'Next' : 'Inbox',
      createdAt: new Date(legacy.created_at).toISOString(),
      updatedAt: new Date(legacy.updated_at).toISOString()
    }))
  }
  await repository.ensureBoard(board)
}

const server = createApiServer({
  repository,
  pin: process.env.PERSOTODO_PIN,
  sessionSecret: process.env.PERSOTODO_SESSION_SECRET
})

const port = Number.parseInt(process.env.PORT ?? '3000', 10)
server.listen(port, '0.0.0.0', () => {
  console.log(`Persotodo API is listening on port ${port}`)
})

const shutdown = signal => {
  console.log(`Received ${signal}; shutting down`)
  server.close(async () => {
    await repository.close()
    process.exit(0)
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
