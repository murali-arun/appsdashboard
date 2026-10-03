import { createApiServer } from './app.mjs'
import { PostgresTodoRepository } from './db.mjs'

const required = ['DATABASE_URL']
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required`)
}

const repository = new PostgresTodoRepository(process.env.DATABASE_URL)
await repository.migrate()

const server = createApiServer({ repository })

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
