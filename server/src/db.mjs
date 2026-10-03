import { randomUUID } from 'node:crypto'
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
      CREATE TABLE IF NOT EXISTS clearspace_schema_migrations (
        version INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS clearspace_users (
        id UUID PRIMARY KEY,
        username VARCHAR(32) NOT NULL,
        username_normalized VARCHAR(32) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS clearspace_sessions (
        token_hash CHAR(64) PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES clearspace_users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS clearspace_user_boards (
        user_id UUID PRIMARY KEY REFERENCES clearspace_users(id) ON DELETE CASCADE,
        revision BIGINT NOT NULL DEFAULT 1,
        board_json JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS clearspace_user_revisions (
        user_id UUID NOT NULL REFERENCES clearspace_users(id) ON DELETE CASCADE,
        revision BIGINT NOT NULL,
        board_json JSONB NOT NULL,
        saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, revision)
      );
      CREATE TABLE IF NOT EXISTS clearspace_user_save_requests (
        user_id UUID NOT NULL REFERENCES clearspace_users(id) ON DELETE CASCADE,
        request_id VARCHAR(100) NOT NULL,
        content_hash VARCHAR(64) NOT NULL,
        resulting_revision BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, request_id)
      );
      CREATE INDEX IF NOT EXISTS clearspace_sessions_user_idx
        ON clearspace_sessions (user_id);
      CREATE INDEX IF NOT EXISTS clearspace_sessions_expiry_idx
        ON clearspace_sessions (expires_at);
      CREATE INDEX IF NOT EXISTS clearspace_user_revisions_saved_idx
        ON clearspace_user_revisions (user_id, saved_at DESC);
      INSERT INTO clearspace_schema_migrations (version, description)
      VALUES (2, 'User accounts, private boards, sessions, revisions, and replay-safe saves')
      ON CONFLICT (version) DO NOTHING
    `)
  }

  async health() {
    await this.pool.query('SELECT 1')
  }

  async createUser({ username, normalizedUsername, passwordHash, initialBoard }) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const userId = randomUUID()
      const created = await client.query(
        `INSERT INTO clearspace_users (id, username, username_normalized, password_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING id::text, username, created_at`,
        [userId, username, normalizedUsername, passwordHash]
      )
      await client.query(
        `INSERT INTO clearspace_user_boards (user_id, revision, board_json)
         VALUES ($1, 1, $2::jsonb)`,
        [userId, JSON.stringify(initialBoard)]
      )
      await client.query('COMMIT')
      return { user: created.rows[0] }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      if (error.code === '23505') return { conflict: true }
      throw error
    } finally {
      client.release()
    }
  }

  async findUserByUsername(normalizedUsername) {
    const result = await this.pool.query(
      `SELECT id::text, username, password_hash, created_at
       FROM clearspace_users WHERE username_normalized = $1`,
      [normalizedUsername]
    )
    return result.rows[0] ?? null
  }

  async createSession(userId, tokenHash, expiresAt) {
    await this.pool.query(
      `INSERT INTO clearspace_sessions (token_hash, user_id, expires_at)
       VALUES ($1, $2, $3)`,
      [tokenHash, userId, expiresAt]
    )
    await this.pool.query('DELETE FROM clearspace_sessions WHERE expires_at <= NOW()')
  }

  async getSession(tokenHash, at) {
    const result = await this.pool.query(
      `SELECT users.id::text, users.username
       FROM clearspace_sessions sessions
       JOIN clearspace_users users ON users.id = sessions.user_id
       WHERE sessions.token_hash = $1 AND sessions.expires_at > $2`,
      [tokenHash, at]
    )
    return result.rows[0] ?? null
  }

  async deleteSession(tokenHash) {
    await this.pool.query('DELETE FROM clearspace_sessions WHERE token_hash = $1', [tokenHash])
  }

  async loadBoard(userId) {
    const result = await this.pool.query(
      `SELECT revision::text, board_json, updated_at
       FROM clearspace_user_boards WHERE user_id = $1`,
      [userId]
    )
    if (!result.rows[0]) return null
    return {
      revision: Number(result.rows[0].revision),
      board: result.rows[0].board_json,
      updatedAt: result.rows[0].updated_at
    }
  }

  async saveBoard({ userId, board, expectedRevision, requestId, contentHash }) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const replay = await client.query(
        `SELECT content_hash, resulting_revision::text
         FROM clearspace_user_save_requests WHERE user_id = $1 AND request_id = $2`,
        [userId, requestId]
      )
      if (replay.rows[0]) {
        await client.query('ROLLBACK')
        if (replay.rows[0].content_hash !== contentHash) return { requestConflict: true }
        return { revision: Number(replay.rows[0].resulting_revision), replayed: true }
      }

      const current = await client.query(
        `SELECT revision::text, board_json FROM clearspace_user_boards
         WHERE user_id = $1 FOR UPDATE`,
        [userId]
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
        `INSERT INTO clearspace_user_revisions (user_id, revision, board_json)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (user_id, revision) DO NOTHING`,
        [userId, currentRevision, JSON.stringify(row.board_json)]
      )
      await client.query(
        `UPDATE clearspace_user_boards
         SET revision = $2, board_json = $3::jsonb, updated_at = NOW()
         WHERE user_id = $1`,
        [userId, nextRevision, JSON.stringify(board)]
      )
      await client.query(
        `INSERT INTO clearspace_user_save_requests
           (user_id, request_id, content_hash, resulting_revision)
         VALUES ($1, $2, $3, $4)`,
        [userId, requestId, contentHash, nextRevision]
      )
      await client.query(`
        DELETE FROM clearspace_user_revisions
        WHERE user_id = $1 AND revision NOT IN (
          SELECT revision FROM clearspace_user_revisions
          WHERE user_id = $1 ORDER BY revision DESC LIMIT 100
        )
      `, [userId])
      await client.query(`
        DELETE FROM clearspace_user_save_requests
        WHERE user_id = $1 AND created_at < NOW() - INTERVAL '7 days'
      `, [userId])
      await client.query('COMMIT')
      return { revision: nextRevision, replayed: false }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  async listRevisions(userId) {
    const result = await this.pool.query(
      `SELECT revision::text, saved_at,
              jsonb_array_length(board_json -> 'cards') AS card_count
       FROM clearspace_user_revisions
       WHERE user_id = $1 ORDER BY revision DESC LIMIT 100`,
      [userId]
    )
    return result.rows.map(row => ({
      revision: Number(row.revision),
      savedAt: row.saved_at,
      cardCount: Number(row.card_count)
    }))
  }

  async getRevision(userId, revision) {
    const result = await this.pool.query(
      `SELECT revision::text, board_json, saved_at
       FROM clearspace_user_revisions WHERE user_id = $1 AND revision = $2`,
      [userId, revision]
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
