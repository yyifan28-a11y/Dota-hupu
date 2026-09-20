import { createServer } from "node:http";
import { open, readFile, writeFile, unlink } from "node:fs/promises";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import crypto from "node:crypto";
import * as XLSX from "xlsx";
import sharp from "sharp";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DOTA_ABILITY_IDS = loadDotaAbilityIds();
const ENV = globalThis.process?.env || {};
const PORT = Number(ENV.PORT || 3000);
const ADMIN_PASSWORD = ENV.ADMIN_PASSWORD || "admin123";
const DB_PATHS = getDatabasePaths();
const HIGHLIGHT_UPLOAD_DIR = resolveDatabasePath(ENV.HIGHLIGHT_UPLOAD_DIR || join(dirname(DB_PATHS.s3), "uploads", "highlights"));
const MAX_HIGHLIGHT_UPLOAD_BYTES = 10 * 1024 * 1024;
const REPLAY_UPLOAD_DIR = isAbsolute(ENV.REPLAY_UPLOAD_DIR || "")
  ? ENV.REPLAY_UPLOAD_DIR
  : join(tmpdir(), ENV.REPLAY_UPLOAD_DIR || "dota-replay-imports");
const REPLAY_PARSER_PATH = join(__dirname, "scripts", "parse-dota-replay.py");
const LOCAL_REPLAY_PYTHON = globalThis.process.platform === "win32"
  ? join(__dirname, ".venv", "Scripts", "python.exe")
  : join(__dirname, ".venv", "bin", "python");
const REPLAY_PYTHON = ENV.REPLAY_PYTHON
  || (existsSync(LOCAL_REPLAY_PYTHON) ? LOCAL_REPLAY_PYTHON : (globalThis.process.platform === "win32" ? "python" : "python3"));
const MAX_REPLAY_UPLOAD_BYTES = Math.max(1, Number(ENV.REPLAY_MAX_BYTES || 200 * 1024 * 1024));
const MAX_REPLAY_JOBS = Math.max(1, Number(ENV.REPLAY_MAX_JOBS || 3));
const WHO_GAME_FIRST_DAY_LIMIT = 3;
const WHO_GAME_RETURNING_DAY_LIMIT = 2;
const WHO_GAME_DAILY_POWERUP_LIMIT = 3;
const WHO_GAME_POWERUP_UNLOCK_PHRASE = "板神板神，勇猛超神";
const WHO_GAME_ATTEMPT_LIMIT = 3;
const WHO_GAME_CLUE_COUNT = 5;
const WHO_GAME_CORRECT_SCORE = 100;
const WHO_GAME_UNUSED_ATTEMPT_SCORE = 20;
const WHO_GAME_UNSEEN_CLUE_SCORE = 10;
const WHO_GAME_QUESTIONS = [
  { key: "curated-ldxy-01", targetName: "ldxy" },
  { key: "curated-xiaohai-01", targetName: "小孩" },
  { key: "curated-coach-01", targetName: "教练" },
  { key: "curated-boyang-01", targetName: "博洋" },
  { key: "curated-xinq-01", targetName: "xinq" },
  { key: "curated-preview-robot-01", targetName: "机器人" },
  { key: "curated-preview-guanyu-01", targetName: "关羽" },
  { key: "curated-preview-xian-01", targetName: "xian" },
  { key: "curated-d-01", targetName: "D" },
  { key: "curated-zhuzhu-01", targetName: "猪猪" }
];
const WHO_GAME_QUESTION_KEYS = WHO_GAME_QUESTIONS.map((question) => question.key);
const WHO_GAME_POWERUP_TYPES = ["eliminate", "attempts", "extraClue"];
const REPLAY_PARSE_TIMEOUT_MS = Math.max(30_000, Number(ENV.REPLAY_PARSE_TIMEOUT_MS || 5 * 60 * 1000));
let highlightUploadBusy = false;
let replayParseBusy = false;
const replayJobs = new Map();
const replayQueue = [];
mkdirSync(HIGHLIGHT_UPLOAD_DIR, { recursive: true });
mkdirSync(REPLAY_UPLOAD_DIR, { recursive: true });
Object.values(DB_PATHS).forEach((path) => mkdirSync(dirname(path), { recursive: true }));
const databases = {
  s2: new DatabaseSync(DB_PATHS.s2),
  s3: new DatabaseSync(DB_PATHS.s3)
};
// Homepage artwork is temporarily shared by both seasons. Keep the existing S3
// records as the single source of truth while player and match data stay isolated.
const sharedHomepageDatabase = databases.s3;
const databaseContext = new AsyncLocalStorage();
const db = new Proxy({}, {
  get(_target, property) {
    const database = databaseContext.getStore()?.database || databases.s3;
    const value = database[property];
    return typeof value === "function" ? value.bind(database) : value;
  }
});

const defaultPlayers = [
  ["Ame", "", 7.2, "后期大核"],
  ["Maybe", "", 7.4, "中单节奏"],
  ["Faith_bian", "", 7.0, "团战发动机"],
  ["XinQ", "", 7.1, "游走"],
  ["y", "", 6.9, "指挥"],
  ["Monet", "", 7.0, ""],
  ["Ori", "", 6.9, ""],
  ["JT", "", 6.8, ""],
  ["fy", "", 6.9, ""],
  ["Dy", "", 6.7, ""]
];

const defaultHomepageHighlights = [
  {
    date: "2026-05-17",
    matchNo: 2,
    matchId: "8814798529",
    playerName: "xian",
    hero: "帕克",
    image: "./assets/highlights/puck-1.png",
    objectPosition: "50% 47%",
    layout: "image-right",
    fallback: { winner: "dire", kills: 17, deaths: 4, assists: 25, damage: 79885, participation: 0.857, gpm: 737 }
  },
  {
    date: "2026-05-14",
    matchNo: 3,
    matchId: "8810694716",
    playerName: "ldxy",
    hero: "灰烬之灵",
    image: "./assets/highlights/ember-spirit-ldxy-2026-05-14-03-v8.webp",
    objectPosition: "50% 28%",
    layout: "image-left",
    fallback: { winner: "radiant", kills: 16, deaths: 3, assists: 16, damage: 46228, participation: 0.762, gpm: 686 }
  }
];

databaseContext.run({ season: "s2", database: databases.s2 }, () => initDatabase({ seedDefaults: false }));
databaseContext.run({ season: "s3", database: databases.s3 }, () => initDatabase({ seedDefaults: false }));
bootstrapEmptyS3FromS2();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      const season = getRequestSeason(url);
      await databaseContext.run(
        { season, database: databases[season] },
        () => handleApi(request, response, url)
      );
      return;
    }

    await serveStatic(request, response, url.pathname);
  } catch (error) {
    sendJson(response, Number(error.statusCode) || 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Dota2 inhouse tool running at http://localhost:${PORT}`);
  console.log(`S2 SQLite database: ${DB_PATHS.s2}`);
  console.log(`S3 SQLite database: ${DB_PATHS.s3}`);
});

function resolveDatabasePath(configuredPath) {
  return isAbsolute(configuredPath) ? configuredPath : join(__dirname, configuredPath);
}

function getDatabasePaths() {
  // Existing deployments commonly point DATABASE_PATH at the S2 database.
  // Keep that contract, and place S3 beside it unless explicitly configured.
  const legacyS2Path = ENV.DATABASE_PATH || ENV.SQLITE_PATH || "dota.db";
  const s2 = resolveDatabasePath(ENV.S2_DATABASE_PATH || legacyS2Path);
  const s3 = resolveDatabasePath(ENV.S3_DATABASE_PATH || join(dirname(s2), "dota-s3.db"));
  return { s2, s3 };
}

function getRequestSeason(url) {
  return String(url.searchParams.get("season") || "s3").toLowerCase() === "s2" ? "s2" : "s3";
}

function getActiveSeason() {
  return databaseContext.getStore()?.season || "s3";
}

