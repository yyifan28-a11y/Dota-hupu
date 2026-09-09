import { readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import XLSX from "xlsx";

// Preview by default. --apply backs up each database before filling missing values.
const apply = process.argv.includes("--apply");
const root = resolve(import.meta.dirname, "..");
const normalizeName = (value) => String(value || "").trim().toLowerCase();
const sources = new Map();
for (const file of readdirSync(join(root, "记录")).filter((name) => name.endsWith(".xlsx"))) {
  const workbook = XLSX.readFile(join(root, "记录", file));
  for (const sheet of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { header: 1, defval: "" });
    const headers = rows[0]?.map((value) => String(value).trim()) || [];
    if (!headers.includes("正补") || !headers.includes("选手")) continue;
    const meta = rows.find((row) => String(row[0]).trim() === "比赛ID");
    const matchId = String(meta?.[1] || "").trim();
    if (!matchId) continue;
    for (const row of rows.slice(1)) {
      const record = Object.fromEntries(headers.map((key, index) => [key, row[index]]));
      const value = record["正补"];
      if (!record["选手"] || value === "" || value == null || !Number.isInteger(Number(value)) || Number(value) < 0) continue;
      const key = `${matchId}:${normalizeName(record["选手"])}`;
      const candidates = sources.get(key) || [];
      candidates.push({ file, sheet, record, value: Number(value) });
      sources.set(key, candidates);
    }
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
for (const file of ["dota.db", "dota-s3.db"]) {
  const database = new DatabaseSync(join(root, file), { readOnly: !apply });
  const players = new Map(database.prepare("SELECT id, name FROM players").all().map((player) => [player.id, player.name]));
  const updates = [];
  const skipped = [];
  let filled = 0;
  for (const match of database.prepare("SELECT * FROM matches").all()) {
    const details = JSON.parse(match.player_details || "{}");
    let changed = false;
    for (const id of [...JSON.parse(match.radiant), ...JSON.parse(match.dire)]) {
      const detail = details[id];
      if (!detail || (detail.lastHits != null && detail.lastHits !== "")) continue;
      const candidates = (sources.get(`${match.match_id}:${normalizeName(players.get(id))}`) || []).filter(({ record }) => [
        ["kills", "K"], ["deaths", "D"], ["assists", "A"], ["gpm", "GPM"]
      ].every(([field, column]) => detail[field] !== "" && detail[field] != null && record[column] !== "" && record[column] != null && Number(detail[field]) === Number(record[column])));
      const values = new Set(candidates.map((candidate) => candidate.value));
      if (values.size !== 1) {
        skipped.push({ matchId: match.match_id, player: players.get(id), reason: values.size ? "conflicting sources" : "no source" });
        continue;
      }
      const source = candidates[0];
      detail.lastHits = source.value;
      changed = true;
      filled++;
    }
    if (changed) updates.push({ id: match.id, before: match.player_details, after: JSON.stringify(details) });
  }
  if (apply && updates.length) {
    const backupDir = join(root, "backups", `last-hits-${stamp}`);
    mkdirSync(backupDir, { recursive: true });
    await backup(database, join(backupDir, file));
    writeFileSync(join(backupDir, `${file}.changes.json`), JSON.stringify({ updates, skipped }, null, 2));
    database.exec("BEGIN IMMEDIATE");
    try {
      const update = database.prepare("UPDATE matches SET player_details = ? WHERE id = ? AND player_details = ?");
      for (const item of updates) {
        if (update.run(item.after, item.id, item.before).changes !== 1) throw new Error("Match changed during backfill");
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    console.log(`Backup: ${backupDir}`);
  }
  console.log(JSON.stringify({ file, apply, matches: updates.length, filled, skipped: skipped.length, skippedExamples: skipped.slice(0, 5) }));
  database.close();
}
