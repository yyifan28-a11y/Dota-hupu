import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("../", import.meta.url));
const heroesCode = await readFile(join(root, "heroes.js"), "utf8");
const windowLike = {};
new Function("window", `${heroesCode}; return window.DOTA_HEROES;`)(windowLike);
const heroes = windowLike.DOTA_HEROES || [];

const db = new DatabaseSync(join(root, "dota.db"));

function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s_'’.-]/g, "");
}

function findHero(value) {
  const key = normalize(value);
  if (!key) return null;
  return heroes.find((hero) => {
    const candidates = [hero.cn, hero.name, hero.slug, ...(hero.aliases || [])];
    return candidates.some((item) => normalize(item) === key);
  }) || null;
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

const matches = db.prepare(`
  SELECT id, radiant, dire, positions, player_details AS playerDetails
  FROM matches
  ORDER BY date ASC, match_no ASC, created_at ASC
`).all();

const update = db.prepare("UPDATE matches SET player_details = ? WHERE id = ?");
let changedMatches = 0;
let filledHeroes = 0;
let replacedDuplicates = 0;
let replacedUnknown = 0;

db.exec("BEGIN");
try {
  for (const match of matches) {
    const radiant = parseJson(match.radiant, []);
    const dire = parseJson(match.dire, []);
    const positions = parseJson(match.positions, {});
    const details = parseJson(match.playerDetails, {});
    const playerIds = [...radiant, ...dire];
    const pool = shuffle(heroes);
    const used = new Set();
    let poolIndex = 0;
    let matchChanged = false;

    for (const [index, playerId] of playerIds.entries()) {
      const detail = { ...(details[playerId] || {}) };
      const currentHero = findHero(detail.hero);

      if (currentHero && !used.has(currentHero.cn)) {
        detail.hero = currentHero.cn;
        used.add(currentHero.cn);
        if (detail.hero !== details[playerId]?.hero) matchChanged = true;
      } else {
        while (poolIndex < pool.length && used.has(pool[poolIndex].cn)) {
          poolIndex += 1;
        }

        const nextHero = pool[poolIndex] || heroes.find((hero) => !used.has(hero.cn));
        if (nextHero) {
          if (detail.hero && currentHero) replacedDuplicates += 1;
          if (detail.hero && !currentHero) replacedUnknown += 1;
          if (!detail.hero) filledHeroes += 1;
          detail.hero = nextHero.cn;
          used.add(nextHero.cn);
          poolIndex += 1;
          matchChanged = true;
        }
      }

      if (!detail.position) {
        detail.position = positions[playerId] || String((index % 5) + 1);
        matchChanged = true;
      }

      details[playerId] = detail;
    }

    for (const playerId of Object.keys(details)) {
      if (!playerIds.includes(playerId)) {
        delete details[playerId];
        matchChanged = true;
      }
    }

    if (matchChanged) {
      update.run(JSON.stringify(details), match.id);
      changedMatches += 1;
    }
  }

  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

console.log(JSON.stringify({
  matches: matches.length,
  changedMatches,
  filledHeroes,
  replacedDuplicates,
  replacedUnknown
}, null, 2));
