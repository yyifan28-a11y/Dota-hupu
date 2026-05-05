import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL("..", import.meta.url));
const db = new DatabaseSync(join(__dirname, "dota.db"));

const demoPlayers = [
  ["老陈", "1", 6.5, "稳定一号位"],
  ["小白", "2", 5.5, "喜欢中单"],
  ["阿飞", "3", 6.0, "三号位开团"],
  ["冬瓜", "4", 4.5, "游走辅助"],
  ["可乐", "5", 5.0, "五号位指挥"],
  ["星尘", "6", 7.5, "高分补位"],
  ["海盐", "7", 6.0, "节奏型中单"],
  ["山竹", "8", 4.0, "新手保护"],
  ["蓝猫", "9", 7.0, "绝活哥"],
  ["土豆", "10", 5.5, "全能补位"],
  ["风铃", "11", 6.5, "偏辅助"],
  ["木鱼", "12", 5.0, "偏三四号位"],
  ["夜雨", "13", 8.0, "核心大腿"],
  ["南瓜", "14", 4.5, "练英雄中"],
  ["石头", "15", 6.0, "抗压路"],
  ["薄荷", "16", 5.5, "团队型"],
  ["火锅", "17", 7.0, "节奏发动机"],
  ["汽水", "18", 3.5, "娱乐玩家"],
  ["乌龙", "19", 6.5, "中后期稳定"],
  ["晴天", "20", 5.0, "补位优先"]
];

const existingNames = new Set(
  db.prepare("SELECT name FROM players").all().map((player) => player.name)
);

const insertPlayer = db.prepare(`
  INSERT INTO players (id, name, steam_id, rating, rating_updated_at, note, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

demoPlayers.forEach(([name, steamId, rating, note]) => {
  if (existingNames.has(name)) return;
  const now = new Date().toISOString();
  insertPlayer.run(crypto.randomUUID(), name, steamId, rating, now, note, now);
});

const players = db.prepare(`
  SELECT id, rating
  FROM players
  ORDER BY created_at ASC
`).all();

if (players.length < 10) {
  throw new Error("Need at least 10 players to generate demo matches.");
}

const insertMatch = db.prepare(`
  INSERT INTO matches (id, date, winner, score, note, radiant, dire, positions, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const notes = ["常规局", "后期翻盘", "前期碾压", "团战拉满", "阵容实验", "欢乐内战"];

for (let index = 0; index < 10; index += 1) {
  const selected = shuffle(players).slice(0, 10);
  const teams = balancedTeams(selected);
  const radiantScore = randomInt(18, 55);
  const direScore = randomInt(18, 55);
  const winner = radiantScore >= direScore ? "radiant" : "dire";
  const minutes = randomInt(28, 62);
  const seconds = String(randomInt(0, 59)).padStart(2, "0");
  const date = new Date(Date.now() - index * 86400000).toISOString().slice(0, 10);

  insertMatch.run(
    crypto.randomUUID(),
    date,
    winner,
    `${radiantScore}-${direScore} / ${minutes}:${seconds}`,
    notes[randomInt(0, notes.length - 1)],
    JSON.stringify(teams.radiant),
    JSON.stringify(teams.dire),
    JSON.stringify(assignPositions(teams)),
    new Date(Date.now() - index * 86400000).toISOString()
  );
}

console.log(`Demo seed complete. Players: ${db.prepare("SELECT COUNT(*) AS count FROM players").get().count}, matches added: 10`);

function balancedTeams(selected) {
  const sorted = [...selected].sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0));
  const radiant = [];
  const dire = [];

  sorted.forEach((player) => {
    const target = radiant.length >= 5
      ? dire
      : dire.length >= 5
        ? radiant
        : teamRating(radiant, selected) <= teamRating(dire, selected)
          ? radiant
          : dire;
    target.push(player.id);
  });

  return { radiant, dire };
}

function assignPositions(teams) {
  const positions = {};
  [teams.radiant, teams.dire].forEach((team) => {
    shuffle(["1", "2", "3", "4", "5"]).forEach((position, index) => {
      positions[team[index]] = position;
    });
  });
  return positions;
}

function teamRating(ids, selected) {
  return ids.reduce((total, id) => total + Number(selected.find((player) => player.id === id)?.rating || 0), 0);
}

function shuffle(items) {
  return [...items].sort(() => Math.random() - 0.5);
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
