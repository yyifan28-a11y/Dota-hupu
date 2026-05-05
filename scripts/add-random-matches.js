import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL("..", import.meta.url));
const db = new DatabaseSync(join(__dirname, "dota.db"));

const MATCH_COUNT = Number(process.argv[2] || 20);
const POSITIONS = ["1", "2", "3", "4", "5"];
const HEROES = [
  "帕克", "影魔", "主宰", "幻影刺客", "斯温", "莉娜", "拉席克", "潮汐猎人",
  "半人马", "玛尔斯", "莱恩", "拉比克", "森海飞霞", "戴泽", "冰女", "祸乱之源",
  "虚空假面", "恐怖利刃", "风行者", "宙斯", "兽王", "猛犸", "土猫", "小小"
];
const NOTES = ["常规局", "后期翻盘", "前期压制", "团战拉满", "阵容实验", "练英雄"];
const SPECIALS = ["关键肉山团", "中路节奏起飞", "后期买活翻盘", "视野压制", "三路推进", "守高成功", ""];

const players = db.prepare(`
  SELECT id, name, rating
  FROM players
  ORDER BY created_at ASC
`).all();

if (players.length < 10) {
  throw new Error("至少需要 10 个选手才能随机生成比赛。");
}

const insertMatch = db.prepare(`
  INSERT INTO matches (id, date, match_no, winner, score, note, radiant, dire, positions, player_details, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const existingCount = db.prepare("SELECT COUNT(*) AS count FROM matches").get().count;

for (let index = 0; index < MATCH_COUNT; index += 1) {
  const selected = shuffle(players).slice(0, 10);
  const teams = balancedTeams(selected);
  const positions = assignPositions(teams);
  const playerDetails = createPlayerDetails([...teams.radiant, ...teams.dire], positions);
  const radiantKills = randomInt(18, 58);
  const direKills = randomInt(18, 58);
  const winner = radiantKills >= direKills ? "radiant" : "dire";
  const minutes = randomInt(28, 62);
  const seconds = String(randomInt(0, 59)).padStart(2, "0");
  const createdAt = new Date(Date.now() - (existingCount + index) * 3600000).toISOString();
  const date = new Date(Date.now() - Math.floor((existingCount + index) / 2) * 86400000).toISOString().slice(0, 10);

  insertMatch.run(
    crypto.randomUUID(),
    date,
    ((existingCount + index) % 4) + 1,
    winner,
    `${radiantKills}-${direKills} / ${minutes}:${seconds}`,
    NOTES[randomInt(0, NOTES.length - 1)],
    JSON.stringify(teams.radiant),
    JSON.stringify(teams.dire),
    JSON.stringify(positions),
    JSON.stringify(playerDetails),
    createdAt
  );
}

console.log(`已追加 ${MATCH_COUNT} 场随机比赛。当前比赛总数：${existingCount + MATCH_COUNT}`);

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
    shuffle(POSITIONS).forEach((position, index) => {
      positions[team[index]] = position;
    });
  });
  return positions;
}

function createPlayerDetails(ids, positions) {
  return Object.fromEntries(ids.map((id) => {
    const position = positions[id];
    return [id, {
      hero: HEROES[randomInt(0, HEROES.length - 1)],
      position,
      gpm: randomInt(position === "1" ? 560 : 310, position === "1" ? 820 : 650),
      xpm: randomInt(position === "5" ? 360 : 480, position === "5" ? 620 : 850),
      netWorth10: randomInt(position === "1" ? 4200 : 1800, position === "1" ? 6500 : 5200),
      damage: randomInt(9000, 48000),
      healing: randomInt(0, 14000),
      special: SPECIALS[randomInt(0, SPECIALS.length - 1)]
    }];
  }));
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
