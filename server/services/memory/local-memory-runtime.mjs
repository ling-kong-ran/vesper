import { createHash, randomUUID } from 'node:crypto'
import { basename, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  cosineSimilarity,
  embeddingBuffer,
  embeddingFromBuffer,
  keywordOverlap,
  localEmbedding,
} from './local-embedding.mjs'

const MEMORY_TYPES = new Set(['concept', 'file', 'risk', 'preference', 'decision', 'fact', 'task'])
const MEMORY_SCOPES = new Set(['global', 'project', 'custom'])
const REPLACEABLE_MEMORY_TYPES = new Set(['preference', 'decision', 'fact', 'task'])

function cleanText(value, maxLength) {
  return String(value || '').replaceAll(String.fromCharCode(0), '').trim().slice(0, maxLength)
}

function normalizeTopicKey(value) {
  return cleanText(value, 180)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '.')
    .replace(/^\.+|\.+$/g, '')
}

function isReplacementStatement(value) {
  return /(?:改为|改成|更改为|替换为|更新为|现(?:在|已)|目前|今后|不再|弃用|取代|instead\s+of|no\s+longer|changed?\s+to|replaced?\s+(?:by|with)|now\s+(?:uses?|is))/iu.test(String(value || ''))
}

function ensureColumn(db, table, name, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all()
  if (!columns.some((column) => column.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
}

function redactSecrets(value) {
  return String(value || '')
    .replace(/\bsk-[a-z0-9_-]{12,}\b/gi, '[已隐藏 API Key]')
    .replace(/\b(bearer\s+)[a-z0-9._~+/-]{16,}\b/gi, '$1[已隐藏令牌]')
    .replace(/\b(api[_ -]?key|password|passwd|密码)\s*[:=：]\s*\S+/gi, '$1: [已隐藏敏感信息]')
}

function stableProjectId(cwd) {
  return `project-${createHash('sha256').update(resolve(cwd).toLowerCase()).digest('hex').slice(0, 16)}`
}

function rowMemory(row) {
  if (!row) return null
  return {
    id: row.id,
    spaceId: row.space_id,
    title: row.title,
    content: row.content,
    type: row.type,
    sourceType: row.source_type,
    sourceId: row.source_id || '',
    sourcePath: row.source_path || '',
    sessionId: row.session_id || '',
    cwd: row.cwd || '',
    importance: Number(row.importance || 0),
    accessCount: Number(row.access_count || 0),
    topicKey: row.topic_key || '',
    status: row.status || 'active',
    supersededBy: row.superseded_by || '',
    supersededAt: row.superseded_at || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowSpace(row) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    rootPath: row.root_path || '',
    nodeCount: Number(row.node_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class LocalMemoryRuntime {
  constructor({ path, cwd }) {
    this.path = path
    this.cwd = resolve(cwd)
    this.db = null
  }

  async init() {
    this.db = new DatabaseSync(this.path)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS memory_spaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        root_path TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS memory_spaces_root ON memory_spaces(root_path) WHERE root_path <> '';
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL REFERENCES memory_spaces(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'concept',
        source_type TEXT NOT NULL DEFAULT 'manual',
        source_id TEXT NOT NULL DEFAULT '',
        source_path TEXT NOT NULL DEFAULT '',
        session_id TEXT NOT NULL DEFAULT '',
        cwd TEXT NOT NULL DEFAULT '',
        importance REAL NOT NULL DEFAULT 0.5,
        embedding BLOB,
        access_count INTEGER NOT NULL DEFAULT 0,
        last_accessed_at TEXT,
        topic_key TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        superseded_by TEXT NOT NULL DEFAULT '',
        superseded_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS memories_space_updated ON memories(space_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS memories_source ON memories(source_type, source_id);
      CREATE TABLE IF NOT EXISTS memory_links (
        id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL REFERENCES memory_spaces(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        relation TEXT NOT NULL DEFAULT 'related',
        weight REAL NOT NULL DEFAULT 0.5,
        created_at TEXT NOT NULL,
        UNIQUE(source_id, target_id)
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(title, content, content='memories', content_rowid='rowid');
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memory_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, title, content) VALUES ('delete', old.rowid, old.title, old.content);
      END;
      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, title, content) VALUES ('delete', old.rowid, old.title, old.content);
        INSERT INTO memory_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
      END;
    `)
    ensureColumn(this.db, 'memories', 'topic_key', "TEXT NOT NULL DEFAULT ''")
    ensureColumn(this.db, 'memories', 'status', "TEXT NOT NULL DEFAULT 'active'")
    ensureColumn(this.db, 'memories', 'superseded_by', "TEXT NOT NULL DEFAULT ''")
    ensureColumn(this.db, 'memories', 'superseded_at', 'TEXT')
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS memories_active_space_updated ON memories(space_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS memories_active_topic ON memories(space_id, status, topic_key) WHERE topic_key <> '';
    `)
    await this.ensureGlobalSpace()
    await this.ensureWorkspaceSpace(this.cwd)
    this.reconcileSupersededMemories()
  }

  dispose() {
    this.db?.close()
    this.db = null
  }

  requireDb() {
    if (!this.db) throw new Error('记忆 Runtime 尚未初始化。')
    return this.db
  }

  async ensureGlobalSpace() {
    const db = this.requireDb()
    const existing = db.prepare('SELECT id FROM memory_spaces WHERE id = ?').get('global')
    if (existing) return 'global'
    const now = new Date().toISOString()
    db.prepare('INSERT INTO memory_spaces (id, name, kind, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('global', '全局星域', 'global', '', now, now)
    return 'global'
  }

  async ensureWorkspaceSpace(cwd) {
    const rootPath = resolve(cwd || this.cwd)
    const db = this.requireDb()
    const existing = db.prepare('SELECT id FROM memory_spaces WHERE root_path = ?').get(rootPath)
    if (existing) return existing.id
    const id = stableProjectId(rootPath)
    const now = new Date().toISOString()
    db.prepare('INSERT OR IGNORE INTO memory_spaces (id, name, kind, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, basename(rootPath) || rootPath, 'project', rootPath, now, now)
    return id
  }

  listSpaces() {
    const rows = this.requireDb().prepare(`
      SELECT spaces.*, COUNT(CASE WHEN memories.status = 'active' THEN 1 END) AS node_count
      FROM memory_spaces spaces
      LEFT JOIN memories ON memories.space_id = spaces.id
      GROUP BY spaces.id
      ORDER BY CASE spaces.kind WHEN 'project' THEN 0 WHEN 'global' THEN 1 ELSE 2 END, spaces.updated_at DESC
    `).all()
    return rows.map(rowSpace)
  }

  createSpace(input = {}) {
    const name = cleanText(input.name, 80)
    if (!name) throw new Error('星域名称不能为空。')
    const kind = MEMORY_SCOPES.has(input.kind) ? input.kind : 'custom'
    const rootPath = kind === 'project' && input.rootPath ? resolve(String(input.rootPath)) : ''
    const id = randomUUID()
    const now = new Date().toISOString()
    try {
      this.requireDb().prepare('INSERT INTO memory_spaces (id, name, kind, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, name, kind, rootPath, now, now)
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new Error('该工作目录已经存在星域。')
      throw error
    }
    return this.getSpace(id)
  }

  getSpace(id) {
    const row = this.requireDb().prepare(`
      SELECT spaces.*, COUNT(CASE WHEN memories.status = 'active' THEN 1 END) AS node_count
      FROM memory_spaces spaces LEFT JOIN memories ON memories.space_id = spaces.id
      WHERE spaces.id = ? GROUP BY spaces.id
    `).get(id)
    return row ? rowSpace(row) : null
  }

  updateSpace(id, input = {}) {
    const current = this.getSpace(id)
    if (!current) return null
    const name = cleanText(input.name ?? current.name, 80)
    if (!name) throw new Error('星域名称不能为空。')
    const now = new Date().toISOString()
    this.requireDb().prepare('UPDATE memory_spaces SET name = ?, updated_at = ? WHERE id = ?').run(name, now, id)
    return this.getSpace(id)
  }

  deleteSpace(id) {
    const space = this.getSpace(id)
    if (!space) return false
    if (space.kind === 'global') throw new Error('全局星域不能删除。')
    return this.requireDb().prepare('DELETE FROM memory_spaces WHERE id = ?').run(id).changes > 0
  }

  getMemory(id) {
    return rowMemory(this.requireDb().prepare('SELECT * FROM memories WHERE id = ?').get(id))
  }

  listMemories({ spaceId, query = '', limit = 100 } = {}) {
    const db = this.requireDb()
    const safeLimit = Math.min(300, Math.max(1, Number(limit) || 100))
    if (!query.trim()) {
      return db.prepare("SELECT * FROM memories WHERE space_id = ? AND status = 'active' ORDER BY importance DESC, updated_at DESC LIMIT ?")
        .all(spaceId, safeLimit).map(rowMemory)
    }
    return this.search(query, { spaceIds: [spaceId], limit: safeLimit, minScore: 0.08, trackAccess: false })
  }

  listLinks(spaceId) {
    return this.requireDb().prepare(`
      SELECT links.id, links.source_id, links.target_id, links.relation, links.weight, links.created_at
      FROM memory_links links
      JOIN memories source ON source.id = links.source_id AND source.status = 'active'
      JOIN memories target ON target.id = links.target_id AND target.status = 'active'
      WHERE links.space_id = ? ORDER BY links.weight DESC
    `)
      .all(spaceId).map((row) => ({
        id: row.id,
        sourceId: row.source_id,
        targetId: row.target_id,
        relation: row.relation,
        weight: Number(row.weight),
        createdAt: row.created_at,
      }))
  }

  getDashboard({ spaceId = '', query = '' } = {}) {
    const spaces = this.listSpaces()
    const selectedSpaceId = spaces.some((space) => space.id === spaceId) ? spaceId : (spaces[0]?.id || '')
    return {
      spaces,
      selectedSpaceId,
      nodes: selectedSpaceId ? this.listMemories({ spaceId: selectedSpaceId, query }) : [],
      links: selectedSpaceId ? this.listLinks(selectedSpaceId) : [],
    }
  }

  refreshRelatedLinks(id, spaceId, vector) {
    const db = this.requireDb()
    db.prepare('DELETE FROM memory_links WHERE source_id = ? OR target_id = ?').run(id, id)
    const related = db.prepare("SELECT id, embedding FROM memories WHERE space_id = ? AND status = 'active' AND id <> ?").all(spaceId, id)
      .map((row) => ({ row, score: cosineSimilarity(vector, embeddingFromBuffer(row.embedding)) }))
      .filter((item) => item.score >= 0.32)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3)
    const now = new Date().toISOString()
    const insertLink = db.prepare('INSERT OR IGNORE INTO memory_links (id, space_id, source_id, target_id, relation, weight, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    for (const item of related) insertLink.run(randomUUID(), spaceId, id, item.row.id, 'related', item.score, now)
  }

  remember(input = {}) {
    const db = this.requireDb()
    const title = redactSecrets(cleanText(input.title, 140))
    const content = redactSecrets(cleanText(input.content, 12_000))
    if (!title || !content) throw new Error('星辰名称和星忆内容不能为空。')
    const spaceId = String(input.spaceId || '')
    if (!this.getSpace(spaceId)) throw new Error('星域不存在。')
    const type = MEMORY_TYPES.has(input.type) ? input.type : 'concept'
    const importance = Math.min(1, Math.max(0, Number(input.importance ?? 0.5)))
    const topicIsExplicit = Boolean(cleanText(input.topicKey || input.topic, 180))
    const topicKey = normalizeTopicKey(input.topicKey || input.topic || title)
    const vector = localEmbedding(`${title}\n${content}`)
    const existingRows = db.prepare("SELECT * FROM memories WHERE space_id = ? AND status = 'active'").all(spaceId)
    let duplicate = existingRows.find((row) => row.title.trim().toLowerCase() === title.toLowerCase())
    if (!duplicate) {
      duplicate = existingRows
        .map((row) => ({ row, score: cosineSimilarity(vector, embeddingFromBuffer(row.embedding)) }))
        .filter((item) => item.score >= 0.94)
        .sort((left, right) => right.score - left.score)[0]?.row
    }
    const now = new Date().toISOString()
    if (duplicate && input.dedupe !== false) {
      db.prepare(`
        UPDATE memories SET title = ?, content = ?, type = ?, source_type = ?, source_id = ?, source_path = ?,
          session_id = ?, cwd = ?, importance = ?, embedding = ?, topic_key = ?, updated_at = ? WHERE id = ?
      `).run(
        title, content, type, cleanText(input.sourceType || duplicate.source_type, 40), cleanText(input.sourceId, 180),
        cleanText(input.sourcePath, 1000), cleanText(input.sessionId, 100), cleanText(input.cwd, 1000),
        Math.max(importance, Number(duplicate.importance || 0)), embeddingBuffer(vector), topicKey, now, duplicate.id,
      )
      this.refreshRelatedLinks(duplicate.id, spaceId, vector)
      this.supersedeConflicts({ replacementId: duplicate.id, spaceId, title, content, type, topicKey, topicIsExplicit, existingRows })
      return this.getMemory(duplicate.id)
    }
    const id = randomUUID()
    db.prepare(`
      INSERT INTO memories (id, space_id, title, content, type, source_type, source_id, source_path, session_id, cwd,
        importance, embedding, topic_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, spaceId, title, content, type, cleanText(input.sourceType || 'manual', 40), cleanText(input.sourceId, 180),
      cleanText(input.sourcePath, 1000), cleanText(input.sessionId, 100), cleanText(input.cwd, 1000), importance,
      embeddingBuffer(vector), topicKey, now, now,
    )
    this.refreshRelatedLinks(id, spaceId, vector)
    this.supersedeConflicts({ replacementId: id, spaceId, title, content, type, topicKey, topicIsExplicit, existingRows })
    db.prepare('UPDATE memory_spaces SET updated_at = ? WHERE id = ?').run(now, spaceId)
    return this.getMemory(id)
  }

  supersedeConflicts({ replacementId, spaceId, title, content, type, topicKey, topicIsExplicit = false, existingRows }) {
    if (!REPLACEABLE_MEMORY_TYPES.has(type)) return []
    const replacementText = `${title}\n${content}`
    const hasReplacementSignal = isReplacementStatement(replacementText)
    const titleVector = localEmbedding(title)
    const conflicts = existingRows.filter((row) => {
      if (row.id === replacementId || row.status !== 'active' || row.type !== type) return false
      if (topicKey && row.topic_key && topicKey === row.topic_key) return true
      const titleSimilarity = Math.max(0, cosineSimilarity(titleVector, localEmbedding(row.title)))
      const lexicalSimilarity = Math.max(keywordOverlap(title, row.title), keywordOverlap(row.title, title))
      if (topicIsExplicit && (titleSimilarity >= 0.58 || lexicalSimilarity >= 0.5)) return true
      if (!hasReplacementSignal) return false
      return titleSimilarity >= 0.48 || lexicalSimilarity >= 0.5
    })
    if (!conflicts.length) return []
    const db = this.requireDb()
    const supersededAt = new Date().toISOString()
    const update = db.prepare("UPDATE memories SET status = 'superseded', superseded_by = ?, superseded_at = ? WHERE id = ? AND status = 'active'")
    const deleteLinks = db.prepare('DELETE FROM memory_links WHERE source_id = ? OR target_id = ?')
    const insertLink = db.prepare('INSERT OR IGNORE INTO memory_links (id, space_id, source_id, target_id, relation, weight, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    for (const conflict of conflicts) {
      update.run(replacementId, supersededAt, conflict.id)
      deleteLinks.run(conflict.id, conflict.id)
      insertLink.run(randomUUID(), spaceId, replacementId, conflict.id, 'supersedes', 1, supersededAt)
    }
    return conflicts.map((row) => row.id)
  }

  reconcileSupersededMemories() {
    const db = this.requireDb()
    const replacements = db.prepare(`
      SELECT rowid AS memory_rowid, * FROM memories
      WHERE status = 'active' AND type IN ('preference', 'decision', 'fact', 'task')
      ORDER BY rowid ASC
    `).all().filter((row) => (
      isReplacementStatement(`${row.title}\n${row.content}`)
      || (row.topic_key && row.topic_key !== normalizeTopicKey(row.title))
    ))
    for (const replacement of replacements) {
      const existingRows = db.prepare(`
        SELECT * FROM memories
        WHERE space_id = ? AND type = ? AND status = 'active' AND rowid < ?
      `).all(replacement.space_id, replacement.type, replacement.memory_rowid)
      this.supersedeConflicts({
        replacementId: replacement.id,
        spaceId: replacement.space_id,
        title: replacement.title,
        content: replacement.content,
        type: replacement.type,
        topicKey: replacement.topic_key || '',
        topicIsExplicit: Boolean(replacement.topic_key && replacement.topic_key !== normalizeTopicKey(replacement.title)),
        existingRows,
      })
    }
  }

  updateMemory(id, input = {}) {
    const current = this.getMemory(id)
    if (!current) return null
    const nextSpaceId = input.spaceId || current.spaceId
    if (!this.getSpace(nextSpaceId)) throw new Error('星域不存在。')
    const title = redactSecrets(cleanText(input.title ?? current.title, 140))
    const content = redactSecrets(cleanText(input.content ?? current.content, 12_000))
    if (!title || !content) throw new Error('星辰名称和星忆内容不能为空。')
    const type = MEMORY_TYPES.has(input.type) ? input.type : current.type
    const importance = Math.min(1, Math.max(0, Number(input.importance ?? current.importance)))
    const topicIsExplicit = Boolean(cleanText(input.topicKey || input.topic, 180))
    const topicKey = normalizeTopicKey(input.topicKey || input.topic || current.topicKey || title)
    const now = new Date().toISOString()
    const db = this.requireDb()
    const existingRows = db.prepare("SELECT * FROM memories WHERE space_id = ? AND status = 'active' AND id <> ?").all(nextSpaceId, id)
    const vector = localEmbedding(`${title}\n${content}`)
    db.prepare(`
      UPDATE memories SET space_id = ?, title = ?, content = ?, type = ?, source_path = ?, importance = ?, embedding = ?,
        topic_key = ?, status = 'active', superseded_by = '', superseded_at = NULL, updated_at = ? WHERE id = ?
    `).run(nextSpaceId, title, content, type, cleanText(input.sourcePath ?? current.sourcePath, 1000), importance, embeddingBuffer(vector), topicKey, now, id)
    this.refreshRelatedLinks(id, nextSpaceId, vector)
    this.supersedeConflicts({ replacementId: id, spaceId: nextSpaceId, title, content, type, topicKey, topicIsExplicit, existingRows })
    return this.getMemory(id)
  }

  forget(id) {
    return this.requireDb().prepare('DELETE FROM memories WHERE id = ?').run(id).changes > 0
  }

  search(query, { cwd = '', spaceIds = null, limit = 6, minScore = 0.12, trackAccess = true } = {}) {
    const text = cleanText(query, 4000)
    if (!text) return []
    let ids = Array.isArray(spaceIds) ? spaceIds.filter(Boolean) : ['global']
    if (!spaceIds && cwd) ids.push(stableProjectId(cwd))
    ids = [...new Set(ids)]
    if (!ids.length) return []
    const placeholders = ids.map(() => '?').join(',')
    const db = this.requireDb()
    const rows = db.prepare(`SELECT * FROM memories WHERE status = 'active' AND space_id IN (${placeholders})`).all(...ids)
    const ftsQuery = (text.match(/[\p{L}\p{N}_-]+/gu) || []).slice(0, 12).map((token) => `"${token.replaceAll('"', '""')}"`).join(' OR ')
    const ftsMatches = new Set()
    if (ftsQuery) {
      try {
        const matches = db.prepare(`
          SELECT memories.id FROM memory_fts JOIN memories ON memories.rowid = memory_fts.rowid
          WHERE memory_fts MATCH ? AND memories.status = 'active' AND memories.space_id IN (${placeholders}) LIMIT 100
        `).all(ftsQuery, ...ids)
        for (const match of matches) ftsMatches.add(match.id)
      } catch {
        // Local vector and keyword scoring remain available for malformed FTS queries.
      }
    }
    const queryVector = localEmbedding(text)
    const now = Date.now()
    const ranked = rows.map((row) => {
      const vectorScore = Math.max(0, cosineSimilarity(queryVector, embeddingFromBuffer(row.embedding)))
      const lexicalScore = keywordOverlap(text, `${row.title}\n${row.content}`)
      const ageDays = Math.max(0, (now - new Date(row.updated_at).getTime()) / 86_400_000)
      const recency = Math.exp(-ageDays / 120)
      const relevance = vectorScore * 0.7 + lexicalScore * 0.2 + (ftsMatches.has(row.id) ? 0.1 : 0)
      const score = relevance * 0.78 + Number(row.importance || 0.5) * 0.1 + recency * 0.12
      return { ...rowMemory(row), score, relevance }
    }).filter((item) => item.relevance >= minScore).sort((left, right) => right.score - left.score).slice(0, Math.min(30, Math.max(1, Number(limit) || 6)))
    if (trackAccess && ranked.length) {
      const accessedAt = new Date().toISOString()
      const update = db.prepare('UPDATE memories SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?')
      for (const item of ranked) update.run(accessedAt, item.id)
    }
    return ranked
  }

  async relevantContext(query, cwd, limit = 6) {
    await this.ensureWorkspaceSpace(cwd)
    const memories = this.search(query, { cwd, limit })
    if (!memories.length) return { text: '', memories: [] }
    const lines = memories.map((memory) => `- [${memory.type}] ${memory.title}：${memory.content.slice(0, 900)}`)
    return {
      text: `长期记忆（可能相关，仅作为背景；若与用户当前要求冲突，以当前要求为准）：\n${lines.join('\n')}`,
      memories,
    }
  }
}

export { stableProjectId }
