import pg from 'pg'

const { Pool } = pg

export class PostgresTodoRepository {
  constructor(databaseUrl) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000
    })
  }

  async migrate() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS persotodo_items (
        id BIGSERIAL PRIMARY KEY,
        title VARCHAR(500) NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 500),
        completed BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS persotodo_items_created_at_idx
      ON persotodo_items (created_at DESC)
    `)
  }

  async health() {
    await this.pool.query('SELECT 1')
  }

  async list() {
    const result = await this.pool.query(`
      SELECT id::text, title, completed, created_at, updated_at
      FROM persotodo_items
      ORDER BY completed ASC, created_at DESC
    `)
    return result.rows
  }

  async create(title) {
    const result = await this.pool.query(
      `INSERT INTO persotodo_items (title)
       VALUES ($1)
       RETURNING id::text, title, completed, created_at, updated_at`,
      [title]
    )
    return result.rows[0]
  }

  async update(id, changes) {
    const fields = []
    const values = []

    if (Object.hasOwn(changes, 'title')) {
      values.push(changes.title)
      fields.push(`title = $${values.length}`)
    }
    if (Object.hasOwn(changes, 'completed')) {
      values.push(changes.completed)
      fields.push(`completed = $${values.length}`)
    }
    if (fields.length === 0) return null

    values.push(id)
    const result = await this.pool.query(
      `UPDATE persotodo_items
       SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length}
       RETURNING id::text, title, completed, created_at, updated_at`,
      values
    )
    return result.rows[0] ?? null
  }

  async remove(id) {
    const result = await this.pool.query(
      'DELETE FROM persotodo_items WHERE id = $1',
      [id]
    )
    return result.rowCount > 0
  }

  async close() {
    await this.pool.end()
  }
}
