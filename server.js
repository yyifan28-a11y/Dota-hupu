import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, extname, isAbsolute, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import * as XLSX from "xlsx";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ENV = globalThis.process?.env || {};
const PORT = Number(ENV.PORT || 3000);
const ADMIN_PASSWORD = ENV.ADMIN_PASSWORD || "admin123";
const DB_PATH = getDatabasePath();
mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);

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

initDatabase();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    await serveStatic(response, url.pathname);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Dota2 inhouse tool running at http://localhost:${PORT}`);
  console.log(`SQLite database: ${DB_PATH}`);
});

function getDatabasePath() {
  const configuredPath = ENV.DATABASE_PATH || ENV.SQLITE_PATH || "dota.db";
  return isAbsolute(configuredPath) ? configuredPath : join(__dirname, configuredPath);
}

function initDatabase() {
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
      winner TEXT NOT NULL CHECK (winner IN ('radiant', 'dire')),
      score TEXT DEFAULT '',
      note TEXT DEFAULT '',
      radiant TEXT NOT NULL,
      dire TEXT NOT NULL,
      positions TEXT DEFAULT '{}',
      player_details TEXT DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  addColumnIfMissing("players", "rating", "REAL DEFAULT 5");
  addColumnIfMissing("players", "rating_updated_at", "TEXT DEFAULT ''");
  addColumnIfMissing("matches", "positions", "TEXT DEFAULT '{}'");
  addColumnIfMissing("matches", "player_details", "TEXT DEFAULT '{}'");
  addColumnIfMissing("matches", "match_no", "INTEGER DEFAULT 1");

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

  const playerCount = db.prepare("SELECT COUNT(*) AS count FROM players").get().count;
  if (playerCount === 0) {
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

async function handleApi(request, response, url) {
  const method = request.method;

  if (method === "GET" && url.pathname === "/api/state") {
    sendJson(response, 200, getState());
    return;
  }

  if (method !== "GET" && !requireAdmin(request, response)) {
    return;
  }

  if (method === "POST" && url.pathname === "/api/admin/check") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "POST" && url.pathname === "/api/players") {
    const body = await readJson(request);
    if (!body.name?.trim()) {
      sendJson(response, 400, { error: "选手昵称不能为空" });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO players (id, name, steam_id, rating, rating_updated_at, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      body.name.trim(),
      body.steamId?.trim() || "",
      clampRating(body.rating),
      now,
      body.note?.trim() || "",
      now
    );
    sendJson(response, 201, getState());
    return;
  }

  if (method === "PUT" && url.pathname.startsWith("/api/players/") && url.pathname.endsWith("/rating")) {
    const id = decodeURIComponent(url.pathname.replace("/api/players/", "").replace("/rating", ""));
    const body = await readJson(request);
    db.prepare("UPDATE players SET rating = ?, rating_updated_at = ? WHERE id = ?")
      .run(clampRating(body.rating), new Date().toISOString(), id);
    sendJson(response, 200, getState());
    return;
  }

  if (method === "DELETE" && url.pathname.startsWith("/api/players/")) {
    const id = decodeURIComponent(url.pathname.replace("/api/players/", ""));
    db.prepare("DELETE FROM players WHERE id = ?").run(id);
    const teams = getTeams();
    saveTeams({
      radiant: teams.radiant.filter((playerId) => playerId !== id),
      dire: teams.dire.filter((playerId) => playerId !== id)
    });
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
      sendJson(response, 400, { error: "找不到满足评分差 ≤ 1 和预设条件的对阵，请调整选手或预设。" });
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
      INSERT INTO matches (id, date, match_no, winner, score, note, radiant, dire, positions, player_details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      body.date || new Date().toISOString().slice(0, 10),
      Number(body.matchNo || 1),
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
      SET date = ?, match_no = ?, winner = ?, score = ?, note = ?, radiant = ?, dire = ?, positions = ?, player_details = ?
      WHERE id = ?
    `).run(
      body.date || new Date().toISOString().slice(0, 10),
      Number(body.matchNo || 1),
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

    db.exec("DELETE FROM players; DELETE FROM matches;");
    const insertPlayer = db.prepare(`
      INSERT INTO players (id, name, steam_id, rating, rating_updated_at, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    body.players.forEach((player) => {
      const now = new Date().toISOString();
      insertPlayer.run(
        player.id || crypto.randomUUID(),
        player.name || "未命名选手",
        player.steamId || player.steam_id || "",
        clampRating(player.rating ?? player.mmr / 1000 ?? 5),
        player.ratingUpdatedAt || player.rating_updated_at || now,
        player.note || "",
        now
      );
    });

    const insertMatch = db.prepare(`
      INSERT INTO matches (id, date, match_no, winner, score, note, radiant, dire, positions, player_details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    body.matches.forEach((match) => {
      const radiant = Array.isArray(match.radiant) ? match.radiant : [];
      const dire = Array.isArray(match.dire) ? match.dire : [];
      insertMatch.run(
        match.id || crypto.randomUUID(),
        match.date || new Date().toISOString().slice(0, 10),
        Number(match.matchNo || match.match_no || 1),
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

    saveTeams(body.currentTeams || { radiant: [], dire: [] });
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

  if (method === "POST" && url.pathname === "/api/reset") {
    db.exec("DELETE FROM players; DELETE FROM matches;");
    saveTeams({ radiant: [], dire: [] });
    sendJson(response, 200, getState());
    return;
  }

  sendJson(response, 404, { error: "接口不存在" });
}

function requireAdmin(request, response) {
  if (request.headers["x-admin-password"] === ADMIN_PASSWORD) {
    return true;
  }
  sendJson(response, 401, { error: "管理员密码不正确" });
  return false;
}

function getState() {
  return {
    players: db.prepare(`
      SELECT id, name, steam_id AS steamId, rating, rating_updated_at AS ratingUpdatedAt, note
      FROM players
      ORDER BY created_at ASC
    `).all(),
    matches: db.prepare(`
      SELECT id, date, match_no AS matchNo, winner, score, note, radiant, dire, positions, player_details AS playerDetails
      FROM matches
      ORDER BY created_at DESC
    `).all().map((match) => ({
      ...match,
      radiant: parseJsonArray(match.radiant),
      dire: parseJsonArray(match.dire),
      positions: parseJsonObject(match.positions),
      playerDetails: parseJsonObject(match.playerDetails)
    })),
    currentTeams: getTeams()
  };
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

function satisfiesConstraints(teams, constraints) {
  const radiant = new Set(teams.radiant);
  const dire = new Set(teams.dire);

  return constraints.every((item) => {
    if (!item?.a || !item?.b || item.a === item.b) return true;
    const sameTeam = (radiant.has(item.a) && radiant.has(item.b)) || (dire.has(item.a) && dire.has(item.b));
    return item.type === "opponent" ? !sameTeam : sameTeam;
  });
}

function shuffleTeams(ids) {
  const shuffled = [...ids].sort(() => Math.random() - 0.5);
  return {
    radiant: shuffled.slice(0, 5),
    dire: shuffled.slice(5, 10)
  };
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

    if (records.length !== 10) {
      errors.push(`${sheetName}: 需要 10 行选手数据，当前是 ${records.length} 行`);
      return;
    }

    const parsed = parseExcelMatchSheet(sheetName, records, playerByName);
    matches.push(parsed.match);
    errors.push(...parsed.errors);
    warnings.push(...parsed.warnings);
  });

  return {
    matches,
    errors,
    warnings,
    canImport: matches.length > 0 && errors.length === 0
  };
}

function parseExcelMatchSheet(sheetName, records, playerByName) {
  const errors = [];
  const warnings = [];
  const first = records[0] || {};
  const radiant = records.filter((record) => normalizeSide(record["阵营"]) === "radiant");
  const dire = records.filter((record) => normalizeSide(record["阵营"]) === "dire");
  const winnerRecord = records.find((record) => String(record["结果"] || "").trim() === "胜");
  const winner = winnerRecord ? normalizeSide(winnerRecord["阵营"]) : "";
  const date = normalizeExcelDate(first["日期"], sheetName);
  const matchNo = Number(first["场次"] || sheetName.match(/-(\d+)$/)?.[1] || 1);
  const radiantKills = getTeamKills(radiant);
  const direKills = getTeamKills(dire);
  const usedIds = new Set();

  if (!date) errors.push(`${sheetName}: 无法识别日期`);
  if (!winner) errors.push(`${sheetName}: 无法识别获胜方`);
  if (radiant.length !== 5 || dire.length !== 5) {
    errors.push(`${sheetName}: 天辉 ${radiant.length} 人，夜魇 ${dire.length} 人，需要各 5 人`);
  }

  const teams = {
    radiant: radiant.map((record) => getExcelPlayerId(record, playerByName, usedIds, sheetName, errors)),
    dire: dire.map((record) => getExcelPlayerId(record, playerByName, usedIds, sheetName, errors))
  };
  const playerDetails = {};

  [...radiant, ...dire].forEach((record) => {
    const player = playerByName.get(normalizeName(record["选手"]));
    if (!player) return;
    playerDetails[player.id] = {
      hero: String(record["英雄"] || "").trim(),
      position: normalizePosition(record["位置"]),
      kills: numberOrBlank(record["K"]),
      deaths: numberOrBlank(record["D"]),
      assists: numberOrBlank(record["A"]),
      participation: normalizeRatio(record["参战率"]),
      damageShare: normalizeRatio(record["输出占比"]),
      gpm: numberOrBlank(record["GPM"]),
      xpm: numberOrBlank(record["XPM"]),
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

  return {
    match: {
      sheetName,
      date,
      matchNo,
      winner: winner || "radiant",
      score: `${radiantKills}-${direKills}`,
      note: `Excel导入：${sheetName}`,
      radiant: teams.radiant.filter(Boolean),
      dire: teams.dire.filter(Boolean),
      positions: {},
      playerDetails
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

    if (radiant.length !== 5 || dire.length !== 5) errors.push(`${label}: 需要天辉/夜魇各 5 人`);
    if (new Set(ids).size !== ids.length) errors.push(`${label}: 有重复选手`);
    ids.forEach((id) => {
      if (!validIds.has(id)) errors.push(`${label}: 选手 ID 不存在 ${id}`);
    });

    const teams = { radiant, dire };
    cleaned.push({
      date: match.date || new Date().toISOString().slice(0, 10),
      matchNo: Number(match.matchNo || 1),
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
    INSERT INTO matches (id, date, match_no, winner, score, note, radiant, dire, positions, player_details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.exec("BEGIN");
  try {
    matches.forEach((match) => {
      insert.run(
        crypto.randomUUID(),
        match.date,
        match.matchNo,
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

function getExcelPlayerId(record, playerByName, usedIds, sheetName, errors) {
  const name = String(record["选手"] || "").trim();
  const player = playerByName.get(normalizeName(name));
  if (!player) {
    errors.push(`${sheetName}: 选手不存在，请先新增：${name || "未命名选手"}`);
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
  if (text === "夜魇" || text.toLowerCase() === "dire") return "dire";
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

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : {};
}

async function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(__dirname, decodeURIComponent(requested)));

  if (!filePath.startsWith(normalize(__dirname)) || !existsSync(filePath)) {
    sendJson(response, 404, { error: "文件不存在" });
    return;
  }

  const content = await readFile(filePath);
  response.writeHead(200, {
    "Content-Type": contentType(filePath),
    "Cache-Control": "no-store"
  });
  response.end(content);
}

function contentType(filePath) {
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  };
  return types[extname(filePath)] || "application/octet-stream";
}

function sendJson(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}
