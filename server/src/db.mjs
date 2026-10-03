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
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS clearspace_board (
        singleton_id SMALLINT PRIMARY KEY CHECK (singleton_id = 1),
        revision BIGINT NOT NULL,
        board_json JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS clearspace_revisions (
        revision BIGINT PRIMARY KEY,
        board_json JSONB NOT NULL,
        saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS clearspace_save_requests (
        request_id VARCHAR(100) PRIMARY KEY,
        content_hash VARCHAR(64) NOT NULL,
        resulting_revision BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS clearspace_revisions_saved_at_idx
      ON clearspace_revisions (saved_at DESC)
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

  async legacyTodos() {
    const result = await this.pool.query(`
      SELECT id::text, title, completed, created_at, updated_at
      FROM persotodo_items
      ORDER BY created_at ASC
    `)
    return result.rows
  }

  async ensureBoard(board) {
    await this.pool.query(
      `INSERT INTO clearspace_board (singleton_id, revision, board_json)
       VALUES (1, 1, $1::jsonb)
       ON CONFLICT (singleton_id) DO NOTHING`,
      [JSON.stringify(board)]
    )
    return this.loadBoard()
  }

  async loadBoard() {
    const result = await this.pool.query(`
      SELECT revision::text, board_json, updated_at
      FROM clearspace_board
      WHERE singleton_id = 1
    `)
    if (!result.rows[0]) return null
    return {
      revision: Number(result.rows[0].revision),
      board: result.rows[0].board_json,
      updatedAt: result.rows[0].updated_at
    }
  }

  async saveBoard({ board, expectedRevision, requestId, contentHash }) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const replay = await client.query(
        `SELECT content_hash, resulting_revision::text
         FROM clearspace_save_requests WHERE request_id = $1`,
        [requestId]
      )
      if (replay.rows[0]) {
        await client.query('ROLLBACK')
        if (replay.rows[0].content_hash !== contentHash) return { requestConflict: true }
        return { revision: Number(replay.rows[0].resulting_revision), replayed: true }
      }

      const current = await client.query(
        `SELECT revision::text, board_json FROM clearspace_board
         WHERE singleton_id = 1 FOR UPDATE`
      )
      const row = current.rows[0]
      if (!row) throw new Error('Clearspace board is missing.')
      const currentRevision = Number(row.revision)
      if (currentRevision !== expectedRevision) {
        await client.query('ROLLBACK')
        return { stale: true, revision: currentRevision }
      }

      const nextRevision = currentRevision + 1
      await client.query(
        `INSERT INTO clearspace_revisions (revision, board_json)
         VALUES ($1, $2::jsonb)
         ON CONFLICT (revision) DO NOTHING`,
        [currentRevision, JSON.stringify(row.board_json)]
      )
      await client.query(
        `UPDATE clearspace_board
         SET revision = $1, board_json = $2::jsonb, updated_at = NOW()
         WHERE singleton_id = 1`,
        [nextRevision, JSON.stringify(board)]
      )
      await client.query(
        `INSERT INTO clearspace_save_requests (request_id, content_hash, resulting_revision)
         VALUES ($1, $2, $3)`,
        [requestId, contentHash, nextRevision]
      )
      await client.query(`
        DELETE FROM clearspace_revisions
        WHERE revision NOT IN (
          SELECT revision FROM clearspace_revisions ORDER BY revision DESC LIMIT 100
        )
      `)
      await client.query(`
        DELETE FROM clearspace_save_requests
        WHERE created_at < NOW() - INTERVAL '7 days'
      `)
      await client.query('COMMIT')
      return { revision: nextRevision, replayed: false }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  async listRevisions() {
    const result = await this.pool.query(`
      SELECT revision::text, saved_at,
             jsonb_array_length(board_json -> 'cards') AS card_count
      FROM clearspace_revisions
      ORDER BY revision DESC
      LIMIT 100
    `)
    return result.rows.map(row => ({
      revision: Number(row.revision),
      savedAt: row.saved_at,
      cardCount: Number(row.card_count)
    }))
  }

  async getRevision(revision) {
    const result = await this.pool.query(
      `SELECT revision::text, board_json, saved_at
       FROM clearspace_revisions WHERE revision = $1`,
      [revision]
    )
    if (!result.rows[0]) return null
    return {
      revision: Number(result.rows[0].revision),
      board: result.rows[0].board_json,
      savedAt: result.rows[0].saved_at
    }
  }

  async close() {
    await this.pool.end()
  }
}
