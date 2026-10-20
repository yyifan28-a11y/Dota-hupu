// Usage: node scripts/backfill-replay-draft.mjs <Dota match ID> <original .dem path>
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [matchId, replay] = process.argv.slice(2);
if (!matchId || !replay) throw new Error("用法：node scripts/backfill-replay-draft.mjs <比赛ID> <原录像路径>");
const database = resolve(process.env.S3_DATABASE_PATH || join(dirname(resolve(process.env.DATABASE_PATH || process.env.SQLITE_PATH || join(root, "dota.db"))), "dota-s3.db"));
if (!existsSync(database) || !existsSync(resolve(replay))) throw new Error("数据库或原录像不存在");
const db = new DatabaseSync(database);
try {
  const row = db.prepare("SELECT m.id, a.analysis FROM matches m JOIN match_analyses a ON a.match_id = m.id WHERE m.match_id = ?").get(matchId);
  if (!row) throw new Error("找不到该比赛的已保存录像分析");
  const localPython = join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const python = process.env.REPLAY_PYTHON || (existsSync(localPython) ? localPython : process.platform === "win32" ? "python" : "python3");
  const result = await new Promise((done, reject) => {
    const child = spawn(python, [join(root, "scripts/parse-dota-replay.py"), resolve(replay)], { windowsHide: true });
    let output = "", errors = "";
    child.stdout.on("data", (data) => { output += data; });
    child.stderr.on("data", (data) => { errors = (errors + data).slice(-6000); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(errors || `解析失败 ${code}`));
      try { done(JSON.parse(output)); } catch (error) { reject(error); }
    });
  });
  if (String(result.matchId) !== matchId) throw new Error("原录像比赛 ID 不匹配，未修改数据库");
  if (!result.draft?.length) throw new Error("未解析到 BP，保留现有数据");
  const analysis = { ...JSON.parse(row.analysis), gameMode: result.gameMode, draft: result.draft };
  db.prepare("UPDATE match_analyses SET analysis = ?, updated_at = ? WHERE match_id = ?").run(JSON.stringify(analysis), new Date().toISOString(), row.id);
  console.log(`已补齐 ${matchId} 的 ${result.draft.length} 条 BP 记录`);
} finally { db.close(); }