function initDatabase({ seedDefaults = false } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      steam_id TEXT DEFAULT '',
      rating REAL DEFAULT 5,
      rating_updated_at TEXT NOT NULL,
      note TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      match_no INTEGER DEFAULT 1,
      match_id TEXT DEFAULT '',
      winner TEXT NOT NULL CHECK (winner IN ('radiant', 'dire')),
      score TEXT DEFAULT '',
      note TEXT DEFAULT '',
      radiant TEXT NOT NULL,
      dire TEXT NOT NULL,
      positions TEXT DEFAULT '{}',
      player_details TEXT DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS match_analyses (
      match_id TEXT PRIMARY KEY,
      parser TEXT DEFAULT '',
      parser_version TEXT DEFAULT '',
      analysis TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rating_snapshots (
      date TEXT NOT NULL,
      player_id TEXT NOT NULL,
      rating REAL NOT NULL,
      source TEXT DEFAULT 'manual',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (date, player_id)
    );

    CREATE TABLE IF NOT EXISTS player_steam_accounts (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL,
      steam_id TEXT NOT NULL UNIQUE,
      game_name TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_seen_at TEXT DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS player_steam_accounts_player_id
    ON player_steam_accounts (player_id);

    CREATE TABLE IF NOT EXISTS homepage_highlights (
      id TEXT PRIMARY KEY,
      match_record_id TEXT DEFAULT '',
      player_id TEXT DEFAULT '',
      date TEXT NOT NULL,
      match_no INTEGER NOT NULL DEFAULT 1,
      match_id TEXT DEFAULT '',
      player_name TEXT NOT NULL,
      hero TEXT NOT NULL,
      caption TEXT NOT NULL DEFAULT '',
      image TEXT NOT NULL,
      object_position TEXT NOT NULL DEFAULT '50% 47%',
      framing TEXT NOT NULL DEFAULT '{}',
      layout TEXT NOT NULL DEFAULT 'image-right' CHECK (layout IN ('image-left', 'image-right')),
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      fallback TEXT NOT NULL DEFAULT '{}',
      published_at TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS who_game_daily_sessions (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL,
      play_date TEXT NOT NULL,
      slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 3),
      question_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'playing' CHECK (status IN ('playing', 'won', 'lost')),
      revealed INTEGER NOT NULL DEFAULT 1,
      wrong_guesses TEXT NOT NULL DEFAULT '[]',
      score INTEGER NOT NULL DEFAULT 1000,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT DEFAULT '',
      UNIQUE (player_id, play_date, slot),
      UNIQUE (player_id, play_date, question_key)
    );

    CREATE INDEX IF NOT EXISTS who_game_daily_sessions_player_date
    ON who_game_daily_sessions (player_id, play_date);

    CREATE TABLE IF NOT EXISTS who_game_powerup_uses (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL,
      play_date TEXT NOT NULL,
      session_id TEXT NOT NULL,
      powerup_type TEXT NOT NULL,
      result TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      UNIQUE (session_id, powerup_type)
    );

    CREATE INDEX IF NOT EXISTS who_game_powerup_uses_player_date
    ON who_game_powerup_uses (player_id, play_date);

    CREATE TABLE IF NOT EXISTS who_game_powerup_unlocks (
      player_id TEXT NOT NULL,
      play_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (player_id, play_date)
    );

    CREATE TABLE IF NOT EXISTS who_game_unlimited_players (
      player_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
  `);

  addColumnIfMissing("players", "rating", "REAL DEFAULT 5");
  addColumnIfMissing("players", "rating_updated_at", "TEXT DEFAULT ''");
  addColumnIfMissing("matches", "positions", "TEXT DEFAULT '{}'");
  addColumnIfMissing("matches", "player_details", "TEXT DEFAULT '{}'");
  addColumnIfMissing("matches", "match_no", "INTEGER DEFAULT 1");
  addColumnIfMissing("matches", "match_id", "TEXT DEFAULT ''");
  addColumnIfMissing("homepage_highlights", "match_record_id", "TEXT DEFAULT ''");
  addColumnIfMissing("homepage_highlights", "player_id", "TEXT DEFAULT ''");
  addColumnIfMissing("homepage_highlights", "framing", "TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing("homepage_highlights", "caption", "TEXT NOT NULL DEFAULT ''");

  const playerColumns = getColumns("players");
  if (playerColumns.includes("mmr")) {
    const migrated = db.prepare("SELECT value FROM app_state WHERE key = 'ratingMigrationFromMmrV1'").get();
    if (!migrated) {
      db.exec(`
        UPDATE players
        SET rating = CASE
          WHEN mmr IS NOT NULL AND mmr > 0 THEN MAX(0, mmr / 1000.0)
          WHEN rating IS NULL THEN 5
          ELSE rating
        END;
      `);
      db.prepare("INSERT INTO app_state (key, value) VALUES ('ratingMigrationFromMmrV1', 'done')").run();
    }
  } else {
    db.exec("UPDATE players SET rating = 5 WHERE rating IS NULL;");
  }

  db.exec(`
    UPDATE players
    SET rating_updated_at = COALESCE(NULLIF(rating_updated_at, ''), created_at, datetime('now'))
    WHERE rating_updated_at IS NULL OR rating_updated_at = '';

    UPDATE players
    SET rating = MAX(0, ROUND(rating * 2) / 2.0)
    WHERE rating IS NOT NULL;
  `);

  const legacySteamAccounts = db.prepare(`
    SELECT id AS player_id, steam_id
    FROM players
    WHERE TRIM(COALESCE(steam_id, '')) <> ''
  `).all();
  const insertLegacySteamAccount = db.prepare(`
    INSERT OR IGNORE INTO player_steam_accounts (
      id, player_id, steam_id, game_name, created_at, updated_at, last_seen_at
    ) VALUES (?, ?, ?, '', ?, ?, '')
  `);
  legacySteamAccounts.forEach((account) => {
    const now = new Date().toISOString();
    insertLegacySteamAccount.run(crypto.randomUUID(), account.player_id, String(account.steam_id).trim(), now, now);
  });

  const playerCount = db.prepare("SELECT COUNT(*) AS count FROM players").get().count;
  if (seedDefaults && playerCount === 0) {
    const insert = db.prepare(`
      INSERT INTO players (id, name, steam_id, rating, rating_updated_at, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    defaultPlayers.forEach((player) => {
      const now = new Date().toISOString();
      insert.run(crypto.randomUUID(), player[0], player[1], player[2], now, player[3], now);
    });
  }

  const state = db.prepare("SELECT value FROM app_state WHERE key = 'currentTeams'").get();
  if (!state) {
    saveTeams({ radiant: [], dire: [] });
  }

  seedHomepageHighlights();
  backfillHomepageHighlightLinks();
}

function bootstrapEmptyS3FromS2() {
  const source = databases.s2;
  const target = databases.s3;
  const targetCounts = {
    players: Number(target.prepare("SELECT COUNT(*) AS count FROM players").get().count || 0),
    matches: Number(target.prepare("SELECT COUNT(*) AS count FROM matches").get().count || 0)
  };
  if (targetCounts.players || targetCounts.matches) return;

  const rosterSnapshot = source.prepare(`
    SELECT date, COUNT(DISTINCT player_id) AS player_count
    FROM rating_snapshots
    GROUP BY date
    ORDER BY player_count DESC, date DESC
    LIMIT 1
  `).get();
  let players = rosterSnapshot?.date
    ? source.prepare(`
        SELECT DISTINCT p.id, p.name, p.steam_id, p.rating, p.rating_updated_at, p.note, p.created_at
        FROM players p
        JOIN rating_snapshots rs ON rs.player_id = p.id
        WHERE rs.date = ?
        ORDER BY p.created_at ASC
      `).all(rosterSnapshot.date)
    : [];
  if (!players.length) {
    players = source.prepare(`
      SELECT id, name, steam_id, rating, rating_updated_at, note, created_at
      FROM players
      ORDER BY created_at ASC
    `).all();
  }
  if (!players.length) return;

  const finalDate = source.prepare("SELECT MAX(date) AS date FROM rating_snapshots").get()?.date
    || new Date().toISOString().slice(0, 10);
  const playerIds = new Set(players.map((player) => player.id));
  const accounts = source.prepare(`
    SELECT id, player_id, steam_id, game_name, created_at, updated_at, last_seen_at
    FROM player_steam_accounts
    ORDER BY created_at ASC
  `).all().filter((account) => playerIds.has(account.player_id));
  const insertPlayer = target.prepare(`
    INSERT INTO players (id, name, steam_id, rating, rating_updated_at, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSnapshot = target.prepare(`
    INSERT INTO rating_snapshots (date, player_id, rating, source, created_at, updated_at)
    VALUES (?, ?, ?, 's2-final-roster', ?, ?)
  `);
  const insertAccount = target.prepare(`
    INSERT INTO player_steam_accounts (id, player_id, steam_id, game_name, created_at, updated_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const now = new Date().toISOString();
  target.exec("BEGIN");
  try {
    players.forEach((player) => {
      insertPlayer.run(
        player.id,
        player.name,
        player.steam_id || "",
        clampRating(player.rating),
        player.rating_updated_at || now,
        player.note || "",
        player.created_at || now
      );
      insertSnapshot.run(finalDate, player.id, clampRating(player.rating), now, now);
    });
    accounts.forEach((account) => insertAccount.run(
      account.id,
      account.player_id,
      account.steam_id,
      account.game_name || "",
      account.created_at || now,
      account.updated_at || now,
      account.last_seen_at || ""
    ));
    target.prepare(`
      INSERT INTO app_state (key, value)
      VALUES ('s3BootstrapFromS2V1', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(JSON.stringify({ rosterDate: rosterSnapshot?.date || "", finalDate, playerCount: players.length, createdAt: now }));
    target.exec("COMMIT");
    console.log(`S3 initialized from S2 final roster: ${players.length} players (${rosterSnapshot?.date || "current"})`);
  } catch (error) {
    target.exec("ROLLBACK");
    throw error;
  }
}

function addColumnIfMissing(table, column, definition) {
  const columns = getColumns(table);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function getColumns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name);
}

function seedHomepageHighlights() {
  if (getActiveSeason() !== "s3") return;
  const count = Number(db.prepare("SELECT COUNT(*) AS count FROM homepage_highlights").get().count || 0);
  if (count > 0) return;

  const insert = db.prepare(`
    INSERT INTO homepage_highlights (
      id, match_record_id, player_id, date, match_no, match_id, player_name, hero, caption, image, object_position,
      framing, layout, status, sort_order, fallback, published_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?, ?)
  `);
  const now = new Date().toISOString();
  defaultHomepageHighlights.forEach((highlight, index) => {
    const match = findHomepageHighlightMatch(highlight);
    const player = match ? findHomepageHighlightPlayer(match, { playerName: highlight.playerName, hero: highlight.hero }) : null;
    insert.run(
      crypto.randomUUID(),
      match?.id || "",
      player?.id || "",
      highlight.date,
      highlight.matchNo,
      highlight.matchId,
      highlight.playerName,
      highlight.hero,
      highlight.caption || "",
      highlight.image,
      highlight.objectPosition,
      JSON.stringify(normalizeHomepageHighlightFraming(highlight.framing, highlight.objectPosition)),
      highlight.layout,
      index,
      JSON.stringify(highlight.fallback || {}),
      now,
      now,
      now
    );
  });
}

function backfillHomepageHighlightLinks() {
  const rows = db.prepare("SELECT * FROM homepage_highlights WHERE match_record_id = '' OR player_id = ''").all();
  const update = db.prepare("UPDATE homepage_highlights SET match_record_id = ?, player_id = ? WHERE id = ?");
  rows.forEach((row) => {
    const highlight = mapHomepageHighlight(row);
    const match = findHomepageHighlightMatch(highlight);
    const player = match ? findHomepageHighlightPlayer(match, highlight) : null;
    if (match && player) update.run(match.id, player.id, row.id);
  });
}

async function handleApi(request, response, url) {
  const method = request.method;

  if (method === "GET" && url.pathname === "/api/who-game/state") {
    sendJson(response, 200, getWhoGameState());
    return;
  }

  if (method === "GET" && url.pathname === "/api/who-game/daily") {
    sendJson(response, 200, getWhoGameDailyStatus(url.searchParams.get("playerId")));
    return;
  }

  if (method === "GET" && url.pathname === "/api/admin/who-game") {
    if (!requireAdmin(request, response)) return;
    sendJson(response, 200, getWhoGameAdminDashboard(url.searchParams.get("date")));
    return;
  }

  if (method === "POST" && url.pathname === "/api/who-game/daily/start") {
    const body = await readJson(request);
    sendJson(response, 200, startWhoGameDailySession(body.playerId));
    return;
  }

  if (method === "PUT" && url.pathname === "/api/who-game/daily/progress") {
    const body = await readJson(request);
    sendJson(response, 200, updateWhoGameDailySession(body));
    return;
  }

  if (method === "POST" && url.pathname === "/api/who-game/daily/powerup") {
    const body = await readJson(request);
    sendJson(response, 200, useWhoGamePowerup(body));
    return;
  }

  if (method === "POST" && url.pathname === "/api/who-game/daily/powerup-unlock") {
    const body = await readJson(request);
    sendJson(response, 200, unlockWhoGamePowerups(body));
    return;
  }

  if (method === "GET" && url.pathname === "/api/state") {
    sendJson(response, 200, getState());
    return;
  }

  if (method === "GET" && url.pathname === "/api/summary") {
    sendJson(response, 200, getSummary());
    return;
  }

  if (method === "GET" && /^\/api\/matches\/[^/]+\/analysis$/.test(url.pathname)) {
    const id = decodeURIComponent(url.pathname.slice("/api/matches/".length, -"/analysis".length));
    const match = db.prepare("SELECT id FROM matches WHERE id = ?").get(id);
    if (!match) {
      sendJson(response, 404, { error: "比赛记录不存在" });
      return;
    }
    const row = db.prepare(`
      SELECT parser, parser_version AS parserVersion, analysis, updated_at AS updatedAt
      FROM match_analyses
      WHERE match_id = ?
    `).get(id);
    sendJson(response, 200, row ? normalizeReplayAnalysis({
      parser: row.parser,
      parserVersion: row.parserVersion,
      updatedAt: row.updatedAt,
      ...parseJsonObject(row.analysis)
    }) : { available: false, players: {}, timeline: {} });
    return;
  }

  const isTeamRequest = method === "POST" && ["/api/teams", "/api/teams/manual"].includes(url.pathname);

  if (method !== "GET" && !isPublicMutation(method, url.pathname) && !requireAdmin(request, response)) {
    return;
  }

  if (method === "POST" && url.pathname === "/api/admin/check") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "POST" && url.pathname === "/api/replays/preview") {
    const activeJobs = Array.from(replayJobs.values())
      .filter((job) => ["queued", "parsing"].includes(job.status)).length;
    if (activeJobs >= MAX_REPLAY_JOBS) {
      throw createHttpError(429, "录像解析队列已满，请等待当前任务完成");
    }
    if (Number(request.headers["content-length"] || 0) > MAX_REPLAY_UPLOAD_BYTES) {
      throw createHttpError(413, `录像不能超过 ${Math.round(MAX_REPLAY_UPLOAD_BYTES / 1024 / 1024)} MB`);
    }

    const jobId = crypto.randomUUID();
    const filePath = join(REPLAY_UPLOAD_DIR, `${jobId}.dem`);
    const uploaded = await streamReplayUpload(request, filePath);
    const originalName = decodeReplayFileName(request.headers["x-replay-file-name"]);
    const job = {
      id: jobId,
      season: getActiveSeason(),
      status: "queued",
      stage: "等待解析",
      originalName,
      filePath,
      bytes: uploaded.bytes,
      sha256: uploaded.sha256,
      createdAt: new Date().toISOString(),
      result: null,
      error: ""
    };
    replayJobs.set(jobId, job);
    replayQueue.push(jobId);
    void processReplayQueue();
    sendJson(response, 202, publicReplayJob(job));
    return;
  }

  if (method === "POST" && url.pathname === "/api/replays/status") {
    const body = await readJson(request);
    const job = getReplayJobForSeason(body.jobId);
    sendJson(response, 200, publicReplayJob(job, { includeResult: true }));
    return;
  }

  if (method === "POST" && url.pathname === "/api/replays/import") {
    const body = await readJson(request);
    const job = getReplayJobForSeason(body.jobId);
    if (job.status !== "ready" || !job.result) {
      throw createHttpError(409, "录像尚未解析完成");
    }
    const imported = importReplayMatch(job, body);
    job.status = "imported";
    job.stage = "已导入";
    sendJson(response, 201, { imported: 1, matchId: imported.matchId, state: getState() });
    return;
  }

  if (method === "POST" && url.pathname === "/api/homepage-highlights/upload") {
    if (highlightUploadBusy) throw createHttpError(429, "正在处理另一张图片，请稍后重试");
    if (Number(request.headers["content-length"]) > MAX_HIGHLIGHT_UPLOAD_BYTES) {
      throw createHttpError(413, "图片不能超过 10 MB");
    }
    highlightUploadBusy = true;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_HIGHLIGHT_UPLOAD_BYTES) throw createHttpError(413, "图片不能超过 10 MB");
        chunks.push(chunk);
      }
      let output;
      try {
        const source = sharp(Buffer.concat(chunks), { limitInputPixels: 40000000 });
        const metadata = await source.metadata();
        if (!["png", "jpeg", "webp"].includes(metadata.format) || (metadata.pages || 1) > 1) {
          throw new Error("Unsupported image");
        }
        output = await source.rotate().resize({ width: 3840, height: 3840, fit: "inside", withoutEnlargement: true })
          .webp({ quality: 90, effort: 4 }).toBuffer({ resolveWithObject: true });
      } catch {
        throw createHttpError(400, "请选择有效的静态 PNG、JPG 或 WebP 图片（不超过 4000 万像素）");
      }
      const filename = `${crypto.randomUUID()}.webp`;
      await writeFile(join(HIGHLIGHT_UPLOAD_DIR, filename), output.data, { flag: "wx" });
      sendJson(response, 201, { image: `/uploads/highlights/${filename}`, bytes: output.data.length,
        width: output.info.width, height: output.info.height });
    } finally {
      highlightUploadBusy = false;
    }
    return;
  }

  if (method === "POST" && url.pathname === "/api/homepage-highlights/reorder") {
    const body = await readJson(request);
    const publishedIds = getHomepageHighlights({ publishedOnly: true }).map((highlight) => highlight.id);
    const requestedIds = Array.isArray(body.ids) ? body.ids.map(String) : [];
    if (requestedIds.length !== publishedIds.length || new Set(requestedIds).size !== requestedIds.length
      || requestedIds.some((id) => !publishedIds.includes(id))) {
      sendJson(response, 400, { error: "首页图排序数据不完整" });
      return;
    }

    const updateOrder = sharedHomepageDatabase.prepare("UPDATE homepage_highlights SET sort_order = ?, updated_at = ? WHERE id = ? AND status = 'published'");
    const now = new Date().toISOString();
    sharedHomepageDatabase.exec("BEGIN");
    try {
      requestedIds.forEach((id, index) => updateOrder.run(index, now, id));
      sharedHomepageDatabase.exec("COMMIT");
    } catch (error) {
      sharedHomepageDatabase.exec("ROLLBACK");
      throw error;
    }
    sendJson(response, 200, getState());
    return;
  }

  if (method === "POST" && url.pathname === "/api/homepage-highlights") {
    const body = await readJson(request);
    const highlight = normalizeHomepageHighlight(body);
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    sharedHomepageDatabase.prepare(`
      INSERT INTO homepage_highlights (
        id, match_record_id, player_id, date, match_no, match_id, player_name, hero, caption, image, object_position,
        framing, layout, status, sort_order, fallback, published_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 0, ?, '', ?, ?)
    `).run(
      id,
      highlight.matchRecordId,
      highlight.playerId,
      highlight.date,
      highlight.matchNo,
      highlight.matchId,
      highlight.playerName,
      highlight.hero,
      highlight.caption,
      highlight.image,
      highlight.objectPosition,
      JSON.stringify(highlight.framing),
      highlight.layout,
      JSON.stringify(highlight.fallback),
      now,
      now
    );
    sendJson(response, 201, getState());
    return;
  }

  if (method === "PUT" && url.pathname.startsWith("/api/homepage-highlights/")) {
    const id = decodeURIComponent(url.pathname.replace("/api/homepage-highlights/", ""));
    const existingRow = sharedHomepageDatabase.prepare("SELECT * FROM homepage_highlights WHERE id = ?").get(id);
    if (!existingRow) {
      sendJson(response, 404, { error: "首页图记录不存在" });
      return;
    }

    const body = await readJson(request);
    const existing = mapHomepageHighlight(existingRow);
    const highlight = normalizeHomepageHighlight({ ...existing, ...body });
    const nextStatus = ["draft", "published", "archived"].includes(body.status) ? body.status : existing.status;
    const now = new Date().toISOString();
    const isNewPublish = nextStatus === "published" && existing.status !== "published";

    sharedHomepageDatabase.exec("BEGIN");
    try {
      if (isNewPublish) {
        sharedHomepageDatabase.prepare("UPDATE homepage_highlights SET sort_order = sort_order + 1 WHERE status = 'published'").run();
      }
      sharedHomepageDatabase.prepare(`
        UPDATE homepage_highlights
        SET match_record_id = ?, player_id = ?, date = ?, match_no = ?, match_id = ?, player_name = ?, hero = ?, caption = ?, image = ?,
            object_position = ?, framing = ?, layout = ?, status = ?, sort_order = ?, fallback = ?,
            published_at = ?, updated_at = ?
        WHERE id = ?
      `).run(
        highlight.matchRecordId,
        highlight.playerId,
        highlight.date,
        highlight.matchNo,
        highlight.matchId,
        highlight.playerName,
        highlight.hero,
        highlight.caption,
        highlight.image,
        highlight.objectPosition,
        JSON.stringify(highlight.framing),
        highlight.layout,
        nextStatus,
        isNewPublish ? 0 : existing.sortOrder,
        JSON.stringify(highlight.fallback),
        isNewPublish ? now : existing.publishedAt,
        now,
        id
      );
      enforceHomepageHighlightLimit(now);
      sharedHomepageDatabase.exec("COMMIT");
    } catch (error) {
      sharedHomepageDatabase.exec("ROLLBACK");
      throw error;
    }
    sendJson(response, 200, getState());
    return;
  }

  if (method === "POST" && url.pathname === "/api/players") {
    const body = await readJson(request);
    if (!body.name?.trim()) {
      sendJson(response, 400, { error: "选手昵称不能为空" });
      return;
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const rating = clampRating(body.rating);
    db.prepare(`
      INSERT INTO players (id, name, steam_id, rating, rating_updated_at, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      body.name.trim(),
      body.steamId?.trim() || "",
      rating,
      now,
      body.note?.trim() || "",
      now
    );
    upsertRatingSnapshot({ playerId: id, rating, source: "manual" });
    sendJson(response, 201, getState());
    return;
  }

  const playerSteamAccountsMatch = url.pathname.match(/^\/api\/players\/([^/]+)\/steam-accounts$/);
  if (method === "POST" && playerSteamAccountsMatch) {
    const playerId = decodeURIComponent(playerSteamAccountsMatch[1]);
    const body = await readJson(request);
    const player = db.prepare("SELECT id FROM players WHERE id = ?").get(playerId);
    if (!player) throw createHttpError(404, "选手不存在");
    linkSteamAccount({
      playerId,
      steamId: body.steamId,
      gameName: body.gameName,
      markSeen: false
    });
    sendJson(response, 200, getState());
    return;
  }

  if (method === "DELETE" && url.pathname.startsWith("/api/steam-accounts/")) {
    const accountId = decodeURIComponent(url.pathname.replace("/api/steam-accounts/", ""));
    const account = db.prepare("SELECT player_id FROM player_steam_accounts WHERE id = ?").get(accountId);
    if (!account) throw createHttpError(404, "游戏账号关联不存在");
    db.prepare("DELETE FROM player_steam_accounts WHERE id = ?").run(accountId);
    syncLegacySteamId(account.player_id);
    sendJson(response, 200, getState());
    return;
  }

  if (method === "PUT" && url.pathname.startsWith("/api/players/") && url.pathname.endsWith("/rating")) {
    const id = decodeURIComponent(url.pathname.replace("/api/players/", "").replace("/rating", ""));
    const body = await readJson(request);
    const rating = clampRating(body.rating);
    db.prepare("UPDATE players SET rating = ?, rating_updated_at = ? WHERE id = ?")
      .run(rating, new Date().toISOString(), id);
    upsertRatingSnapshot({ playerId: id, rating, source: "manual" });
    sendJson(response, 200, getState());
    return;
  }

  if (method === "DELETE" && url.pathname.startsWith("/api/players/")) {
    const id = decodeURIComponent(url.pathname.replace("/api/players/", ""));
    db.prepare("DELETE FROM player_steam_accounts WHERE player_id = ?").run(id);
    db.prepare("DELETE FROM players WHERE id = ?").run(id);
    db.prepare("DELETE FROM rating_snapshots WHERE player_id = ?").run(id);
    const teams = getTeams();
    saveTeams({
      radiant: teams.radiant.filter((playerId) => playerId !== id),
      dire: teams.dire.filter((playerId) => playerId !== id)
    });
    const playoffTeams = getPlayoffTeams();
    savePlayoffTeams(Object.fromEntries(
      Object.entries(playoffTeams).map(([team, ids]) => [team, ids.filter((playerId) => playerId !== id)])
    ));
    sendJson(response, 200, getState());
    return;
  }

  if (method === "POST" && url.pathname === "/api/teams") {
    const body = await readJson(request);
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (ids.length !== 10) {
      sendJson(response, 400, { error: "需要刚好选择 10 名选手" });
      return;
    }
    const teams = generateTeams(ids, {
      mode: body.mode || "position",
      constraints: Array.isArray(body.constraints) ? body.constraints : []
    });
    if (!teams) {
      sendJson(response, 400, {
        error: "找不到满足评分差 ≤ 1 和预设条件的对阵，请调整选手或预设。",
        details: getTeamGenerationDetails(ids, Array.isArray(body.constraints) ? body.constraints : [])
      });
      return;
    }
    saveTeams(teams);
    sendJson(response, 200, teams);
    return;
  }

  if (method === "POST" && url.pathname === "/api/teams/manual") {
    const body = await readJson(request);
    const teams = {
      radiant: Array.isArray(body.radiant) ? body.radiant : [],
      dire: Array.isArray(body.dire) ? body.dire : []
    };
    saveTeams(teams);
    sendJson(response, 200, teams);
    return;
  }

  if (method === "POST" && url.pathname === "/api/playoffs/teams") {
    const body = await readJson(request);
    sendJson(response, 200, savePlayoffTeams(body.teams || body || {}));
    return;
  }

  if (method === "POST" && url.pathname === "/api/matches") {
    const body = await readJson(request);
    const fallbackTeams = getTeams();
    const teams = {
      radiant: Array.isArray(body.radiant) ? body.radiant : fallbackTeams.radiant,
      dire: Array.isArray(body.dire) ? body.dire : fallbackTeams.dire
    };
    if (teams.radiant.length !== 5 || teams.dire.length !== 5) {
      sendJson(response, 400, { error: "请先生成完整的 5v5 队伍" });
      return;
    }

    db.prepare(`
      INSERT INTO matches (id, date, match_no, match_id, winner, score, note, radiant, dire, positions, player_details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      body.date || new Date().toISOString().slice(0, 10),
      Number(body.matchNo || 1),
      String(body.matchId || "").trim(),
      body.winner === "dire" ? "dire" : "radiant",
      body.score || "",
      body.note || "",
      JSON.stringify(teams.radiant),
      JSON.stringify(teams.dire),
      JSON.stringify(cleanPositions(body.positions || {}, teams)),
      JSON.stringify(cleanPlayerDetails(body.playerDetails || {}, teams)),
      new Date().toISOString()
    );
    sendJson(response, 201, getState());
    return;
  }

  if (method === "PUT" && url.pathname.startsWith("/api/matches/")) {
    const id = decodeURIComponent(url.pathname.replace("/api/matches/", ""));
    const body = await readJson(request);
    const existing = db.prepare("SELECT id FROM matches WHERE id = ?").get(id);
    if (!existing) {
      sendJson(response, 404, { error: "比赛记录不存在" });
      return;
    }

    const fallbackTeams = getTeams();
    const teams = {
      radiant: Array.isArray(body.radiant) ? body.radiant : fallbackTeams.radiant,
      dire: Array.isArray(body.dire) ? body.dire : fallbackTeams.dire
    };
    if (teams.radiant.length !== 5 || teams.dire.length !== 5) {
      sendJson(response, 400, { error: "请先选择完整的 5v5 队伍" });
      return;
    }

    db.prepare(`
      UPDATE matches
      SET date = ?, match_no = ?, match_id = ?, winner = ?, score = ?, note = ?, radiant = ?, dire = ?, positions = ?, player_details = ?
      WHERE id = ?
    `).run(
      body.date || new Date().toISOString().slice(0, 10),
      Number(body.matchNo || 1),
      String(body.matchId || "").trim(),
      body.winner === "dire" ? "dire" : "radiant",
      body.score || "",
      body.note || "",
      JSON.stringify(teams.radiant),
      JSON.stringify(teams.dire),
      JSON.stringify(cleanPositions(body.positions || {}, teams)),
      JSON.stringify(cleanPlayerDetails(body.playerDetails || {}, teams)),
      id
    );
    sendJson(response, 200, getState());
    return;
  }

  if (method === "DELETE" && url.pathname.startsWith("/api/matches/")) {
    const id = decodeURIComponent(url.pathname.replace("/api/matches/", ""));
    db.prepare("DELETE FROM match_analyses WHERE match_id = ?").run(id);
    db.prepare("DELETE FROM matches WHERE id = ?").run(id);
    sendJson(response, 200, getState());
    return;
  }

  if (method === "POST" && url.pathname === "/api/import") {
    const body = await readJson(request);
    if (!Array.isArray(body.players) || !Array.isArray(body.matches)) {
      sendJson(response, 400, { error: "导入数据格式不正确" });
      return;
    }

    db.exec("DELETE FROM match_analyses; DELETE FROM player_steam_accounts; DELETE FROM players; DELETE FROM matches; DELETE FROM rating_snapshots;");
    const insertPlayer = db.prepare(`
      INSERT INTO players (id, name, steam_id, rating, rating_updated_at, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    body.players.forEach((player) => {
      const now = new Date().toISOString();
      const playerId = player.id || crypto.randomUUID();
      insertPlayer.run(
        playerId,
        player.name || "未命名选手",
        player.steamId || player.steam_id || "",
        clampRating(player.rating ?? player.mmr / 1000 ?? 5),
        player.ratingUpdatedAt || player.rating_updated_at || now,
        player.note || "",
        now
      );
      const importedAccounts = Array.isArray(player.steamAccounts) && player.steamAccounts.length
        ? player.steamAccounts
        : (player.steamId || player.steam_id ? [{ steamId: player.steamId || player.steam_id, gameName: "" }] : []);
      importedAccounts.forEach((account) => linkSteamAccount({
        playerId,
        steamId: account.steamId || account.steam_id,
        gameName: account.gameName || account.game_name || "",
        markSeen: false
      }));
    });

    const insertMatch = db.prepare(`
      INSERT INTO matches (id, date, match_no, match_id, winner, score, note, radiant, dire, positions, player_details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    body.matches.forEach((match) => {
      const radiant = Array.isArray(match.radiant) ? match.radiant : [];
      const dire = Array.isArray(match.dire) ? match.dire : [];
      insertMatch.run(
        match.id || crypto.randomUUID(),
        match.date || new Date().toISOString().slice(0, 10),
        Number(match.matchNo || match.match_no || 1),
        String(match.matchId || match.match_id || "").trim(),
        match.winner === "dire" ? "dire" : "radiant",
        match.score || "",
        match.note || "",
        JSON.stringify(radiant),
        JSON.stringify(dire),
        JSON.stringify(match.positions || {}),
        JSON.stringify(match.playerDetails || match.player_details || {}),
        new Date().toISOString()
      );
    });

    if (Array.isArray(body.ratingSnapshots)) {
      importRatingSnapshots(body.ratingSnapshots);
    }

    if (Array.isArray(body.homepageHighlights)) {
      replaceHomepageHighlights(body.homepageHighlights);
    }

    saveTeams(body.currentTeams || { radiant: [], dire: [] });
    savePlayoffTeams(body.playoffTeams || { A: [], B: [], C: [], D: [] });
    sendJson(response, 200, getState());
    return;
  }

  if (method === "POST" && url.pathname === "/api/excel/preview") {
    const body = await readJson(request);
    const buffer = Buffer.from(String(body.fileBase64 || ""), "base64");
    if (!buffer.length) {
      sendJson(response, 400, { error: "请先选择 Excel 文件" });
      return;
    }

    sendJson(response, 200, parseExcelMatches(buffer));
    return;
  }

  if (method === "POST" && url.pathname === "/api/excel/import") {
    const body = await readJson(request);
    if (!Array.isArray(body.matches) || !body.matches.length) {
      sendJson(response, 400, { error: "没有可导入的比赛" });
      return;
    }

    const validation = validateExcelMatches(body.matches);
    if (validation.errors.length) {
      sendJson(response, 400, { error: "Excel 数据仍有错误，不能导入", details: validation.errors });
      return;
    }

    insertMatches(validation.matches);
    sendJson(response, 200, { imported: validation.matches.length, state: getState() });
    return;
  }

  if (method === "POST" && url.pathname === "/api/rating-history/preview") {
    const body = await readJson(request);
    const buffer = Buffer.from(String(body.fileBase64 || ""), "base64");
    if (!buffer.length) {
      sendJson(response, 400, { error: "璇峰厛閫夋嫨 Excel 鏂囦欢" });
      return;
    }

    sendJson(response, 200, parseRatingHistoryExcel(buffer, Number(body.year || new Date().getFullYear())));
    return;
  }

  if (method === "POST" && url.pathname === "/api/rating-history/import") {
    const body = await readJson(request);
    if (!Array.isArray(body.snapshots) || !body.snapshots.length) {
      sendJson(response, 400, { error: "娌℃湁鍙鍏ョ殑璇勫垎璁板綍" });
      return;
    }

    const result = importRatingSnapshots(body.snapshots);
    sendJson(response, 200, { ...result, state: getState() });
    return;
  }

  if (method === "POST" && url.pathname === "/api/reset") {
    db.exec("DELETE FROM match_analyses; DELETE FROM player_steam_accounts; DELETE FROM players; DELETE FROM matches; DELETE FROM rating_snapshots;");
    saveTeams({ radiant: [], dire: [] });
    savePlayoffTeams({ A: [], B: [], C: [], D: [] });
    sendJson(response, 200, getState());
    return;
  }

  sendJson(response, 404, { error: "接口不存在" });
}

function decodeReplayFileName(value) {
  try {
    return decodeURIComponent(String(value || "")).slice(0, 200) || "replay.dem";
  } catch {
    return "replay.dem";
  }
}

async function streamReplayUpload(request, filePath) {
  const file = await open(filePath, "wx");
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  let header = Buffer.alloc(0);
  try {
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > MAX_REPLAY_UPLOAD_BYTES) {
        throw createHttpError(413, `录像不能超过 ${Math.round(MAX_REPLAY_UPLOAD_BYTES / 1024 / 1024)} MB`);
      }
      if (header.length < 8) {
        header = Buffer.concat([header, chunk.subarray(0, 8 - header.length)]);
      }
      hash.update(chunk);
      await file.write(chunk);
    }
  } catch (error) {
    await file.close().catch(() => {});
    await unlink(filePath).catch(() => {});
    throw error;
  }
  await file.close();
  if (!bytes) {
    await unlink(filePath).catch(() => {});
    throw createHttpError(400, "请选择 Dota 2 录像文件");
  }
  if (!header.equals(Buffer.from("PBDEMS2\0", "ascii"))) {
    await unlink(filePath).catch(() => {});
    throw createHttpError(400, "文件不是有效的 Dota 2 Source 2 录像");
  }
  return { bytes, sha256: hash.digest("hex") };
}

function getReplayJobForSeason(jobId) {
  const job = replayJobs.get(String(jobId || ""));
  if (!job || job.season !== getActiveSeason()) {
    throw createHttpError(404, "录像解析任务不存在或已过期");
  }
  return job;
}

function publicReplayJob(job, { includeResult = false } = {}) {
  const payload = {
    jobId: job.id,
    status: job.status,
    stage: job.stage,
    fileName: job.originalName,
    bytes: job.bytes,
    createdAt: job.createdAt,
    error: job.error || ""
  };
  if (includeResult && job.result) payload.result = enrichReplayResult(job.result);
  return payload;
}

function enrichReplayResult(result) {
  const players = db.prepare("SELECT id, name FROM players ORDER BY created_at ASC").all();
  const playerById = new Map(players.map((player) => [player.id, player]));
  const bySteamId = new Map(db.prepare(`
    SELECT player_id, steam_id
    FROM player_steam_accounts
  `).all().map((account) => [String(account.steam_id), playerById.get(account.player_id)]));
  const duplicate = Boolean(result.matchId && db.prepare("SELECT id FROM matches WHERE match_id = ? LIMIT 1").get(result.matchId));
  return {
    ...result,
    duplicate,
    nextMatchNo: getNextMatchNo(result.date),
    players: result.players.map((replayPlayer) => {
      const steamMatch = bySteamId.get(String(replayPlayer.steamId || ""));
      return {
        ...replayPlayer,
        matchedPlayerId: steamMatch?.id || "",
        matchedBy: steamMatch ? "steamId" : ""
      };
    })
  };
}

function getNextMatchNo(date) {
  if (!isValidDateString(date)) return 1;
  const row = db.prepare("SELECT COALESCE(MAX(match_no), 0) + 1 AS next_match_no FROM matches WHERE date = ?").get(date);
  return Math.max(1, Number(row?.next_match_no || 1));
}

function processReplayQueue() {
  if (replayParseBusy) return;
  const jobId = replayQueue.shift();
  if (!jobId) return;
  const job = replayJobs.get(jobId);
  if (!job) {
    void processReplayQueue();
    return;
  }

  replayParseBusy = true;
  job.status = "parsing";
  job.stage = "正在解析录像";
  runReplayParser(job.filePath)
    .then((result) => {
      if (!Array.isArray(result.players) || result.players.length !== 10) {
        throw new Error(`录像只识别到 ${result.players?.length || 0} 名选手`);
      }
      job.result = result;
      job.status = "ready";
      job.stage = "解析完成，等待确认";
    })
    .catch((error) => {
      job.status = "error";
      job.stage = "解析失败";
      job.error = String(error.message || error).slice(0, 1000);
    })
    .finally(async () => {
      await unlink(job.filePath).catch(() => {});
      replayParseBusy = false;
      const cleanupTimer = setTimeout(() => replayJobs.delete(job.id), 2 * 60 * 60 * 1000);
      cleanupTimer.unref?.();
      void processReplayQueue();
    });
}

function runReplayParser(filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(REPLAY_PYTHON, [REPLAY_PARSER_PATH, filePath], {
      cwd: __dirname,
      windowsHide: true,
      shell: false,
      env: ENV
    });
    let stdout = "";
    let stderr = "";
    let failure = "";
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const timeout = setTimeout(() => {
      failure = "录像解析超过时间限制";
      child.kill();
    }, REPLAY_PARSE_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 2 * 1024 * 1024) {
        failure = "录像解析结果异常过大";
        child.kill();
      }
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 64 * 1024) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => finish(reject, new Error(`无法启动录像解析器：${error.message}`)));
    child.on("close", (code) => {
      if (failure) {
        finish(reject, new Error(failure));
        return;
      }
      if (code !== 0) {
        finish(reject, new Error(stderr.trim() || `录像解析器退出，状态码 ${code}`));
        return;
      }
      try {
        finish(resolve, JSON.parse(stdout.trim()));
      } catch {
        finish(reject, new Error("录像解析器没有返回有效结果"));
      }
    });
  });
}

function importReplayMatch(job, body) {
  const result = job.result;
  if (!result.matchId || !isValidDateString(result.date) || !["radiant", "dire"].includes(result.winner)) {
    throw createHttpError(400, "录像缺少比赛 ID、日期或胜方，不能自动导入");
  }
  if (db.prepare("SELECT id FROM matches WHERE match_id = ? LIMIT 1").get(result.matchId)) {
    throw createHttpError(409, `比赛 ID ${result.matchId} 已经导入`);
  }

  const mappings = body.playerMappings && typeof body.playerMappings === "object" ? body.playerMappings : {};
  const requestedPositions = body.positions && typeof body.positions === "object" ? body.positions : {};
  const heroNames = body.heroNames && typeof body.heroNames === "object" ? body.heroNames : {};
  const databasePlayers = db.prepare("SELECT id, name FROM players").all();
  const playerById = new Map(databasePlayers.map((player) => [player.id, player]));
  const mappedIds = result.players.map((player) => String(mappings[player.slot] || ""));
  if (mappedIds.some((id) => !playerById.has(id)) || new Set(mappedIds).size !== 10) {
    throw createHttpError(400, "请为录像中的十名玩家分别选择不同的站内选手");
  }

  for (const team of ["radiant", "dire"]) {
    const teamPositions = result.players.filter((player) => player.team === team)
      .map((player) => String(requestedPositions[player.slot] || ""));
    if (teamPositions.length !== 5 || new Set(teamPositions).size !== 5
      || teamPositions.some((position) => !["1", "2", "3", "4", "5"].includes(position))) {
      throw createHttpError(400, `${team === "radiant" ? "天辉" : "夜魇"}需要分别确认 1–5 号位`);
    }
  }

  result.players.forEach((replayPlayer) => {
    const selected = playerById.get(String(mappings[replayPlayer.slot]));
    const steamId = String(replayPlayer.steamId || "").trim();
    if (!steamId) return;
    const account = db.prepare(`
      SELECT a.player_id, p.name
      FROM player_steam_accounts a
      JOIN players p ON p.id = a.player_id
      WHERE a.steam_id = ?
    `).get(steamId);
    if (account && account.player_id !== selected.id) {
      throw createHttpError(409, `Steam ID ${steamId} 已绑定选手 ${account.name}`);
    }
  });

  const teams = {
    radiant: result.players.filter((player) => player.team === "radiant").map((player) => String(mappings[player.slot])),
    dire: result.players.filter((player) => player.team === "dire").map((player) => String(mappings[player.slot]))
  };
  const positions = {};
  const details = {};
  const teamDamage = {
    radiant: result.players.filter((player) => player.team === "radiant").reduce((sum, player) => sum + Number(player.damage || 0), 0),
    dire: result.players.filter((player) => player.team === "dire").reduce((sum, player) => sum + Number(player.damage || 0), 0)
  };
  result.players.forEach((player) => {
    const playerId = String(mappings[player.slot]);
    const teamKills = player.team === "radiant" ? Number(result.radiantScore || 0) : Number(result.direScore || 0);
    positions[playerId] = String(requestedPositions[player.slot]);
    details[playerId] = {
      hero: String(heroNames[player.slot] || player.heroSlug || "").trim(),
      position: positions[playerId],
      kills: Number(player.kills || 0),
      deaths: Number(player.deaths || 0),
      assists: Number(player.assists || 0),
      participation: teamKills ? (Number(player.kills || 0) + Number(player.assists || 0)) / teamKills : 0,
      damageShare: teamDamage[player.team] ? Number(player.damage || 0) / teamDamage[player.team] : 0,
      gpm: Number(player.gpm || 0),
      xpm: Number(player.xpm || 0),
      lastHits: Number(player.lastHits || 0),
      denies: Number(player.denies || 0),
      level: Number(player.level || 0),
      netWorth: Number(player.netWorth || 0),
      netWorth10: Number(player.netWorth10 || 0),
      damage: Number(player.damage || 0),
      buildingDamage: Number(player.buildingDamage || 0),
      damageTaken: Number(player.damageTaken || 0),
      healing: Number(player.healing || 0),
      special: "录像自动导入"
    };
  });

  const matchNo = getNextMatchNo(result.date);
  const duration = formatReplayDuration(result.durationSeconds);
  const score = `${Number(result.radiantScore || 0)}-${Number(result.direScore || 0)} / ${duration}`;
  const now = new Date().toISOString();
  const matchRecordId = crypto.randomUUID();
  db.exec("BEGIN");
  try {
    result.players.forEach((replayPlayer) => {
      const playerId = String(mappings[replayPlayer.slot]);
      const steamId = String(replayPlayer.steamId || "").trim();
      if (steamId) linkSteamAccount({
        playerId,
        steamId,
        gameName: replayPlayer.playerName,
        markSeen: true
      });
    });
    db.prepare(`
      INSERT INTO matches (id, date, match_no, match_id, winner, score, note, radiant, dire, positions, player_details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      matchRecordId,
      result.date,
      matchNo,
      result.matchId,
      result.winner,
      score,
      `录像导入：${job.originalName}`,
      JSON.stringify(teams.radiant),
      JSON.stringify(teams.dire),
      JSON.stringify(cleanPositions(positions, teams)),
      JSON.stringify(cleanPlayerDetails(details, teams)),
      now
    );
    const analysisPlayers = {};
    result.players.forEach((player) => {
      const playerId = String(mappings[player.slot]);
      analysisPlayers[playerId] = {
        slot: Number(player.slot),
        level: Number(player.level || 0),
        netWorth: Number(player.netWorth || 0),
        denies: Number(player.denies || 0),
        abilityBuild: Array.isArray(player.abilityBuild) ? player.abilityBuild : [],
        finalItems: Array.isArray(player.finalItems) ? player.finalItems : [],
        purchaseTimes: player.purchaseTimes && typeof player.purchaseTimes === "object" ? player.purchaseTimes : {},
        buffs: player.buffs && typeof player.buffs === "object" ? player.buffs : {}
      };
    });
    const analysis = {
      available: true,
      durationSeconds: Number(result.durationSeconds || 0),
      players: analysisPlayers,
      timeline: result.timeline && typeof result.timeline === "object" ? result.timeline : {}
    };
    db.prepare(`
      INSERT INTO match_analyses (match_id, parser, parser_version, analysis, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      matchRecordId,
      String(result.parser || ""),
      String(result.parserVersion || ""),
      JSON.stringify(analysis),
      now,
      now
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { id: matchRecordId, matchId: result.matchId };
}

function formatReplayDuration(value) {
  const seconds = Math.max(0, Math.round(Number(value || 0)));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function normalizeSteamId(value) {
  const steamId = String(value || "").trim();
  if (!/^\d{17}$/.test(steamId)) {
    throw createHttpError(400, "请输入 17 位 Steam ID64；好友代码或游戏昵称不能用于录像自动匹配");
  }
  return steamId;
}

function linkSteamAccount({ playerId, steamId, gameName = "", markSeen = false }) {
  const normalizedSteamId = normalizeSteamId(steamId);
  const normalizedGameName = String(gameName || "").trim().slice(0, 100);
  const existing = db.prepare(`
    SELECT id, player_id
    FROM player_steam_accounts
    WHERE steam_id = ?
  `).get(normalizedSteamId);
  if (existing && existing.player_id !== playerId) {
    const owner = db.prepare("SELECT name FROM players WHERE id = ?").get(existing.player_id);
    throw createHttpError(409, `Steam ID ${normalizedSteamId} 已绑定选手 ${owner?.name || "未知选手"}`);
  }

  const now = new Date().toISOString();
  if (existing) {
    db.prepare(`
      UPDATE player_steam_accounts
      SET game_name = CASE WHEN ? <> '' THEN ? ELSE game_name END,
          updated_at = ?,
          last_seen_at = CASE WHEN ? THEN ? ELSE last_seen_at END
      WHERE id = ?
    `).run(normalizedGameName, normalizedGameName, now, markSeen ? 1 : 0, now, existing.id);
  } else {
    db.prepare(`
      INSERT INTO player_steam_accounts (
        id, player_id, steam_id, game_name, created_at, updated_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      playerId,
      normalizedSteamId,
      normalizedGameName,
      now,
      now,
      markSeen ? now : ""
    );
  }
  syncLegacySteamId(playerId);
}

function syncLegacySteamId(playerId) {
  const firstAccount = db.prepare(`
    SELECT steam_id
    FROM player_steam_accounts
    WHERE player_id = ?
    ORDER BY created_at ASC, id ASC
    LIMIT 1
  `).get(playerId);
  db.prepare("UPDATE players SET steam_id = ? WHERE id = ?").run(firstAccount?.steam_id || "", playerId);
}

function requireAdmin(request, response) {
  if (request.headers["x-admin-password"] === ADMIN_PASSWORD) {
    return true;
  }
  sendJson(response, 401, { error: "管理员密码不正确" });
  return false;
}

function isPublicMutation(method, pathname) {
  return method === "POST" && ["/api/teams", "/api/teams/manual"].includes(pathname);
}

function getHomepageHighlights({ publishedOnly = false } = {}) {
  const where = publishedOnly ? "WHERE status = 'published'" : "";
  const limit = publishedOnly ? "LIMIT 3" : "";
  return sharedHomepageDatabase.prepare(`
    SELECT id, match_record_id, player_id, date, match_no, match_id, player_name, hero, caption, image, object_position,
           framing, layout, status, sort_order, fallback, published_at, created_at, updated_at
    FROM homepage_highlights
    ${where}
    ORDER BY
      CASE status WHEN 'published' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
      sort_order ASC,
      updated_at DESC
    ${limit}
  `).all().map(mapHomepageHighlight);
}

function clampHomepageFramingNumber(value, fallback, minimum, maximum) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(maximum, Math.max(minimum, Math.round(numeric * 100) / 100)) : fallback;
}

function normalizeHomepageHighlightFraming(input = {}, objectPosition = "50% 47%") {
  const positionMatch = String(objectPosition).trim().match(/^(\d{1,3})%\s+(\d{1,3})%$/);
  const fallback = {
    x: clampHomepageFramingNumber(positionMatch?.[1], 50, 0, 100),
    y: clampHomepageFramingNumber(positionMatch?.[2], 47, 0, 100),
    scale: 1
  };
  const source = input && typeof input === "object" ? input : {};
  const normalizeFrame = (frame, defaults) => ({
    x: clampHomepageFramingNumber(frame?.x, defaults.x, 0, 100),
    y: clampHomepageFramingNumber(frame?.y, defaults.y, 0, 100),
    scale: clampHomepageFramingNumber(frame?.scale, defaults.scale, 1, 1.4),
    textX: clampHomepageFramingNumber(frame?.textX, defaults.textX ?? 0, -40, 40),
    textY: clampHomepageFramingNumber(frame?.textY, defaults.textY ?? 0, -40, 40),
    textScale: clampHomepageFramingNumber(frame?.textScale, defaults.textScale ?? 1, 0.6, 3.2)
  });
  const desktop = normalizeFrame(source.desktop, { ...fallback, textX: 0, textY: 0, textScale: 1 });
  const legacyMobile = source.syncMobile === false ? source.mobile : desktop;
  return {
    desktop,
    desktop4k: normalizeFrame(source.desktop4k, desktop),
    ultrawide: normalizeFrame(source.ultrawide, desktop),
    mobile: normalizeFrame(source.mobile, legacyMobile || desktop)
  };
}

function mapHomepageHighlight(row) {
  const objectPosition = row.object_position || "50% 47%";
  return {
    id: row.id,
    matchRecordId: row.match_record_id || "",
    playerId: row.player_id || "",
    date: row.date,
    matchNo: Number(row.match_no || 1),
    matchId: row.match_id || "",
    playerName: row.player_name,
    hero: row.hero,
    caption: row.caption || "",
    image: row.image,
    objectPosition,
    framing: normalizeHomepageHighlightFraming(parseJsonObject(row.framing), objectPosition),
    layout: row.layout === "image-left" ? "image-left" : "image-right",
    status: ["draft", "published", "archived"].includes(row.status) ? row.status : "draft",
    sortOrder: Number(row.sort_order || 0),
    fallback: parseJsonObject(row.fallback),
    publishedAt: row.published_at || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

function normalizeHomepageHighlight(input = {}) {
  const matchRecordId = String(input.matchRecordId || "").trim();
  const playerId = String(input.playerId || "").trim();
  const linkedMatch = matchRecordId ? findHomepageHighlightMatch({ matchRecordId }) : null;
  if (matchRecordId && !linkedMatch) throw createHttpError(400, "所选比赛不存在，请重新选择");
  const linkedPlayer = linkedMatch && playerId ? findHomepageHighlightPlayer(linkedMatch, { playerId }) : null;
  if (linkedMatch && playerId && !linkedPlayer) throw createHttpError(400, "所选选手不在这场比赛的完整数据中");

  const date = String(linkedMatch?.date || input.date || "").trim();
  const playerName = String(linkedPlayer?.name || input.playerName || "").trim().slice(0, 80);
  const hero = String(linkedPlayer?.detail?.hero || input.hero || "").trim().slice(0, 80);
  const caption = String(input.caption || "").trim().slice(0, 160);
  const image = String(input.image || "").trim().replaceAll("\\", "/");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw createHttpError(400, "请选择有效的比赛日期");
  if (!playerName) throw createHttpError(400, "选手昵称不能为空");
  if (!hero) throw createHttpError(400, "英雄名称不能为空");
  const uploadedImage = /^\/uploads\/highlights\/[a-f0-9-]{36}\.webp$/.test(image);
  if (!image.startsWith("./assets/") && !image.startsWith("/assets/") && !uploadedImage) {
    throw createHttpError(400, "请先选择并上传首页图片");
  }
  if (uploadedImage && !existsSync(join(HIGHLIGHT_UPLOAD_DIR, image.split("/").pop()))) {
    throw createHttpError(400, "上传图片不存在，请重新上传");
  }

  const objectPosition = /^\d{1,3}%\s+\d{1,3}%$/.test(String(input.objectPosition || "").trim())
    ? String(input.objectPosition).trim()
    : "50% 47%";
  const framing = normalizeHomepageHighlightFraming(input.framing, objectPosition);
  const fallbackInput = input.fallback && typeof input.fallback === "object" ? { ...input.fallback } : {};
  if (linkedMatch && linkedPlayer?.detail) {
    Object.assign(fallbackInput, {
      winner: linkedMatch.winner,
      kills: Number(linkedPlayer.detail.kills || 0),
      deaths: Number(linkedPlayer.detail.deaths || 0),
      assists: Number(linkedPlayer.detail.assists || 0),
      damage: Number(linkedPlayer.detail.damage || 0),
      participation: Number(linkedPlayer.detail.participation || 0),
      gpm: Number(linkedPlayer.detail.gpm || 0)
    });
  }
  const fallback = Object.fromEntries(
    Object.entries(fallbackInput).filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
  );
  return {
    matchRecordId: linkedMatch?.id || matchRecordId,
    playerId: linkedPlayer?.id || playerId,
    date,
    matchNo: Math.max(1, Math.min(99, Number(linkedMatch?.match_no || input.matchNo || 1))),
    matchId: String(linkedMatch?.match_id || input.matchId || "").trim().slice(0, 80),
    playerName,
    hero,
    caption,
    image,
    objectPosition: `${framing.desktop.x}% ${framing.desktop.y}%`,
    framing,
    layout: input.layout === "image-left" ? "image-left" : "image-right",
    fallback
  };
}

function findHomepageHighlightMatch(highlight = {}) {
  const activeSeason = getActiveSeason();
  const seasons = [activeSeason, activeSeason === "s2" ? "s3" : "s2"];
  for (const season of seasons) {
    const sourceDatabase = databases[season];
    let match = null;
    if (highlight.matchRecordId) {
      match = sourceDatabase.prepare("SELECT * FROM matches WHERE id = ?").get(String(highlight.matchRecordId));
    } else if (highlight.matchId) {
      match = sourceDatabase.prepare("SELECT * FROM matches WHERE match_id = ? ORDER BY created_at DESC LIMIT 1")
        .get(String(highlight.matchId));
    } else if (highlight.date) {
      match = sourceDatabase.prepare("SELECT * FROM matches WHERE date = ? AND match_no = ? ORDER BY created_at DESC LIMIT 1")
        .get(String(highlight.date), Number(highlight.matchNo || 1));
    }
    if (match) return { ...match, homepageSourceSeason: season };
  }
  return null;
}

function findHomepageHighlightPlayer(match, highlight = {}) {
  const sourceDatabase = databases[match?.homepageSourceSeason] || db;
  const details = parseJsonObject(match?.player_details || match?.playerDetails);
  if (highlight.playerId && details[highlight.playerId]) {
    const player = sourceDatabase.prepare("SELECT id, name FROM players WHERE id = ?").get(String(highlight.playerId));
    return player ? { ...player, detail: details[player.id] } : null;
  }
  const players = sourceDatabase.prepare("SELECT id, name FROM players WHERE name = ? ORDER BY created_at ASC")
    .all(String(highlight.playerName || ""));
  const hero = String(highlight.hero || "").trim();
  const player = players.find((item) => details[item.id] && (!hero || String(details[item.id]?.hero || "").trim() === hero))
    || players.find((item) => details[item.id]);
  return player ? { ...player, detail: details[player.id] } : null;
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function enforceHomepageHighlightLimit(now = new Date().toISOString()) {
  const overflow = sharedHomepageDatabase.prepare(`
    SELECT id FROM homepage_highlights
    WHERE status = 'published'
    ORDER BY sort_order ASC, published_at DESC, updated_at DESC
    LIMIT -1 OFFSET 3
  `).all();
  const archive = sharedHomepageDatabase.prepare("UPDATE homepage_highlights SET status = 'archived', updated_at = ? WHERE id = ?");
  overflow.forEach(({ id }) => archive.run(now, id));
}

function replaceHomepageHighlights(highlights) {
  const insert = sharedHomepageDatabase.prepare(`
    INSERT INTO homepage_highlights (
      id, match_record_id, player_id, date, match_no, match_id, player_name, hero, caption, image, object_position,
      framing, layout, status, sort_order, fallback, published_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = new Date().toISOString();
  sharedHomepageDatabase.exec("DELETE FROM homepage_highlights");
  highlights.forEach((item, index) => {
    const highlight = normalizeHomepageHighlight(item);
    const status = ["draft", "published", "archived"].includes(item.status) ? item.status : "draft";
    insert.run(
      item.id || crypto.randomUUID(),
      highlight.matchRecordId,
      highlight.playerId,
      highlight.date,
      highlight.matchNo,
      highlight.matchId,
      highlight.playerName,
      highlight.hero,
      highlight.caption,
      highlight.image,
      highlight.objectPosition,
      JSON.stringify(highlight.framing),
      highlight.layout,
      status,
      Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index,
      JSON.stringify(highlight.fallback),
      item.publishedAt || "",
      item.createdAt || now,
      item.updatedAt || now
    );
  });
  enforceHomepageHighlightLimit(now);
}

function getState() {
  const season = getActiveSeason();
  const steamAccountsByPlayer = new Map();
  db.prepare(`
    SELECT id, player_id AS playerId, steam_id AS steamId, game_name AS gameName,
           created_at AS createdAt, updated_at AS updatedAt, last_seen_at AS lastSeenAt
    FROM player_steam_accounts
    ORDER BY created_at ASC, id ASC
  `).all().forEach((account) => {
    if (!steamAccountsByPlayer.has(account.playerId)) steamAccountsByPlayer.set(account.playerId, []);
    steamAccountsByPlayer.get(account.playerId).push(account);
  });
  return {
    season,
    seasonLabel: season.toUpperCase(),
    readOnly: false,
    players: db.prepare(`
      SELECT id, name, steam_id AS steamId, rating, rating_updated_at AS ratingUpdatedAt, note
      FROM players
      ORDER BY created_at ASC
    `).all().map((player) => ({
      ...player,
      steamAccounts: steamAccountsByPlayer.get(player.id) || []
    })),
    matches: db.prepare(`
      SELECT id, date, match_no AS matchNo, match_id AS matchId, winner, score, note, radiant, dire, positions, player_details AS playerDetails
      FROM matches
      ORDER BY created_at DESC
    `).all().map((match) => ({
      ...match,
      radiant: parseJsonArray(match.radiant),
      dire: parseJsonArray(match.dire),
      positions: parseJsonObject(match.positions),
      playerDetails: parseJsonObject(match.playerDetails)
    })),
    ratingSnapshots: db.prepare(`
      SELECT date, player_id AS playerId, rating, source, created_at AS createdAt, updated_at AS updatedAt
      FROM rating_snapshots
      ORDER BY date ASC, player_id ASC
    `).all(),
    homepageHighlights: getHomepageHighlights(),
    currentTeams: getTeams(),
    playoffTeams: getPlayoffTeams(),
    playoffTeamNames: getPlayoffTeamNames(),
    playoffResults: getPlayoffResults(),
    champion: getChampion()
  };
}

function getWhoGameState() {
  const playersById = new Map();
  const matches = [];
  const ratingSnapshots = [];

  ["s2", "s3"].forEach((season) => {
    const source = databases[season];
    source.prepare(`
      SELECT id, name, rating
      FROM players
      ORDER BY created_at ASC
    `).all().forEach((player) => {
      const current = playersById.get(player.id) || { ...player, seasons: [] };
      current.name = player.name || current.name;
      current.rating = player.rating ?? current.rating;
      if (!current.seasons.includes(season)) current.seasons.push(season);
      playersById.set(player.id, current);
    });

    source.prepare(`
      SELECT id, date, match_no AS matchNo, match_id AS matchId, winner, score,
             radiant, dire, positions, player_details AS playerDetails
      FROM matches
      ORDER BY created_at DESC
    `).all().forEach((match) => {
      matches.push({
        ...match,
        id: `${season}:${match.id}`,
        recordId: match.id,
        season,
        seasonLabel: season.toUpperCase(),
        radiant: parseJsonArray(match.radiant),
        dire: parseJsonArray(match.dire),
        positions: parseJsonObject(match.positions),
        playerDetails: parseJsonObject(match.playerDetails)
      });
    });

    source.prepare(`
      SELECT date, player_id AS playerId, rating
      FROM rating_snapshots
      ORDER BY date ASC, player_id ASC
    `).all().forEach((snapshot) => {
      ratingSnapshots.push({ ...snapshot, season });
    });
  });

  return {
    seasons: ["s2", "s3"],
    players: [...playersById.values()],
    matches,
    ratingSnapshots
  };
}

function getShanghaiDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function findWhoGamePlayer(playerId) {
  const id = String(playerId || "").trim();
  if (!id) throw createHttpError(400, "请先选择你的选手ID");
  for (const source of [databases.s3, databases.s2]) {
    const player = source.prepare("SELECT id, name FROM players WHERE id = ?").get(id);
    if (player) return player;
  }
  throw createHttpError(404, "选手ID不存在");
}

function getWhoGameQuestionOrder(playerId, playDate) {
  return [...WHO_GAME_QUESTION_KEYS].sort((left, right) => {
    const leftHash = crypto.createHash("sha256").update(`${playDate}:${playerId}:${left}`).digest("hex");
    const rightHash = crypto.createHash("sha256").update(`${playDate}:${playerId}:${right}`).digest("hex");
    return leftHash.localeCompare(rightHash);
  });
}

function mapWhoGameDailySession(row) {
  const wrongGuesses = parseJsonArray(row.wrong_guesses);
  return {
    id: row.id,
    slot: Number(row.slot),
    questionKey: row.question_key,
    status: row.status,
    revealed: Number(row.revealed),
    wrongGuesses,
    score: calculateWhoGameSessionScore(row.status, Number(row.revealed), wrongGuesses),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || ""
  };
}

function calculateWhoGameSessionScore(status, revealed, wrongGuesses = []) {
  if (status !== "won") return 0;
  const wrongGuessCount = Math.min(WHO_GAME_ATTEMPT_LIMIT, Math.max(0, wrongGuesses.length));
  const cluesUsed = Math.min(WHO_GAME_CLUE_COUNT, Math.max(1, Math.round(Number(revealed) || 1)));
  const unusedAttempts = Math.max(0, WHO_GAME_ATTEMPT_LIMIT - wrongGuessCount);
  const unseenClues = Math.max(0, WHO_GAME_CLUE_COUNT - cluesUsed);
  return WHO_GAME_CORRECT_SCORE
    + unusedAttempts * WHO_GAME_UNUSED_ATTEMPT_SCORE
    + unseenClues * WHO_GAME_UNSEEN_CLUE_SCORE;
}

function isWhoGameUnlimitedPlayer(playerId) {
  return Boolean(databases.s3.prepare(`
    SELECT player_id FROM who_game_unlimited_players WHERE player_id = ?
  `).get(playerId));
}

function getWhoGameDailyLeaderboard(playDate) {
  const players = new Map(getAllWhoGamePlayers().map((player) => [player.id, player]));
  const rows = databases.s3.prepare(`
    SELECT player_id, status, revealed, wrong_guesses, updated_at
    FROM who_game_daily_sessions
    WHERE play_date = ? AND status IN ('won', 'lost')
    ORDER BY updated_at ASC, id ASC
  `).all(playDate);
  const entries = new Map();
  rows.forEach((row) => {
    const player = players.get(row.player_id);
    if (!player) return;
    const entry = entries.get(row.player_id) || {
      playerId: row.player_id,
      playerName: player.name,
      score: 0,
      completed: 0,
      correct: 0,
      updatedAt: row.updated_at || ""
    };
    entry.score += calculateWhoGameSessionScore(
      row.status,
      Number(row.revealed),
      parseJsonArray(row.wrong_guesses)
    );
    entry.completed += 1;
    if (row.status === "won") entry.correct += 1;
    entry.updatedAt = row.updated_at || entry.updatedAt;
    entries.set(row.player_id, entry);
  });
  const sorted = [...entries.values()].sort((left, right) =>
    right.score - left.score
    || right.completed - left.completed
    || left.updatedAt.localeCompare(right.updatedAt)
    || left.playerName.localeCompare(right.playerName, "zh-CN")
  );
  let previousScore = null;
  let previousRank = 0;
  return sorted.map((entry, index) => {
    if (entry.score !== previousScore) previousRank = index + 1;
    previousScore = entry.score;
    return { ...entry, rank: previousRank };
  });
}

function getWhoGameAdminDashboard(requestedDate) {
  const playDate = String(requestedDate || "").trim() || getShanghaiDate();
  if (!isValidDateString(playDate)) throw createHttpError(400, "日期格式不正确");

  const players = getAllWhoGamePlayers();
  const playerById = new Map(players.map((player) => [player.id, player]));
  const questionByKey = new Map(WHO_GAME_QUESTIONS.map((question) => [question.key, question]));
  const firstDates = new Map(databases.s3.prepare(`
    SELECT player_id, MIN(play_date) AS first_play_date
    FROM who_game_daily_sessions
    GROUP BY player_id
  `).all().map((row) => [row.player_id, row.first_play_date || ""]));
  const totalCompleted = new Map(databases.s3.prepare(`
    SELECT player_id, COUNT(DISTINCT question_key) AS completed_count
    FROM who_game_daily_sessions
    WHERE status IN ('won', 'lost')
    GROUP BY player_id
  `).all().map((row) => [row.player_id, Number(row.completed_count) || 0]));
  const powerupCounts = new Map(databases.s3.prepare(`
    SELECT session_id, COUNT(*) AS use_count
    FROM who_game_powerup_uses
    WHERE play_date = ?
    GROUP BY session_id
  `).all(playDate).map((row) => [row.session_id, Number(row.use_count) || 0]));
  const attemptBonuses = new Map(databases.s3.prepare(`
    SELECT session_id, result
    FROM who_game_powerup_uses
    WHERE play_date = ? AND powerup_type = 'attempts'
  `).all(playDate).map((row) => [
    row.session_id,
    Math.max(0, Number(parseJsonObject(row.result).bonus) || 0)
  ]));
  const sessionsByPlayer = new Map();
  databases.s3.prepare(`
    SELECT id, player_id, slot, question_key, status, revealed, wrong_guesses,
           created_at, updated_at, completed_at
    FROM who_game_daily_sessions
    WHERE play_date = ?
    ORDER BY player_id ASC, slot ASC
  `).all(playDate).forEach((row) => {
    const wrongGuesses = parseJsonArray(row.wrong_guesses);
    const question = questionByKey.get(row.question_key);
    const attemptLimit = WHO_GAME_ATTEMPT_LIMIT + (attemptBonuses.get(row.id) || 0);
    const attemptsUsed = row.status === "won"
      ? Math.min(attemptLimit, wrongGuesses.length + 1)
      : row.status === "lost" ? attemptLimit : wrongGuesses.length;
    const session = {
      id: row.id,
      slot: Number(row.slot),
      questionKey: row.question_key,
      answerName: question?.targetName || "未知题目",
      status: row.status,
      attemptsUsed,
      cluesUsed: Math.min(WHO_GAME_CLUE_COUNT, Math.max(1, Number(row.revealed) || 1)),
      powerupsUsed: powerupCounts.get(row.id) || 0,
      score: calculateWhoGameSessionScore(row.status, Number(row.revealed), wrongGuesses),
      updatedAt: row.updated_at || row.created_at || "",
      completedAt: row.completed_at || ""
    };
    const list = sessionsByPlayer.get(row.player_id) || [];
    list.push(session);
    sessionsByPlayer.set(row.player_id, list);
  });

  const progress = players.map((player) => {
    const sessions = sessionsByPlayer.get(player.id) || [];
    const completed = sessions.filter((session) => session.status !== "playing");
    const current = sessions.find((session) => session.status === "playing") || null;
    const firstPlayDate = firstDates.get(player.id) || "";
    const dailyLimit = !firstPlayDate || firstPlayDate === playDate
      ? WHO_GAME_FIRST_DAY_LIMIT
      : WHO_GAME_RETURNING_DAY_LIMIT;
    const score = completed.reduce((sum, session) => sum + session.score, 0);
    const correct = completed.filter((session) => session.status === "won").length;
    const lastUpdatedAt = sessions.reduce((latest, session) =>
      session.updatedAt > latest ? session.updatedAt : latest, "");
    return {
      playerId: player.id,
      playerName: player.name,
      firstPlayDate,
      dailyLimit,
      used: sessions.length,
      completed: completed.length,
      correct,
      score,
      currentSlot: current?.slot || 0,
      status: current ? "playing" : completed.length >= dailyLimit ? "complete" : sessions.length ? "between" : "not_started",
      totalCompleted: totalCompleted.get(player.id) || 0,
      questionCount: WHO_GAME_QUESTION_KEYS.length,
      lastUpdatedAt,
      sessions
    };
  }).sort((left, right) =>
    Number(Boolean(right.used)) - Number(Boolean(left.used))
    || right.score - left.score
    || right.totalCompleted - left.totalCompleted
    || left.playerName.localeCompare(right.playerName, "zh-CN")
  );

  const activePlayers = progress.filter((player) => player.used > 0);
  return {
    playDate,
    questionCount: WHO_GAME_QUESTION_KEYS.length,
    leaderboard: getWhoGameDailyLeaderboard(playDate),
    summary: {
      playersStarted: activePlayers.length,
      playersCompleted: activePlayers.filter((player) => player.status === "complete").length,
      questionsCompleted: activePlayers.reduce((sum, player) => sum + player.completed, 0),
      totalScore: activePlayers.reduce((sum, player) => sum + player.score, 0)
    },
    players: progress
  };
}

function getWhoGameDailyStatus(playerId) {
  const player = findWhoGamePlayer(playerId);
  const playDate = getShanghaiDate();
  const unlimited = isWhoGameUnlimitedPlayer(player.id);
  const sessions = databases.s3.prepare(`
    SELECT * FROM who_game_daily_sessions
    WHERE player_id = ? AND play_date = ?
    ORDER BY slot ASC
  `).all(player.id, playDate).map(mapWhoGameDailySession);
  const powerups = databases.s3.prepare(`
    SELECT id, session_id AS sessionId, powerup_type AS type, result, created_at AS createdAt
    FROM who_game_powerup_uses
    WHERE player_id = ? AND play_date = ?
    ORDER BY created_at ASC, id ASC
  `).all(player.id, playDate).map((row) => ({ ...row, result: parseJsonObject(row.result) }));
  const powerupsUnlocked = Boolean(databases.s3.prepare(`
    SELECT player_id
    FROM who_game_powerup_unlocks
    WHERE player_id = ? AND play_date = ?
  `).get(player.id, playDate));
  sessions.forEach((session) => {
    session.powerups = powerups.filter((powerup) => powerup.sessionId === session.id);
  });
  const current = sessions.find((session) => session.status === "playing") || null;
  const firstPlayDate = databases.s3.prepare(`
    SELECT MIN(play_date) AS play_date
    FROM who_game_daily_sessions
    WHERE player_id = ?
  `).get(player.id)?.play_date || "";
  const isFirstPlayDay = !firstPlayDate || firstPlayDate === playDate;
  const dailyLimit = isFirstPlayDay ? WHO_GAME_FIRST_DAY_LIMIT : WHO_GAME_RETURNING_DAY_LIMIT;
  const completedQuestionKeys = new Set(databases.s3.prepare(`
    SELECT DISTINCT question_key
    FROM who_game_daily_sessions
    WHERE player_id = ? AND status IN ('won', 'lost')
  `).all(player.id).map((row) => row.question_key));
  sessions.forEach((session) => completedQuestionKeys.add(session.questionKey));
  const questionOrder = getWhoGameQuestionOrder(player.id, playDate);
  const unseenQuestionKeys = questionOrder.filter((questionKey) => !completedQuestionKeys.has(questionKey));
  const nextQuestionKey = unseenQuestionKeys[0]
    || (unlimited && !current ? questionOrder[0] : "");
  const bankExhausted = !unlimited && !current && unseenQuestionKeys.length === 0;
  const availableSlots = Math.max(0, dailyLimit - sessions.length);
  return {
    player,
    playDate,
    unlimited,
    isFirstPlayDay,
    dailyLimit,
    used: sessions.length,
    completed: sessions.filter((session) => session.status !== "playing").length,
    remaining: unlimited && !current && sessions.length >= dailyLimit
      ? 1
      : Math.min(availableSlots, unseenQuestionKeys.length),
    bankExhausted,
    completedQuestionCount: completedQuestionKeys.size,
    questionCount: WHO_GAME_QUESTION_KEYS.length,
    leaderboard: getWhoGameDailyLeaderboard(playDate),
    powerupsUnlocked,
    powerupsUsed: powerups.length,
    powerupsRemaining: Math.max(0, WHO_GAME_DAILY_POWERUP_LIMIT - powerups.length),
    current,
    sessions,
    nextQuestionKey
  };
}

function getWhoGameQuestionConfig(questionKey) {
  const question = WHO_GAME_QUESTIONS.find((item) => item.key === questionKey);
  if (!question) throw createHttpError(404, "题目配置不存在");
  return question;
}

function getAllWhoGamePlayers() {
  const players = new Map();
  [databases.s2, databases.s3].forEach((source) => {
    source.prepare("SELECT id, name FROM players ORDER BY created_at ASC").all().forEach((player) => {
      players.set(player.id, player);
    });
  });
  return [...players.values()];
}

function findWhoGamePlayerByName(name) {
  const player = getAllWhoGamePlayers().find((item) => item.name === name);
  if (!player) throw createHttpError(404, `题目答案选手「${name}」不存在`);
  return player;
}

function getWhoGameSessionExcludedIds(session) {
  const excluded = new Set(session.wrongGuesses || []);
  (session.powerups || []).forEach((powerup) => {
    (powerup.result?.excludedIds || []).forEach((playerId) => excluded.add(playerId));
  });
  return excluded;
}

function unlockWhoGamePowerups(input = {}) {
  const player = findWhoGamePlayer(input.playerId);
  const phrase = String(input.phrase || "").trim();
  if (phrase !== WHO_GAME_POWERUP_UNLOCK_PHRASE) throw createHttpError(400, "输入内容不正确，请再试一次");
  const playDate = getShanghaiDate();
  databases.s3.prepare(`
    INSERT OR IGNORE INTO who_game_powerup_unlocks (player_id, play_date, created_at)
    VALUES (?, ?, ?)
  `).run(player.id, playDate, new Date().toISOString());
  return getWhoGameDailyStatus(player.id);
}

function getWhoGameSessionAttemptLimit(session) {
  const bonus = (session?.powerups || [])
    .filter((powerup) => powerup.type === "attempts")
    .reduce((sum, powerup) => sum + Math.max(0, Number(powerup.result?.bonus) || 0), 0);
  return WHO_GAME_ATTEMPT_LIMIT + bonus;
}

function buildWhoGameExtraClue(question) {
  const state = getWhoGameState();
  const answer = state.players.find((player) => player.name === question.targetName);
  if (!answer) throw createHttpError(404, "题目答案选手不存在");
  const appearances = state.matches
    .map((match) => ({ match, detail: match.playerDetails?.[answer.id] }))
    .filter(({ detail }) => detail && String(detail.hero || "").trim())
    .sort((left, right) =>
      left.match.season.localeCompare(right.match.season)
      || left.match.date.localeCompare(right.match.date)
      || Number(left.match.matchNo || 0) - Number(right.match.matchNo || 0)
      || left.match.id.localeCompare(right.match.id)
    );
  const selected = appearances[0];
  if (!selected) throw createHttpError(409, "这道题暂时没有可生成的比赛提示");
  const hero = String(selected.detail.hero).trim();
  const kills = Math.max(0, Number(selected.detail.kills) || 0);
  const deaths = Math.max(0, Number(selected.detail.deaths) || 0);
  const assists = Math.max(0, Number(selected.detail.assists) || 0);
  return {
    hero,
    kills,
    deaths,
    assists,
    text: `他曾在一场比赛中使用${hero}砍下 ${kills}/${deaths}/${assists}。`
  };
}

function useWhoGamePowerup(input = {}) {
  const daily = getWhoGameDailyStatus(input.playerId);
  const session = daily.current;
  if (!session || session.id !== String(input.sessionId || "")) throw createHttpError(409, "当前没有可使用道具的进行中题目");
  if (!daily.powerupsUnlocked) throw createHttpError(403, "请先输入指定内容，解锁今日超级道具");
  if (daily.powerupsRemaining <= 0) throw createHttpError(429, "今天的三次道具机会已经用完");
  const type = String(input.type || "");
  if (!WHO_GAME_POWERUP_TYPES.includes(type)) throw createHttpError(400, "未知道具类型");
  if (daily.sessions.some((item) => item.powerups.some((powerup) => powerup.type === type))) {
    throw createHttpError(409, "同一种道具每天只能使用一次");
  }

  const question = getWhoGameQuestionConfig(session.questionKey);
  const answer = findWhoGamePlayerByName(question.targetName);
  const players = getAllWhoGamePlayers();
  const excluded = getWhoGameSessionExcludedIds(session);
  let result = {};

  if (type === "eliminate") {
    const candidates = players
      .filter((player) => player.id !== answer.id && !excluded.has(player.id))
      .sort((left, right) => {
        const leftHash = crypto.createHash("sha256").update(`${session.id}:eliminate:${left.id}`).digest("hex");
        const rightHash = crypto.createHash("sha256").update(`${session.id}:eliminate:${right.id}`).digest("hex");
        return leftHash.localeCompare(rightHash);
      });
    if (candidates.length < 5) throw createHttpError(409, "剩余候选不足，无法再排除五人");
    result = { excludedIds: candidates.slice(0, 5).map((player) => player.id) };
  }

  if (type === "attempts") {
    result = { bonus: 2 };
  }

  if (type === "extraClue") {
    result = buildWhoGameExtraClue(question);
  }

  const now = new Date().toISOString();
  const useId = crypto.randomUUID();
  databases.s3.prepare(`
    INSERT INTO who_game_powerup_uses (
      id, player_id, play_date, session_id, powerup_type, result, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(useId, daily.player.id, daily.playDate, session.id, type, JSON.stringify(result), now);

  return { ...getWhoGameDailyStatus(daily.player.id), powerupResult: { id: useId, type, result } };
}

function startWhoGameDailySession(playerId) {
  let status = getWhoGameDailyStatus(playerId);
  if (status.current) return status;
  if (status.unlimited && status.used >= status.dailyLimit) {
    databases.s3.exec("BEGIN");
    try {
      databases.s3.prepare(`
        DELETE FROM who_game_powerup_uses WHERE player_id = ? AND play_date = ?
      `).run(status.player.id, status.playDate);
      databases.s3.prepare(`
        DELETE FROM who_game_daily_sessions WHERE player_id = ? AND play_date = ?
      `).run(status.player.id, status.playDate);
      databases.s3.exec("COMMIT");
    } catch (error) {
      databases.s3.exec("ROLLBACK");
      throw error;
    }
    status = getWhoGameDailyStatus(status.player.id);
  }
  if (!status.nextQuestionKey || status.bankExhausted) {
    throw createHttpError(409, "题库已做完，请等待DDD补充题库。");
  }
  if (status.used >= status.dailyLimit) {
    throw createHttpError(429, `今天的${status.dailyLimit}道题已经完成，明天再来吧`);
  }
  const now = new Date().toISOString();
  const usedSlots = new Set(status.sessions.map((session) => session.slot));
  const slot = [1, 2, 3].find((value) => !usedSlots.has(value));
  databases.s3.prepare(`
    INSERT INTO who_game_daily_sessions (
      id, player_id, play_date, slot, question_key, status, revealed,
      wrong_guesses, score, created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, 'playing', 1, '[]', 0, ?, ?, '')
  `).run(crypto.randomUUID(), status.player.id, status.playDate, slot, status.nextQuestionKey, now, now);
  return getWhoGameDailyStatus(status.player.id);
}

function updateWhoGameDailySession(input = {}) {
  const status = getWhoGameDailyStatus(input.playerId);
  const sessionId = String(input.sessionId || "").trim();
  const session = status.sessions.find((item) => item.id === sessionId);
  if (!session) throw createHttpError(404, "今日题目记录不存在");
  if (session.status !== "playing") return status;

  const nextStatus = ["playing", "won", "lost"].includes(input.status) ? input.status : "playing";
  const revealed = Math.max(1, Math.min(12, Math.round(Number(input.revealed) || 1)));
  const attemptLimit = getWhoGameSessionAttemptLimit(session);
  const wrongGuesses = Array.isArray(input.wrongGuesses)
    ? [...new Set(input.wrongGuesses.map((value) => String(value || "").trim()).filter(Boolean))].slice(0, attemptLimit)
    : [];
  const score = calculateWhoGameSessionScore(nextStatus, revealed, wrongGuesses);
  const now = new Date().toISOString();
  databases.s3.prepare(`
    UPDATE who_game_daily_sessions
    SET status = ?, revealed = ?, wrong_guesses = ?, score = ?, updated_at = ?,
        completed_at = CASE WHEN ? IN ('won', 'lost') THEN ? ELSE completed_at END
    WHERE id = ? AND player_id = ? AND play_date = ?
  `).run(
    nextStatus,
    revealed,
    JSON.stringify(wrongGuesses),
    score,
    now,
    nextStatus,
    now,
    session.id,
    status.player.id,
    status.playDate
  );
  return getWhoGameDailyStatus(status.player.id);
}

function getSummary() {
  const players = db.prepare("SELECT COUNT(*) AS count FROM players").get().count;
  const matches = db.prepare("SELECT COUNT(*) AS count FROM matches").get().count;
  const season = getActiveSeason();
  return { players, matches, season, seasonLabel: season.toUpperCase(), readOnly: false };
}

function getTeams() {
  const row = db.prepare("SELECT value FROM app_state WHERE key = 'currentTeams'").get();
  if (!row) return { radiant: [], dire: [] };
  try {
    const teams = JSON.parse(row.value);
    return {
      radiant: Array.isArray(teams.radiant) ? teams.radiant : [],
      dire: Array.isArray(teams.dire) ? teams.dire : []
    };
  } catch {
    return { radiant: [], dire: [] };
  }
}

function saveTeams(teams) {
  db.prepare(`
    INSERT INTO app_state (key, value)
    VALUES ('currentTeams', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(JSON.stringify(teams));
}

function getPlayoffTeams() {
  const row = db.prepare("SELECT value FROM app_state WHERE key = 'playoffTeams'").get();
  const empty = { A: [], B: [], C: [], D: [] };
  if (!row) return empty;
  try {
    const teams = JSON.parse(row.value);
    return {
      A: Array.isArray(teams.A) ? teams.A : [],
      B: Array.isArray(teams.B) ? teams.B : [],
      C: Array.isArray(teams.C) ? teams.C : [],
      D: Array.isArray(teams.D) ? teams.D : []
    };
  } catch {
    return empty;
  }
}

function savePlayoffTeams(teams) {
  const normalized = {
    A: Array.isArray(teams.A) ? teams.A : [],
    B: Array.isArray(teams.B) ? teams.B : [],
    C: Array.isArray(teams.C) ? teams.C : [],
    D: Array.isArray(teams.D) ? teams.D : []
  };
  db.prepare(`
    INSERT INTO app_state (key, value)
    VALUES ('playoffTeams', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(JSON.stringify(normalized));
  return normalized;
}

function getPlayoffTeamNames() {
  const row = db.prepare("SELECT value FROM app_state WHERE key = 'playoffTeamNames'").get();
  const defaults = { A: "A", B: "B", C: "C", D: "D" };
  if (!row) return defaults;
  try {
    const names = JSON.parse(row.value);
    return Object.fromEntries(
      Object.keys(defaults).map((team) => [team, String(names[team] || defaults[team])])
    );
  } catch {
    return defaults;
  }
}

function getPlayoffResults() {
  const row = db.prepare("SELECT value FROM app_state WHERE key = 'playoffResults'").get();
  const empty = { semifinals: [], final: null };
  if (!row) return empty;
  try {
    const results = JSON.parse(row.value);
    return {
      semifinals: Array.isArray(results.semifinals) ? results.semifinals : [],
      final: results.final && typeof results.final === "object" ? results.final : null
    };
  } catch {
    return empty;
  }
}

function getChampion() {
  const row = db.prepare("SELECT value FROM app_state WHERE key = 'champion'").get();
  const empty = { team: "", title: "S2 总冠军", playerIds: [], description: "" };
  if (!row) return empty;
  try {
    const champion = JSON.parse(row.value);
    return {
      team: String(champion.team || ""),
      title: String(champion.title || empty.title),
      playerIds: Array.isArray(champion.playerIds) ? champion.playerIds : [],
      description: String(champion.description || "")
    };
  } catch {
    return empty;
  }
}

function generateTeams(ids, options) {
  const state = getState();
  const candidates = getValidCandidates(ids, options.constraints, state.players);
  if (!candidates.length) return null;

  if (options.mode === "random") {
    return candidates[Math.floor(Math.random() * candidates.length)].teams;
  }

  const positionStats = getPositionTendencies(state.matches);
  const pairCounts = getPairCounts(state.matches);
  const winrates = getPlayerWinrates(state.matches);

  return candidates
    .map((candidate) => ({
      ...candidate,
      penalty: options.mode === "combination"
        ? combinationPenalty(candidate.teams, pairCounts)
        : options.mode === "winrate"
          ? winratePenalty(candidate.teams, winrates)
          : positionPenalty(candidate.teams, positionStats)
    }))
    .sort((a, b) => a.diff - b.diff || a.penalty - b.penalty)[0].teams;
}

function getValidCandidates(ids, constraints, players) {
  const normalized = [...new Set(ids)].filter((id) => players.some((player) => player.id === id));
  if (normalized.length !== 10) return [];
  const ratingById = new Map(players.map((player) => [player.id, Number(player.rating || 0)]));

  return combinations(normalized, 5)
    .map((radiant) => {
      const radiantSet = new Set(radiant);
      const dire = normalized.filter((id) => !radiantSet.has(id));
      return { radiant, dire };
    })
    .filter((teams) => satisfiesConstraints(teams, constraints))
    .map((teams) => ({ teams, diff: Math.abs(teamRating(teams.radiant, ratingById) - teamRating(teams.dire, ratingById)) }))
    .filter((candidate) => candidate.diff <= 1);
}

function getTeamGenerationDetails(ids, constraints) {
  const players = getState().players;
  const normalized = [...new Set(ids)].filter((id) => players.some((player) => player.id === id));
  if (normalized.length !== 10) {
    return {
      validPlayerCount: normalized.length,
      totalCombinations: 0,
      afterConstraints: 0,
      withinRatingLimit: 0,
      bestDiff: null
    };
  }

  const ratingById = new Map(players.map((player) => [player.id, Number(player.rating || 0)]));
  const constrained = combinations(normalized, 5)
    .map((radiant) => {
      const radiantSet = new Set(radiant);
      const dire = normalized.filter((id) => !radiantSet.has(id));
      return { radiant, dire };
    })
    .filter((teams) => satisfiesConstraints(teams, constraints))
    .map((teams) => Math.abs(teamRating(teams.radiant, ratingById) - teamRating(teams.dire, ratingById)));

  return {
    validPlayerCount: normalized.length,
    totalCombinations: 252,
    afterConstraints: constrained.length,
    withinRatingLimit: constrained.filter((diff) => diff <= 1).length,
    bestDiff: constrained.length ? Math.min(...constrained) : null
  };
}

function satisfiesConstraints(teams, constraints) {
  const radiant = new Set(teams.radiant);
  const dire = new Set(teams.dire);

  return constraints.every((item) => {
    if (!item?.a || !item?.b || item.a === item.b) return true;
    const sameTeam = (radiant.has(item.a) && radiant.has(item.b)) || (dire.has(item.a) && dire.has(item.b));
    return item.type === "opponent" ? !sameTeam : sameTeam;
  });
}

function teamRating(ids, ratingById) {
  return ids.reduce((total, id) => total + (ratingById.get(id) || 0), 0);
}

function getPlayerWinrates(matches) {
  const stats = {};
  matches.filter((match) => getMatchQuality(match) !== "draft").forEach((match) => {
    [
      ["radiant", match.radiant],
      ["dire", match.dire]
    ].forEach(([side, ids]) => {
      ids.forEach((id) => {
        stats[id] ||= { wins: 0, games: 0 };
        stats[id].games += 1;
        if (match.winner === side) stats[id].wins += 1;
      });
    });
  });

  return Object.fromEntries(
    Object.entries(stats).map(([id, item]) => [id, item.games ? item.wins / item.games : 0.5])
  );
}

function winratePenalty(teams, winrates) {
  return Math.abs(teamAverageWinrate(teams.radiant, winrates) - teamAverageWinrate(teams.dire, winrates));
}

function teamAverageWinrate(ids, winrates) {
  if (!ids.length) return 0;
  return ids.reduce((total, id) => total + (winrates[id] ?? 0.5), 0) / ids.length;
}

function combinations(items, size, start = 0, prefix = [], result = []) {
  if (prefix.length === size) {
    result.push([...prefix]);
    return result;
  }

  for (let index = start; index <= items.length - (size - prefix.length); index += 1) {
    prefix.push(items[index]);
    combinations(items, size, index + 1, prefix, result);
    prefix.pop();
  }

  return result;
}

function getPositionTendencies(matches) {
  const stats = {};
  matches.filter((match) => getMatchQuality(match) === "complete").forEach((match) => {
    const details = match.playerDetails || {};
    const positions = { ...(match.positions || {}) };
    Object.entries(details).forEach(([playerId, detail]) => {
      if (detail?.position && !positions[playerId]) positions[playerId] = detail.position;
    });
    Object.entries(positions).forEach(([playerId, position]) => {
      stats[playerId] ||= {};
      stats[playerId][position] = (stats[playerId][position] || 0) + 1;
    });
  });

  return Object.fromEntries(
    Object.entries(stats).map(([playerId, counts]) => [
      playerId,
      Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null
    ])
  );
}

function positionPenalty(teams, positionStats) {
  return duplicatePositionPenalty(teams.radiant, positionStats) + duplicatePositionPenalty(teams.dire, positionStats);
}

function duplicatePositionPenalty(ids, positionStats) {
  const counts = {};
  ids.forEach((id) => {
    const position = positionStats[id];
    if (!position) return;
    counts[position] = (counts[position] || 0) + 1;
  });
  return Object.values(counts).reduce((total, count) => total + Math.max(0, count - 1), 0);
}

function getPairCounts(matches) {
  const counts = {};
  matches.filter((match) => getMatchQuality(match) !== "draft").forEach((match) => {
    addTeamPairs(match.radiant, counts);
    addTeamPairs(match.dire, counts);
  });
  return counts;
}

function getMatchQuality(match) {
  if (!hasBasicMatchInfo(match)) return "draft";
  return hasCompletePlayerDetails(match) ? "complete" : "basic";
}

function hasBasicMatchInfo(match) {
  const scoreParts = String(match.score || "").split("/").map((part) => part.trim());
  const score = scoreParts[0] || "";
  return Boolean(
    match.date
    && Number(match.matchNo || match.match_no || 0) > 0
    && ["radiant", "dire"].includes(match.winner)
    && Array.isArray(match.radiant)
    && match.radiant.length === 5
    && Array.isArray(match.dire)
    && match.dire.length === 5
    && /^\d+\s*-\s*\d+$/.test(score)
  );
}

function hasCompletePlayerDetails(match) {
  const ids = [...(match.radiant || []), ...(match.dire || [])];
  if (ids.length !== 10) return false;

  return ids.every((playerId) => {
    const detail = match.playerDetails?.[playerId] || {};
    return Boolean(
      !isBlank(detail.hero)
      && ["1", "2", "3", "4", "5"].includes(String(detail.position || match.positions?.[playerId] || ""))
      && hasNumericDetail(detail.kills)
      && hasNumericDetail(detail.deaths)
      && hasNumericDetail(detail.assists)
      && hasNumericDetail(detail.participation)
      && hasNumericDetail(detail.damageShare)
      && hasNumericDetail(detail.gpm)
      && hasNumericDetail(detail.xpm)
      && hasNumericDetail(detail.netWorth10)
      && hasNumericDetail(detail.damage)
      && hasNumericDetail(detail.buildingDamage)
      && hasNumericDetail(detail.damageTaken)
      && hasNumericDetail(detail.healing)
    );
  });
}

function isBlank(value) {
  return String(value ?? "").trim() === "";
}

function hasNumericDetail(value) {
  if (isBlank(value)) return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0;
}

function addTeamPairs(ids, counts) {
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const key = pairKey(ids[i], ids[j]);
      counts[key] = (counts[key] || 0) + 1;
    }
  }
}

function combinationPenalty(teams, pairCounts) {
  return teamPairPenalty(teams.radiant, pairCounts) + teamPairPenalty(teams.dire, pairCounts);
}

function teamPairPenalty(ids, pairCounts) {
  let penalty = 0;
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      penalty += pairCounts[pairKey(ids[i], ids[j])] || 0;
    }
  }
  return penalty;
}

function pairKey(a, b) {
  return [a, b].sort().join("::");
}

function getTodayDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

function upsertRatingSnapshot({ playerId, rating, date = getTodayDate(), source = "manual" }) {
  if (!playerId || !isValidDateString(date)) return;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO rating_snapshots (date, player_id, rating, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, player_id) DO UPDATE SET
      rating = excluded.rating,
      source = excluded.source,
      updated_at = excluded.updated_at
  `).run(date, playerId, clampRating(rating), source, now, now);
}

function parseRatingHistoryExcel(buffer, year) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const players = getState().players;
  const playerByName = new Map(players.map((player) => [normalizeRatingHistoryPlayerName(player.name), player]));
  const sheetName = workbook.SheetNames.find((name) => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: "" });
    return rows.some((row) => row.some((cell) => normalizeName(cell) === normalizeName("选手")));
  }) || workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
  const headerIndex = rows.findIndex((row) => row.some((cell) => normalizeName(cell) === normalizeName("选手")));

  if (headerIndex < 0) {
    return {
      sheetName,
      year,
      dateColumns: [],
      snapshots: [],
      matchedPlayers: [],
      unmatchedPlayers: [],
      skippedColumns: [],
      errors: ["无法找到“选手”表头"],
      canImport: false
    };
  }

  const headers = rows[headerIndex].map((cell) => String(cell || "").trim());
  const playerColumn = headers.findIndex((header) => normalizeName(header) === normalizeName("选手"));
  const dateColumns = [];
  const skippedColumns = [];

  headers.forEach((header, index) => {
    if (index === playerColumn || !header) return;
    const date = parseRatingHistoryDateHeader(header, year);
    if (date) {
      dateColumns.push({ index, header, date });
    } else {
      skippedColumns.push(header);
    }
  });

  const initialColumn = headers.findIndex((header, index) => {
    if (index === playerColumn) return false;
    const normalized = normalizeName(header);
    return normalized.includes(normalizeName("初始工资")) || normalized === normalizeName("初始");
  });
  if (initialColumn >= 0 && dateColumns.length) {
    const firstDate = [...dateColumns].sort((a, b) => a.date.localeCompare(b.date))[0].date;
    dateColumns.unshift({
      index: initialColumn,
      header: headers[initialColumn],
      date: getPreviousDate(firstDate),
      source: "import_initial"
    });
    const skippedIndex = skippedColumns.indexOf(headers[initialColumn]);
    if (skippedIndex >= 0) skippedColumns.splice(skippedIndex, 1);
  }

  const snapshots = [];
  const matchedNames = new Set();
  const unmatchedPlayers = new Set();

  rows.slice(headerIndex + 1).forEach((row) => {
    const rawName = String(row[playerColumn] || "").trim();
    if (!rawName) return;

    const player = playerByName.get(normalizeRatingHistoryPlayerName(rawName));
    if (!player) {
      unmatchedPlayers.add(rawName);
      return;
    }

    matchedNames.add(rawName);
    dateColumns.forEach((column) => {
      const rating = parseRatingValue(row[column.index]);
      if (rating === null) return;
      snapshots.push({
        date: column.date,
        playerId: player.id,
        playerName: player.name,
        rating,
        source: column.source || "import"
      });
    });
  });

  return {
    sheetName,
    year,
    dateColumns: dateColumns.map(({ header, date }) => ({ header, date })),
    snapshots,
    matchedPlayers: [...matchedNames],
    unmatchedPlayers: [...unmatchedPlayers],
    skippedColumns,
    errors: [],
    canImport: snapshots.length > 0
  };
}

function parseRatingHistoryDateHeader(header, year) {
  const digits = String(header || "").match(/\d+/)?.[0] || "";
  if (!digits || digits.length < 3 || digits.length > 4) return "";
  const padded = digits.padStart(4, "0");
  const month = Number(padded.slice(0, 2));
  const day = Number(padded.slice(2, 4));
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getPreviousDate(date) {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

function parseRatingValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const rating = Number(value);
  if (!Number.isFinite(rating)) return null;
  return clampRating(rating);
}

function importRatingSnapshots(snapshots) {
  const validPlayers = new Set(getState().players.map((player) => player.id));
  let imported = 0;
  const skipped = [];
  const latestByPlayer = new Map();

  snapshots.forEach((snapshot, index) => {
    const playerId = String(snapshot.playerId || snapshot.player_id || "");
    const date = String(snapshot.date || "");
    const rating = parseRatingValue(snapshot.rating);
    if (!validPlayers.has(playerId)) {
      skipped.push({ index, reason: "player_not_found", playerId });
      return;
    }
    if (!isValidDateString(date)) {
      skipped.push({ index, reason: "invalid_date", date });
      return;
    }
    if (rating === null) {
      skipped.push({ index, reason: "invalid_rating", rating: snapshot.rating });
      return;
    }
    upsertRatingSnapshot({ playerId, date, rating, source: snapshot.source || "import" });
    const latest = latestByPlayer.get(playerId);
    if (!latest || date > latest.date) {
      latestByPlayer.set(playerId, { date, rating });
    }
    imported += 1;
  });

  const now = new Date().toISOString();
  latestByPlayer.forEach(({ rating }, playerId) => {
    db.prepare("UPDATE players SET rating = ?, rating_updated_at = ? WHERE id = ?")
      .run(rating, now, playerId);
  });

  return { imported, skipped };
}

function isValidDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function normalizeRatingHistoryPlayerName(value) {
  return String(value || "").trim();
}

function parseExcelMatches(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const players = getState().players;
  const playerByName = new Map(players.map((player) => [normalizeName(player.name), player]));
  const matches = [];
  const errors = [];
  const warnings = [];

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    if (!rows.length || sheetName === "选手工资") return;

    const headers = rows[0].map((value) => String(value || "").trim());
    if (!headers.includes("阵营") || !headers.includes("选手") || !headers.includes("英雄")) return;

    const records = rows.slice(1)
      .filter((row) => row.some((value) => String(value ?? "").trim() !== ""))
      .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
    const playerRecords = records.filter(isExcelPlayerRecord);

    if (playerRecords.length !== 10) {
      errors.push(`${sheetName}: 需要 10 行选手数据，当前是 ${playerRecords.length} 行`);
      return;
    }

    const parsed = parseExcelMatchSheet(sheetName, playerRecords, playerByName, records, rows.slice(1));
    parsed.match.importErrors = parsed.errors;
    parsed.match.importWarnings = parsed.warnings;
    matches.push(parsed.match);
    errors.push(...parsed.errors);
    warnings.push(...parsed.warnings);
  });

  return {
    matches,
    errors,
    warnings,
    canImport: matches.some(canImportExcelMatch)
  };
}

function canImportExcelMatch(match) {
  return !(
    (Array.isArray(match.importErrors) && match.importErrors.length)
    || (Array.isArray(match.missingPlayers) && match.missingPlayers.length)
  );
}

function isExcelPlayerRecord(record) {
  return Boolean(
    ["radiant", "dire"].includes(normalizeSide(record["阵营"]))
    && !isBlank(record["选手"])
    && !isBlank(record["英雄"])
  );
}

function parseExcelMatchSheet(sheetName, records, playerByName, allRecords = records, rawRows = []) {
  const errors = [];
  const warnings = [];
  const first = records[0] || allRecords[0] || {};
  const radiant = records.filter((record) => normalizeSide(record["阵营"]) === "radiant");
  const dire = records.filter((record) => normalizeSide(record["阵营"]) === "dire");
  const winnerRecord = allRecords.find((record) => String(record["结果"] || "").trim() === "胜");
  const winner = winnerRecord ? normalizeSide(winnerRecord["阵营"]) : "";
  const dateValue = first["日期"] || allRecords.find((record) => !isBlank(record["日期"]))?.["日期"];
  const date = normalizeExcelDate(dateValue, sheetName);
  const matchNo = Number(first["场次"] || sheetName.match(/-(\d+)$/)?.[1] || 1);
  const radiantKills = getTeamKills(allRecords.filter((record) => normalizeSide(record["阵营"]) === "radiant")) || getTeamKills(radiant);
  const direKills = getTeamKills(allRecords.filter((record) => normalizeSide(record["阵营"]) === "dire")) || getTeamKills(dire);
  const matchId = String(findExcelMetaValue(["比赛ID", "比赛 Id", "Match ID", "match_id"], allRecords, rawRows) || "").trim();
  const duration = normalizeDuration(findExcelMetaValue(["比赛时长", "时长", "比赛时间", "Duration"], allRecords, rawRows));
  const usedIds = new Set();
  const missingPlayers = [];

  if (!date) errors.push(`${sheetName}: 无法识别日期`);
  if (!winner) errors.push(`${sheetName}: 无法识别获胜方`);
  if (radiant.length !== 5 || dire.length !== 5) {
    errors.push(`${sheetName}: 天辉 ${radiant.length} 人，夜魇 ${dire.length} 人，需要各 5 人`);
  }

  const teams = {
    radiant: radiant.map((record) => getExcelPlayerId(record, playerByName, usedIds, sheetName, errors, missingPlayers)),
    dire: dire.map((record) => getExcelPlayerId(record, playerByName, usedIds, sheetName, errors, missingPlayers))
  };
  const playerDetails = {};

  [...radiant, ...dire].forEach((record) => {
    const player = playerByName.get(normalizeName(record["选手"]));
    if (!player) return;
    playerDetails[player.id] = {
      hero: String(record["英雄"] || "").trim(),
      position: normalizePosition(record["位置"]),
      kills: numberOrBlank(record["K"] ?? record["击杀"]),
      deaths: numberOrBlank(record["D"] ?? record["死亡"]),
      assists: numberOrBlank(record["A"] ?? record["助攻"]),
      participation: normalizeRatio(record["参战率"]),
      damageShare: normalizeRatio(record["输出占比"]),
      gpm: numberOrBlank(record["GPM"]),
      xpm: numberOrBlank(record["XPM"]),
      lastHits: numberOrBlank(record["正补"] ?? record["正补数"] ?? record["补刀"] ?? record["补刀数"] ?? record["LH"]),
      netWorth10: numberOrBlank(record["10分钟财产"]),
      damage: numberOrBlank(record["英雄伤害"]),
      buildingDamage: numberOrBlank(record["建筑伤害"]),
      damageTaken: numberOrBlank(record["承受伤害"] || record["承伤减免前"]),
      healing: numberOrBlank(record["治疗"]),
      special: ""
    };
  });

  if (!records.some((record) => Object.hasOwn(record, "位置"))) {
    warnings.push(`${sheetName}: Excel 没有“位置”列，导入后需要手动补 1-5 号位`);
  }
  if (missingPlayers.length) {
    warnings.push(`${sheetName}: 有未录入选手：${missingPlayers.join("、")}`);
  }

  return {
    match: {
      sheetName,
      date,
      matchNo,
      matchId,
      winner: winner || "radiant",
      score: [`${radiantKills}-${direKills}`, duration].filter(Boolean).join(" / "),
      note: `Excel导入：${sheetName}`,
      radiant: teams.radiant.filter(Boolean),
      dire: teams.dire.filter(Boolean),
      positions: {},
      playerDetails,
      missingPlayers
    },
    errors,
    warnings
  };
}

function validateExcelMatches(matches) {
  const errors = [];
  const validIds = new Set(getState().players.map((player) => player.id));
  const cleaned = [];

  matches.forEach((match, index) => {
    const label = match.sheetName || `第 ${index + 1} 场`;
    const radiant = Array.isArray(match.radiant) ? match.radiant : [];
    const dire = Array.isArray(match.dire) ? match.dire : [];
    const ids = [...radiant, ...dire];
    const importErrors = Array.isArray(match.importErrors)
      ? match.importErrors.map((error) => String(error || "").trim()).filter(Boolean)
      : [];
    const missingPlayers = Array.isArray(match.missingPlayers)
      ? match.missingPlayers.map((name) => String(name || "").trim()).filter(Boolean)
      : [];

    importErrors.forEach((error) => {
      errors.push(error);
    });
    missingPlayers.forEach((name) => {
      errors.push(`${label}: 选手不存在，请先新增：${name}`);
    });
    if (!importErrors.length && !missingPlayers.length && (radiant.length !== 5 || dire.length !== 5)) errors.push(`${label}: 需要天辉/夜魇各 5 人`);
    if (new Set(ids).size !== ids.length) errors.push(`${label}: 有重复选手`);
    ids.forEach((id) => {
      if (!validIds.has(id)) errors.push(`${label}: 选手 ID 不存在 ${id}`);
    });

    const teams = { radiant, dire };
    cleaned.push({
      date: match.date || new Date().toISOString().slice(0, 10),
      matchNo: Number(match.matchNo || 1),
      matchId: String(match.matchId || match.match_id || "").trim(),
      winner: match.winner === "dire" ? "dire" : "radiant",
      score: String(match.score || ""),
      note: String(match.note || ""),
      radiant,
      dire,
      positions: cleanPositions(match.positions || {}, teams),
      playerDetails: cleanPlayerDetails(match.playerDetails || {}, teams)
    });
  });

  return { errors, matches: cleaned };
}

function insertMatches(matches) {
  const insert = db.prepare(`
    INSERT INTO matches (id, date, match_no, match_id, winner, score, note, radiant, dire, positions, player_details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.exec("BEGIN");
  try {
    matches.forEach((match) => {
      insert.run(
        crypto.randomUUID(),
        match.date,
        match.matchNo,
        match.matchId,
        match.winner,
        match.score,
        match.note,
        JSON.stringify(match.radiant),
        JSON.stringify(match.dire),
        JSON.stringify(match.positions),
        JSON.stringify(match.playerDetails),
        new Date().toISOString()
      );
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function findExcelMetaValue(labels, records = [], rawRows = []) {
  const wanted = new Set(labels.map(normalizeExcelLabel));

  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (wanted.has(normalizeExcelLabel(key)) && !isBlank(value)) return value;
    }

    const values = Object.values(record);
    for (let index = 0; index < values.length; index += 1) {
      if (!wanted.has(normalizeExcelLabel(values[index]))) continue;
      const next = values.slice(index + 1).find((value) => !isBlank(value));
      if (!isBlank(next)) return next;
    }
  }

  for (const row of rawRows) {
    for (let index = 0; index < row.length; index += 1) {
      if (!wanted.has(normalizeExcelLabel(row[index]))) continue;
      const next = row.slice(index + 1).find((value) => !isBlank(value));
      if (!isBlank(next)) return next;
    }
  }

  return "";
}

function normalizeExcelLabel(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_:：-]/g, "");
}

function normalizeDuration(value) {
  if (isBlank(value)) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    const totalSeconds = value > 0 && value < 1 ? Math.round(value * 86400) : Math.round(value * 60);
    return formatDurationSeconds(totalSeconds);
  }

  const text = String(value).trim().replace(/：/g, ":");
  const colonMatch = text.match(/^(\d+):([0-5]?\d)(?::([0-5]?\d))?$/);
  if (colonMatch) {
    const first = Number(colonMatch[1]);
    const second = Number(colonMatch[2]);
    const third = colonMatch[3] === undefined ? null : Number(colonMatch[3]);
    const totalSeconds = third === null ? first * 60 + second : (first * 60 + second) * 60 + third;
    return formatDurationSeconds(totalSeconds);
  }

  const cnMatch = text.match(/(\d+)\s*分(?:钟)?\s*(\d+)?\s*秒?/);
  if (cnMatch) {
    return formatDurationSeconds(Number(cnMatch[1]) * 60 + Number(cnMatch[2] || 0));
  }

  const numeric = Number(text);
  if (Number.isFinite(numeric)) return formatDurationSeconds(Math.round(numeric * 60));
  return text;
}

function formatDurationSeconds(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function getExcelPlayerId(record, playerByName, usedIds, sheetName, errors, missingPlayers = []) {
  const name = String(record["选手"] || "").trim();
  const player = playerByName.get(normalizeName(name));
  if (!player) {
    const missingName = name || "未命名选手";
    if (!missingPlayers.includes(missingName)) missingPlayers.push(missingName);
    return "";
  }
  if (usedIds.has(player.id)) errors.push(`${sheetName}: 选手重复：${name}`);
  usedIds.add(player.id);
  return player.id;
}

function getTeamKills(records) {
  const value = records.map((record) => Number(record["队伍击杀"])).find((number) => Number.isFinite(number));
  return Number.isFinite(value) ? value : 0;
}

function normalizeSide(value) {
  const text = String(value || "").trim();
  if (text === "天辉" || text.toLowerCase() === "radiant") return "radiant";
  if (text === "夜魇" || text === "夜魔" || text.toLowerCase() === "dire") return "dire";
  return "";
}

function normalizePosition(value) {
  const text = String(value || "").trim();
  return ["1", "2", "3", "4", "5"].includes(text) ? text : "";
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeExcelDate(value, fallback) {
  const raw = String(value || fallback?.match(/\d{6}/)?.[0] || "").trim();
  const match = raw.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (match) return `20${match[1]}-${match[2]}-${match[3]}`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function cleanPositions(positions, teams) {
  const validIds = new Set([...teams.radiant, ...teams.dire]);
  const cleaned = {};
  Object.entries(positions).forEach(([playerId, position]) => {
    if (validIds.has(playerId) && ["1", "2", "3", "4", "5"].includes(String(position))) {
      cleaned[playerId] = String(position);
    }
  });
  return cleaned;
}

function cleanPlayerDetails(details, teams) {
  const validIds = new Set([...teams.radiant, ...teams.dire]);
  const cleaned = {};

  Object.entries(details).forEach(([playerId, detail]) => {
    if (!validIds.has(playerId) || !detail || typeof detail !== "object") return;
    cleaned[playerId] = {
      hero: String(detail.hero || "").trim(),
      position: ["1", "2", "3", "4", "5"].includes(String(detail.position)) ? String(detail.position) : "",
      kills: numberOrBlank(detail.kills),
      deaths: numberOrBlank(detail.deaths),
      assists: numberOrBlank(detail.assists),
      participation: normalizeRatio(detail.participation),
      damageShare: normalizeRatio(detail.damageShare),
      gpm: numberOrBlank(detail.gpm),
      xpm: numberOrBlank(detail.xpm),
      lastHits: numberOrBlank(detail.lastHits),
      netWorth10: numberOrBlank(detail.netWorth10),
      damage: numberOrBlank(detail.damage),
      buildingDamage: numberOrBlank(detail.buildingDamage),
      damageTaken: numberOrBlank(detail.damageTaken),
      healing: numberOrBlank(detail.healing),
      special: String(detail.special || "").trim()
    };
  });

  return cleaned;
}

function numberOrBlank(value) {
  if (value === "" || value === null || value === undefined) return "";
  const number = Number(value);
  return Number.isFinite(number) ? number : "";
}

function normalizeRatio(value) {
  if (value === "" || value === null || value === undefined) return "";
  if (typeof value === "string" && value.trim().endsWith("%")) {
    const percent = Number(value.trim().slice(0, -1));
    return Number.isFinite(percent) ? percent / 100 : "";
  }
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return number > 1 ? number / 100 : number;
}

function clampRating(value) {
  const rating = Number(value);
  if (!Number.isFinite(rating)) return 5;
  return Math.max(0, Math.round(rating * 2) / 2);
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function loadDotaAbilityIds() {
  try {
    return JSON.parse(readFileSync(join(__dirname, "assets", "dota-ability-ids.json"), "utf8"));
  } catch (error) {
    console.warn(`Dota ability ID catalog unavailable: ${error.message}`);
    return {};
  }
}

function isDotaTalentKey(key) {
  const value = String(key || "");
  return value.startsWith("special_bonus_") && value !== "special_bonus_attributes";
}

function normalizeReplayAnalysis(analysis = {}) {
  const players = analysis.players && typeof analysis.players === "object" ? analysis.players : {};
  Object.values(players).forEach((player) => {
    if (!Array.isArray(player?.abilityBuild)) return;
    player.abilityBuild = player.abilityBuild.filter((ability) => Number(ability?.abilityId) > 0).map((ability) => {
      const catalogKey = DOTA_ABILITY_IDS[String(Number(ability.abilityId))] || "";
      const key = catalogKey || String(ability?.key || "");
      const talent = isDotaTalentKey(key);
      return {
        ...ability,
        key,
        name: talent ? "天赋" : (catalogKey && catalogKey !== ability?.key ? "" : ability?.name),
        talent
      };
    });
  });
  return { ...analysis, players };
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : {};
}

async function serveStatic(request, response, pathname) {
  if (pathname.startsWith("/uploads/")) {
    if (!/^\/uploads\/highlights\/[a-f0-9-]{36}\.webp$/.test(pathname)) {
      sendJson(response, 404, { error: "图片不存在" });
      return;
    }
    const path = join(HIGHLIGHT_UPLOAD_DIR, pathname.split("/").pop());
    if (!existsSync(path)) {
      sendJson(response, 404, { error: "图片不存在" });
      return;
    }
    response.writeHead(200, { "Content-Type": "image/webp", "Content-Length": statSync(path).size,
      "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" });
    if (request.method === "HEAD") response.end();
    else createReadStream(path).on("error", () => response.destroy()).pipe(response);
    return;
  }
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(__dirname, decodeURIComponent(requested)));

  if (!filePath.startsWith(normalize(__dirname)) || !existsSync(filePath)) {
    sendJson(response, 404, { error: "文件不存在" });
    return;
  }

  const type = contentType(filePath);
  const stat = statSync(filePath);
  const cacheControl = requested.startsWith("/node_modules/three/")
    ? "public, max-age=86400, immutable"
    : requested.startsWith("/assets/") ? "public, max-age=3600" : "no-store";
  const range = request.headers.range;

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      response.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
      response.end();
      return;
    }

    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Number(match[2]) : stat.size - 1;
    if (start > end || start >= stat.size || end >= stat.size) {
      response.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
      response.end();
      return;
    }

    response.writeHead(206, {
      "Content-Type": type,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": cacheControl
    });
    createReadStream(filePath, { start, end }).pipe(response);
    return;
  }

  if (type.startsWith("video/")) {
    response.writeHead(200, {
      "Content-Type": type,
      "Content-Length": stat.size,
      "Accept-Ranges": "bytes",
      "Cache-Control": cacheControl
    });
    createReadStream(filePath).pipe(response);
    return;
  }

  const content = await readFile(filePath);
  response.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": cacheControl
  });
  response.end(content);
}

function contentType(filePath) {
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".mp4": "video/mp4"
  };
  return types[extname(filePath)] || "application/octet-stream";
}

function sendJson(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}
