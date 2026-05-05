let db = {
  players: [],
  matches: [],
  currentTeams: { radiant: [], dire: [] }
};

const POSITIONS = ["1", "2", "3", "4", "5"];
const HEROES = Array.isArray(window.DOTA_HEROES) ? window.DOTA_HEROES : [];
const HERO_IMAGE_BASE = "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes";
const ADMIN_PASSWORD_KEY = "dota-admin-password";
const BALANCE_MODE_DESCRIPTIONS = {
  position: "尽量让同队选手的常用位置不重复。",
  combination: "优先减少老队友组合，让大家更常遇到新搭配。",
  random: "在可用候选里随机抽一组，不额外考虑位置、胜率或历史组合。",
  winrate: "让两边平均胜率尽量接近。"
};

let isAdmin = Boolean(sessionStorage.getItem(ADMIN_PASSWORD_KEY));
let constraints = [];
let matchDetails = {};
let selectedMatchPlayerId = null;
let matchEntryTeams = { radiant: [], dire: [] };
let editingMatchId = null;
let recordSort = "rating";
let dataSort = "damage";
let hasGeneratedTeams = false;
let playerById = new Map();
let statsByPlayerId = new Map();
let dataStatsByPlayerId = new Map();

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `请求失败：${response.status}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function adminApi(path, options = {}) {
  let password = sessionStorage.getItem(ADMIN_PASSWORD_KEY);
  const hadStoredPassword = Boolean(password);
  if (!password) {
    password = $("#adminPasswordInput")?.value || prompt("请输入管理员密码");
    if (!password) throw new Error("已取消操作");
  }

  try {
    const result = await api(path, {
      ...options,
      headers: { ...(options.headers || {}), "X-Admin-Password": password }
    });
    if (!hadStoredPassword) {
      sessionStorage.setItem(ADMIN_PASSWORD_KEY, password);
      isAdmin = true;
      updateAdminUi();
    }
    return result;
  } catch (error) {
    if (error.message.includes("管理员密码")) {
      sessionStorage.removeItem(ADMIN_PASSWORD_KEY);
      isAdmin = false;
      updateAdminUi();
    }
    throw error;
  }
}

async function verifyAdminPassword(password) {
  await api("/api/admin/check", {
    method: "POST",
    headers: { "X-Admin-Password": password }
  });
  sessionStorage.setItem(ADMIN_PASSWORD_KEY, password);
  isAdmin = true;
  updateAdminUi();
}

async function restoreAdminSession() {
  const password = sessionStorage.getItem(ADMIN_PASSWORD_KEY);
  if (!password) {
    isAdmin = false;
    return;
  }

  try {
    await api("/api/admin/check", {
      method: "POST",
      headers: { "X-Admin-Password": password }
    });
    isAdmin = true;
  } catch {
    sessionStorage.removeItem(ADMIN_PASSWORD_KEY);
    isAdmin = false;
  }
}

async function loadState() {
  db = await api("/api/state");
  rebuildDerivedStats();
  renderAll();
}

function getPlayer(id) {
  return playerById.get(id);
}

function getPlayerStats(playerId) {
  return statsByPlayerId.get(playerId) || createEmptyPlayerStats();
}

function getPositionStats(playerId) {
  return getPlayerStats(playerId).positionStats;
}

function getPlayersWithStats() {
  return db.players.map((player) => ({
    ...player,
    stats: getPlayerStats(player.id),
    positionStats: getPositionStats(player.id)
  }));
}

function getPlayerDataStats(playerId) {
  return dataStatsByPlayerId.get(playerId) || createEmptyDataStats();
}

function createEmptyPositionStats() {
  return {
    counts: Object.fromEntries(POSITIONS.map((position) => [position, 0])),
    total: 0,
    main: "-"
  };
}

function createEmptyPlayerStats() {
  return {
    games: 0,
    wins: 0,
    losses: 0,
    netWins: 0,
    winrate: 0,
    positionStats: createEmptyPositionStats()
  };
}

function createEmptyDataStats() {
  return {
    gpm: null,
    xpm: null,
    netWorth10: null,
    damage: null
  };
}

function getMatchQuality(match) {
  if (!hasBasicMatchInfo(match)) return "draft";
  return hasCompletePlayerDetails(match) ? "complete" : "basic";
}

function getMatchQualityLabel(quality) {
  return {
    complete: "完全录入",
    basic: "数据不全",
    draft: "无效比赛"
  }[quality] || "无效比赛";
}

function hasBasicMatchInfo(match) {
  const scoreParts = String(match.score || "").split("/").map((part) => part.trim());
  return Boolean(
    match.date
    && Number(match.matchNo || 0) > 0
    && ["radiant", "dire"].includes(match.winner)
    && Array.isArray(match.radiant)
    && match.radiant.length === 5
    && Array.isArray(match.dire)
    && match.dire.length === 5
    && scoreParts.length === 2
    && /^\d+\s*-\s*\d+$/.test(scoreParts[0])
    && /^\d+\s*:\s*\d{1,2}$/.test(scoreParts[1])
  );
}

function hasCompletePlayerDetails(match) {
  const ids = [...(match.radiant || []), ...(match.dire || [])];
  if (ids.length !== 10) return false;

  return ids.every((playerId) => {
    const detail = match.playerDetails?.[playerId] || {};
    return Boolean(
      !isBlank(detail.hero)
      && POSITIONS.includes(String(detail.position || match.positions?.[playerId] || ""))
      && hasNumericDetail(detail.gpm)
      && hasNumericDetail(detail.xpm)
      && hasNumericDetail(detail.netWorth10)
      && hasNumericDetail(detail.damage)
      && hasNumericDetail(detail.healing)
    );
  });
}

function hasNumericDetail(value) {
  if (isBlank(value)) return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0;
}

function renderMatchQualityBadge(match) {
  const quality = getMatchQuality(match);
  return `<span class="quality-badge quality-${quality}">${getMatchQualityLabel(quality)}</span>`;
}

function rebuildDerivedStats() {
  playerById = new Map(db.players.map((player) => [player.id, player]));
  statsByPlayerId = new Map(db.players.map((player) => [player.id, createEmptyPlayerStats()]));

  const dataTotals = new Map(db.players.map((player) => [player.id, { gpm: 0, xpm: 0, netWorth10: 0, damage: 0 }]));
  const dataCounts = new Map(db.players.map((player) => [player.id, { gpm: 0, xpm: 0, netWorth10: 0, damage: 0 }]));

  db.matches.forEach((match) => {
    const quality = getMatchQuality(match);
    if (quality === "draft") return;
    const hasFullData = quality === "complete";

    [
      ["radiant", match.radiant || []],
      ["dire", match.dire || []]
    ].forEach(([side, ids]) => {
      ids.forEach((playerId) => {
        const stats = statsByPlayerId.get(playerId);
        if (!stats) return;

        stats.games += 1;
        if (match.winner === side) stats.wins += 1;
        if (!hasFullData) return;

        const position = match.playerDetails?.[playerId]?.position || match.positions?.[playerId];
        if (POSITIONS.includes(position)) {
          stats.positionStats.counts[position] += 1;
          stats.positionStats.total += 1;
        }
      });
    });

    if (!hasFullData) return;

    Object.entries(match.playerDetails || {}).forEach(([playerId, detail]) => {
      const totals = dataTotals.get(playerId);
      const counts = dataCounts.get(playerId);
      if (!totals || !counts) return;

      Object.keys(totals).forEach((key) => {
        const value = Number(detail[key]);
        if (!Number.isFinite(value) || value <= 0) return;
        totals[key] += value;
        counts[key] += 1;
      });
    });
  });

  statsByPlayerId.forEach((stats) => {
    stats.losses = stats.games - stats.wins;
    stats.netWins = stats.wins - stats.losses;
    stats.winrate = stats.games ? Math.round((stats.wins / stats.games) * 100) : 0;
    stats.positionStats.main = stats.positionStats.total
      ? POSITIONS.map((position) => ({ position, count: stats.positionStats.counts[position] }))
        .sort((a, b) => b.count - a.count)[0].position
      : "-";
  });

  dataStatsByPlayerId = new Map(db.players.map((player) => {
    const totals = dataTotals.get(player.id);
    const counts = dataCounts.get(player.id);
    return [
      player.id,
      Object.fromEntries(
        Object.keys(totals).map((key) => [key, counts[key] ? Math.round(totals[key] / counts[key]) : null])
      )
    ];
  }));
}

function sumRating(ids) {
  return ids.reduce((total, id) => total + Number(getPlayer(id)?.rating || 0), 0);
}

function renderEmpty(target) {
  target.innerHTML = $("#emptyStateTemplate").innerHTML;
}

function switchView(viewId) {
  $$(".nav-tab").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === viewId);
  });

  $$(".view").forEach((view) => {
    view.classList.toggle("is-active", view.id === viewId);
  });

  renderCurrentView();
}

function renderDashboard() {
  $("#statPlayers").textContent = db.players.length;
  $("#statMatches").textContent = db.matches.length;

  const playersWithStats = getPlayersWithStats();

  renderMiniRank(
    $("#ratingTopList"),
    [...playersWithStats].sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0)),
    (player) => formatRating(player.rating)
  );
  renderMiniRank(
    $("#winrateTopList"),
    [...playersWithStats]
      .filter((player) => player.stats.games > 0)
      .sort((a, b) => b.stats.winrate - a.stats.winrate || b.stats.games - a.stats.games),
    (player) => `${player.stats.winrate}%`
  );
  renderMiniRank(
    $("#netWinsTopList"),
    [...playersWithStats]
      .filter((player) => player.stats.games > 0)
      .sort((a, b) => b.stats.netWins - a.stats.netWins || b.stats.winrate - a.stats.winrate),
    (player) => `${player.stats.netWins > 0 ? "+" : ""}${player.stats.netWins}`
  );
  renderMiniRank(
    $("#gamesTopList"),
    [...playersWithStats]
      .filter((player) => player.stats.games > 0)
      .sort((a, b) => b.stats.games - a.stats.games || b.stats.wins - a.stats.wins),
    (player) => `${player.stats.games} 场`
  );

  renderMatchCards($("#recentMatches"), db.matches.slice(0, 5));
}

function renderMiniRank(target, players, valueFormatter) {
  if (!target) return;
  const topThree = players.slice(0, 3);
  if (!topThree.length) {
    target.innerHTML = `<li class="muted">暂无数据</li>`;
    return;
  }

  target.innerHTML = topThree
    .map((player) => `
      <li>
        <span>${escapeHtml(player.name)}</span>
        <strong>${escapeHtml(valueFormatter(player))}</strong>
      </li>
    `)
    .join("");
}

function renderPlayers() {
  $("#playersCountLabel").textContent = `${db.players.length} 人`;
  const body = $("#playersBody");

  if (!db.players.length) {
    body.innerHTML = `<tr><td colspan="5" class="muted">暂无选手</td></tr>`;
    return;
  }

  const players = getPlayersWithStats().sort(compareRecordPlayers);

  body.innerHTML = players
    .map((player) => {
      const stats = player.stats;
      return `
        <tr>
          <td><strong>${escapeHtml(player.name)}</strong></td>
          <td>${formatRating(player.rating)}</td>
          <td>${formatWinLoss(stats)}</td>
          <td>${stats.games}</td>
          <td>${renderTendency(player.id)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderRankings() {
  const body = $("#rankingsBody");
  if (!body) return;

  const players = db.players
    .map((player) => ({
      ...player,
      dataStats: getPlayerDataStats(player.id)
    }))
    .sort(compareDataPlayers);

  if (!players.length) {
    body.innerHTML = `<tr><td colspan="5" class="muted">暂无选手</td></tr>`;
    return;
  }

  body.innerHTML = players
    .map((player) => `
      <tr>
        <td><strong>${escapeHtml(player.name)}</strong></td>
        <td>${formatAverage(player.dataStats.gpm)}</td>
        <td>${formatAverage(player.dataStats.xpm)}</td>
        <td>${formatAverage(player.dataStats.netWorth10)}</td>
        <td>${formatAverage(player.dataStats.damage)}</td>
      </tr>
    `)
    .join("");
}

function compareRecordPlayers(a, b) {
  if (recordSort === "name") return a.name.localeCompare(b.name, "zh-Hans");
  if (recordSort === "rating") return Number(b.rating || 0) - Number(a.rating || 0) || a.name.localeCompare(b.name, "zh-Hans");
  if (recordSort === "netWins") return b.stats.netWins - a.stats.netWins || b.stats.wins - a.stats.wins || Number(b.rating || 0) - Number(a.rating || 0);
  if (recordSort === "games") return b.stats.games - a.stats.games || b.stats.wins - a.stats.wins || Number(b.rating || 0) - Number(a.rating || 0);
  if (recordSort.startsWith("position-")) {
    const position = recordSort.replace("position-", "");
    return (b.positionStats.counts[position] || 0) - (a.positionStats.counts[position] || 0) || Number(b.rating || 0) - Number(a.rating || 0);
  }
  return 0;
}

function compareDataPlayers(a, b) {
  if (dataSort === "name") return a.name.localeCompare(b.name, "zh-Hans");
  return (b.dataStats[dataSort] || 0) - (a.dataStats[dataSort] || 0) || a.name.localeCompare(b.name, "zh-Hans");
}

function renderPicker() {
  const picker = $("#playerPicker");
  if (!db.players.length) {
    renderEmpty(picker);
    return;
  }

  const selected = new Set([...db.currentTeams.radiant, ...db.currentTeams.dire]);
  const isFull = selected.size === 10;
  picker.innerHTML = db.players
    .map((player) => `
      <label class="player-chip ${isFull && selected.has(player.id) ? "is-selected" : ""} ${isFull && !selected.has(player.id) ? "is-dimmed" : ""}">
        <input type="checkbox" value="${player.id}" ${selected.has(player.id) ? "checked" : ""} ${isFull && !selected.has(player.id) ? "disabled" : ""} />
        <span class="chip-meta">
          <strong>${escapeHtml(player.name)}</strong>
          <span>评分 ${formatRating(player.rating)} · 主倾向 ${getPositionStats(player.id).main}</span>
        </span>
      </label>
    `)
    .join("");
  updateSelectionUi();
}

function renderTeams() {
  const teamsGrid = $("#generatedTeams");
  if (teamsGrid) teamsGrid.classList.toggle("is-hidden", !hasGeneratedTeams);
  renderTeam($("#radiantTeam"), db.currentTeams.radiant);
  renderTeam($("#direTeam"), db.currentTeams.dire);
  $("#radiantRating").textContent = `总评分 ${sumRating(db.currentTeams.radiant).toFixed(1)}`;
  $("#direRating").textContent = `总评分 ${sumRating(db.currentTeams.dire).toFixed(1)}`;
  renderMatchEntryEditor();
}

function renderTeam(target, ids) {
  if (!ids.length) {
    target.innerHTML = `<li class="muted">还没有生成队伍</li>`;
    return;
  }

  target.innerHTML = ids
    .map((id) => {
      const player = getPlayer(id);
      if (!player) return "";
      return `<li><strong>${escapeHtml(player.name)}</strong><span>${formatRating(player.rating)}</span></li>`;
    })
    .join("");
}

function renderMatchEntryEditor() {
  const picker = $("#matchPlayerPicker");
  const editor = $("#matchDetailEditor");
  if (!picker || !editor) return;

  const ids = getCurrentMatchPlayerIds();
  if (!ids.length) {
    selectedMatchPlayerId = null;
    picker.innerHTML = renderMatchSelection();
    renderEmpty(editor);
    return;
  }

  ensureMatchDetails();
  if (!selectedMatchPlayerId || !ids.includes(selectedMatchPlayerId)) {
    selectedMatchPlayerId = ids[0];
  }

  picker.innerHTML = renderMatchSelection();

  renderSelectedMatchDetail();
}

function renderMatchSelection() {
  return `
    <div class="match-selection-layout">
      <div class="available-players">
        <h4>选择选手</h4>
        <div class="available-player-list">
          ${db.players.map((player) => renderAvailablePlayer(player)).join("")}
        </div>
      </div>
      <div class="selected-teams">
        ${renderSelectedTeam("天辉", "radiant", matchEntryTeams.radiant)}
        ${renderSelectedTeam("夜魇", "dire", matchEntryTeams.dire)}
      </div>
    </div>
  `;
}

function renderAvailablePlayer(player) {
  const side = getSelectedSide(player.id);
  const disabledRadiant = side === "dire" || (side !== "radiant" && matchEntryTeams.radiant.length >= 5);
  const disabledDire = side === "radiant" || (side !== "dire" && matchEntryTeams.dire.length >= 5);
  const stateClass = side ? `is-${side}` : "";
  const stateLabel = side === "radiant" ? "天辉" : side === "dire" ? "夜魇" : "";

  return `
    <div class="available-player ${stateClass}">
      <strong>${escapeHtml(player.name)}</strong>
      ${stateLabel ? `<span>${stateLabel}</span>` : ""}
      <div class="side-actions">
        <button class="ghost-button compact-button ${side === "radiant" ? "is-active" : ""}" data-assign-side="radiant" data-player-id="${player.id}" ${disabledRadiant ? "disabled" : ""} type="button">天</button>
        <button class="ghost-button compact-button ${side === "dire" ? "is-active" : ""}" data-assign-side="dire" data-player-id="${player.id}" ${disabledDire ? "disabled" : ""} type="button">夜</button>
        ${side ? `<button class="text-button compact-remove" data-assign-side="remove" data-player-id="${player.id}" type="button">×</button>` : ""}
      </div>
    </div>
  `;
}

function renderSelectedTeam(teamName, side, ids) {
  return `
    <div class="match-player-team">
      <h4>${teamName} ${ids.length}/5</h4>
      <div class="match-player-grid">
        ${ids.length ? ids.map((id) => renderMatchPlayerButton(id)).join("") : `<div class="empty-state compact-empty">未选择</div>`}
      </div>
    </div>
  `;
}

function renderMatchPlayerButton(playerId) {
  const player = getPlayer(playerId);
  const detail = matchDetails[playerId] || {};
  const meta = [
    detail.position ? `${detail.position}号位` : "未选位置",
    detail.hero || "未选英雄"
  ].join(" · ");

  return `
    <button class="match-player-button ${selectedMatchPlayerId === playerId ? "is-active" : ""}" data-match-player="${playerId}" type="button">
      <strong>${renderPlayerNameWithHero(player?.name || "-", detail.hero)}</strong>
      <span>${escapeHtml(meta)}</span>
    </button>
  `;
}

function renderSelectedMatchDetail() {
  const editor = $("#matchDetailEditor");
  if (!editor || !selectedMatchPlayerId) return;
  ensureHeroOptions();

  const player = getPlayer(selectedMatchPlayerId);
  const detail = matchDetails[selectedMatchPlayerId] || createEmptyDetail();

  editor.innerHTML = `
    <div class="detail-heading">
      <h4>${renderPlayerNameWithHero(player?.name || "-", detail.hero)}</h4>
      <span>录入本场个人数据</span>
    </div>
    <div class="detail-grid">
      <label>
        英雄选择
        <input data-detail-field="hero" list="heroOptions" value="${escapeHtml(detail.hero)}" placeholder="例如：帕克" />
      </label>
      <label>
        位置
        <select data-detail-field="position">
          <option value="">未选择</option>
          ${POSITIONS.map((position) => `<option value="${position}" ${detail.position === position ? "selected" : ""}>${position} 号位</option>`).join("")}
        </select>
      </label>
      <label>
        GPM
        <input data-detail-field="gpm" type="number" min="0" step="1" value="${escapeHtml(detail.gpm)}" />
      </label>
      <label>
        XPM
        <input data-detail-field="xpm" type="number" min="0" step="1" value="${escapeHtml(detail.xpm)}" />
      </label>
      <label>
        10分钟经济
        <input data-detail-field="netWorth10" type="number" min="0" step="1" value="${escapeHtml(detail.netWorth10)}" />
      </label>
      <label>
        伤害量
        <input data-detail-field="damage" type="number" min="0" step="1" value="${escapeHtml(detail.damage)}" />
      </label>
      <label>
        治疗量
        <input data-detail-field="healing" type="number" min="0" step="1" value="${escapeHtml(detail.healing)}" />
      </label>
      <label class="wide">
        特殊内容
        <input data-detail-field="special" value="${escapeHtml(detail.special)}" placeholder="例如：买活翻盘、肉山关键团、MVP 表现" />
      </label>
    </div>
  `;
}

function renderMatches() {
  $("#matchesCountLabel").textContent = `${db.matches.length} 场`;
  renderMatchCards($("#matchesList"), db.matches);
}

function renderAdmin() {
  renderAdminPlayers();
  renderAdminMatches();
  updateAdminUi();
}

function renderGenerator() {
  renderPicker();
  renderTeams();
  renderConstraintOptions();
  renderConstraints();
}

function renderAdminPlayers() {
  const body = $("#adminPlayersBody");
  if (!body) return;

  if (!db.players.length) {
    body.innerHTML = `<tr><td colspan="5" class="muted">暂无选手</td></tr>`;
    return;
  }

  body.innerHTML = db.players
    .map((player) => `
      <tr>
        <td><strong>${escapeHtml(player.name)}</strong></td>
        <td>
          <input class="rating-input" data-rating-input="${player.id}" type="number" min="0" max="10" step="0.5" value="${formatRating(player.rating)}" />
        </td>
        <td>${formatDateTime(player.ratingUpdatedAt)}</td>
        <td>${escapeHtml(player.note || "-")}</td>
        <td class="row-actions">
          <button class="text-button" data-delete-player="${player.id}" type="button">删除</button>
        </td>
      </tr>
    `)
    .join("");
}

function renderAdminMatches() {
  const target = $("#adminMatchesList");
  if (!target) return;
  if (!db.matches.length) {
    renderEmpty(target);
    return;
  }

  target.innerHTML = db.matches
    .map((match) => {
      const radiantNames = formatTeamNamesPlain(match.radiant);
      const direNames = formatTeamNamesPlain(match.dire);
      const quality = getMatchQuality(match);
      return `
        <article class="admin-match-row match-quality-${quality}">
          <div>
            <strong>${escapeHtml(formatAdminMatchCode(match))} ${renderMatchQualityBadge(match)}</strong>
            <span>${match.winner === "radiant" ? "天辉胜利" : "夜魇胜利"} · ${escapeHtml(match.score || "数据未录入")}</span>
            <span class="admin-match-teams">${escapeHtml(radiantNames)} vs ${escapeHtml(direNames)}</span>
          </div>
          <div class="row-actions">
            <button class="ghost-button compact-button" data-edit-match="${match.id}" type="button">编辑</button>
            <button class="ghost-button compact-button danger-ghost-button" data-delete-match="${match.id}" type="button">删除</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderMatchCards(target, matches) {
  if (!matches.length) {
    renderEmpty(target);
    return;
  }

  target.innerHTML = matches
    .map((match) => {
      const radiantNames = formatTeamList(match.radiant, match.positions, match.playerDetails);
      const direNames = formatTeamList(match.dire, match.positions, match.playerDetails);
      const quality = getMatchQuality(match);
      return `
        <article class="match-card match-card-button match-quality-${quality}" data-open-match="${match.id}" tabindex="0" role="button" aria-label="查看 ${escapeHtml(formatShortMatchDate(match.date))} 第 ${Number(match.matchNo || 1)} 场详情">
          <div class="match-card-main">
            <strong>${escapeHtml(formatShortMatchDate(match.date))} 第 ${Number(match.matchNo || 1)} 场 ${renderMatchQualityBadge(match)}</strong>
            <div class="match-versus">
              <span>${radiantNames}</span>
              <b>VS</b>
              <span>${direNames}</span>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
  updateAdminUi();
}

function renderMatchDialog(match) {
  const dialog = $("#matchDetailDialog");
  const body = $("#matchDetailBody");
  if (!dialog || !body || !match) return;

  body.innerHTML = `
    <section class="match-detail-hero">
      <div>
        <span>比赛</span>
        <h3>${escapeHtml(match.date)} 第 ${Number(match.matchNo || 1)} 场</h3>
      </div>
      <div class="match-result ${match.winner === "radiant" ? "radiant-win" : "dire-win"}">
        ${match.winner === "radiant" ? "天辉胜利" : "夜魇胜利"}
      </div>
    </section>

    <section class="match-meta-grid">
      <div>
        <span>比分 / 时长</span>
        <strong>${escapeHtml(match.score || "数据未录入")}</strong>
      </div>
      <div>
        <span>备注</span>
        <strong>${escapeHtml(match.note || "数据未录入")}</strong>
      </div>
    </section>

    <section class="match-detail-teams">
      ${renderDialogTeam("天辉", match.radiant, match)}
      ${renderDialogTeam("夜魇", match.dire, match)}
    </section>

    ${renderMatchDetailSummary(match)}
  `;
  dialog.showModal();
}

function handleMatchCardOpen(event) {
  const card = event.target.closest("[data-open-match]");
  if (!card) return;
  const match = db.matches.find((item) => item.id === card.dataset.openMatch);
  renderMatchDialog(match);
}

function handleMatchCardKeydown(event) {
  if (event.key !== "Enter" && event.key !== " ") return;
  const card = event.target.closest("[data-open-match]");
  if (!card) return;
  event.preventDefault();
  const match = db.matches.find((item) => item.id === card.dataset.openMatch);
  renderMatchDialog(match);
}

function renderDialogTeam(title, ids, match) {
  const details = match.playerDetails || {};
  const positions = match.positions || {};
  const players = [...ids]
    .sort((a, b) => Number(details?.[a]?.position || positions?.[a] || 99) - Number(details?.[b]?.position || positions?.[b] || 99));

  return `
    <div class="dialog-team-card">
      <h4>${title}</h4>
      <ol>
        ${players.map((id) => renderDialogPlayer(id, details[id] || {}, positions[id])).join("")}
      </ol>
    </div>
  `;
}

function renderDialogPlayer(playerId, detail, fallbackPosition) {
  const player = getPlayer(playerId);
  const position = detail.position || fallbackPosition || "-";
  const hero = detail.hero || "数据未录入";
  return `
    <li>
      <span class="dialog-player-name">${renderPlayerNameWithHero(player?.name || "-", detail.hero)}</span>
      <span class="dialog-player-hero">${escapeHtml(hero)}</span>
      <span class="dialog-player-position">${escapeHtml(position)}号位</span>
    </li>
  `;
}

function renderAll() {
  renderCurrentView();
  updateAdminUi();
}

function renderCurrentView() {
  const activeView = $(".view.is-active")?.id || "dashboard";
  const renderers = {
    dashboard: renderDashboard,
    players: renderPlayers,
    rankings: renderRankings,
    generator: renderGenerator,
    matches: renderMatches,
    data: renderAdmin
  };
  renderers[activeView]?.();
  updateAdminUi();
}

function renderTendency(playerId) {
  const stats = getPositionStats(playerId);
  if (!stats.total) return `<span class="muted">暂无比赛</span>`;

  return `
    <div class="tendency" title="共 ${stats.total} 场有位置记录">
      ${POSITIONS.map((position) => {
        const count = stats.counts[position];
        const dots = Array.from({ length: Math.min(count, 12) }, () => `<i class="position-dot position-dot-${position}" title="${position}号位"></i>`).join("");
        return `
          <span class="position-zone" title="${position}号位 ${count} 次">
            <span class="position-balls">${dots}</span>
          </span>
        `;
      }).join("")}
    </div>
  `;
}

function getSelectedPlayerIds() {
  return $$("#playerPicker input:checked").map((input) => input.value);
}

function handlePlayerPickerChange(event) {
  const input = event.target.closest("#playerPicker input");
  if (input?.checked && getSelectedPlayerIds().length > 10) {
    input.checked = false;
  }
  updateSelectionUi();
}

function getBalanceMode() {
  return document.querySelector('input[name="balanceMode"]:checked')?.value || "position";
}

function updateBalanceModeDescription() {
  const target = $("#balanceModeDescription");
  if (!target) return;
  target.innerHTML = `
    <p>${escapeHtml(BALANCE_MODE_DESCRIPTIONS[getBalanceMode()] || "")}</p>
  `;
}

function getCurrentPositions() {
  return Object.fromEntries(
    Object.entries(matchDetails)
      .filter(([, detail]) => detail.position)
      .map(([playerId, detail]) => [playerId, detail.position])
  );
}

function getCurrentMatchPlayerIds() {
  return [...matchEntryTeams.radiant, ...matchEntryTeams.dire];
}

function getSelectedSide(playerId) {
  if (matchEntryTeams.radiant.includes(playerId)) return "radiant";
  if (matchEntryTeams.dire.includes(playerId)) return "dire";
  return "";
}

function assignMatchPlayer(playerId, side) {
  updateSelectedDetailFromForm();
  matchEntryTeams.radiant = matchEntryTeams.radiant.filter((id) => id !== playerId);
  matchEntryTeams.dire = matchEntryTeams.dire.filter((id) => id !== playerId);

  if (side === "radiant" && matchEntryTeams.radiant.length < 5) {
    matchEntryTeams.radiant.push(playerId);
    selectedMatchPlayerId = playerId;
  }

  if (side === "dire" && matchEntryTeams.dire.length < 5) {
    matchEntryTeams.dire.push(playerId);
    selectedMatchPlayerId = playerId;
  }

  if (side === "remove" && selectedMatchPlayerId === playerId) {
    selectedMatchPlayerId = getCurrentMatchPlayerIds()[0] || null;
  }

  ensureMatchDetails();
  renderMatchEntryEditor();
}

function editMatch(matchId) {
  const match = db.matches.find((item) => item.id === matchId);
  if (!match) return;
  editingMatchId = match.id;
  matchEntryTeams = {
    radiant: [...match.radiant],
    dire: [...match.dire]
  };
  matchDetails = structuredClone(match.playerDetails || {});
  selectedMatchPlayerId = getCurrentMatchPlayerIds()[0] || null;

  $("#matchDate").value = match.date || "";
  $("#matchNo").value = match.matchNo || 1;
  const [score = "", duration = ""] = String(match.score || "").split(" / ");
  setScoreValue(score.trim());
  setDurationValue(duration.trim());
  $("#matchWinner").value = match.winner || "radiant";
  $("#matchNote").value = match.note || "";
  $("#matchSubmitButton").textContent = "保存修改";
  $("#matchForm").classList.remove("is-hidden");
  switchView("data");
  renderMatchEntryEditor();
}

function resetMatchForm() {
  setScoreValue("");
  setDurationValue("");
  $("#matchNote").value = "";
  $("#matchNo").value = "";
  editingMatchId = null;
  matchDetails = {};
  matchEntryTeams = { radiant: [], dire: [] };
  selectedMatchPlayerId = null;
  $("#matchSubmitButton").textContent = "录入比赛";
  $("#matchForm").classList.remove("is-hidden");
  renderMatchEntryEditor();
}

function createEmptyDetail() {
  return {
    hero: "",
    position: "",
    gpm: "",
    xpm: "",
    netWorth10: "",
    damage: "",
    healing: "",
    special: ""
  };
}

function ensureMatchDetails() {
  const ids = getCurrentMatchPlayerIds();
  const next = {};
  matchEntryTeams.radiant.forEach((id, index) => {
    next[id] = {
      ...createEmptyDetail(),
      ...(matchDetails[id] || {}),
      position: matchDetails[id]?.position || String((index % 5) + 1)
    };
  });
  matchEntryTeams.dire.forEach((id, index) => {
    next[id] = {
      ...createEmptyDetail(),
      ...(matchDetails[id] || {}),
      position: matchDetails[id]?.position || String((index % 5) + 1)
    };
  });
  matchDetails = next;
}

function isBlank(value) {
  return String(value ?? "").trim() === "";
}

function canSaveMatchDraft() {
  if (matchEntryTeams.radiant.length !== 5 || matchEntryTeams.dire.length !== 5) {
    alert("请先选择 10 名选手，天辉和夜魇各 5 名。");
    return false;
  }

  const missingFields = [];
  if (isBlank($("#matchDate").value)) missingFields.push("比赛日期");
  if (isBlank($("#matchNo").value)) missingFields.push("当日第几场");
  if (isBlank($("#matchScoreRadiant").value) || isBlank($("#matchScoreDire").value)) missingFields.push("比分");
  if (isBlank($("#matchDurationMinutes").value) || isBlank($("#matchDurationSeconds").value)) missingFields.push("时长");
  if (isBlank($("#matchWinner").value)) missingFields.push("获胜方");

  getCurrentMatchPlayerIds().forEach((playerId) => {
    const playerName = getPlayer(playerId)?.name || "未知选手";
    const detail = matchDetails[playerId] || {};
    if (isBlank(detail.hero)) missingFields.push(`${playerName} 的英雄`);
    if (isBlank(detail.position)) missingFields.push(`${playerName} 的位置`);
    if (isBlank(detail.gpm)) missingFields.push(`${playerName} 的 GPM`);
    if (isBlank(detail.xpm)) missingFields.push(`${playerName} 的 XPM`);
    if (isBlank(detail.netWorth10)) missingFields.push(`${playerName} 的 10分钟经济`);
    if (isBlank(detail.damage)) missingFields.push(`${playerName} 的伤害量`);
    if (isBlank(detail.healing)) missingFields.push(`${playerName} 的治疗量`);
  });

  return !missingFields.length || confirm("信息不完整，是否先保存当前内容");
}

function updateSelectedDetailFromForm() {
  if (!selectedMatchPlayerId) return;
  const detail = { ...(matchDetails[selectedMatchPlayerId] || createEmptyDetail()) };
  $$("[data-detail-field]").forEach((input) => {
    detail[input.dataset.detailField] = input.value;
  });
  matchDetails[selectedMatchPlayerId] = detail;
}

async function saveTeams() {
  const ids = getSelectedPlayerIds();
  if (ids.length !== 10) {
    alert(`需要刚好选择 10 名选手，现在选择了 ${ids.length} 名。`);
    return;
  }

  db.currentTeams = await adminApi("/api/teams", {
    method: "POST",
    body: JSON.stringify({
      ids,
      mode: getBalanceMode(),
      constraints
    })
  });
  hasGeneratedTeams = true;
  renderPicker();
  renderTeams();
}

function renderConstraintOptions() {
  const selected = getSelectedPlayerIds();
  const options = selected
    .map((id) => `<option value="${id}">${escapeHtml(getPlayer(id)?.name || id)}</option>`)
    .join("");
  ["#constraintPlayerA", "#constraintPlayerB"].forEach((selector) => {
    const element = $(selector);
    if (!element) return;
    const oldValue = element.value;
    element.innerHTML = options || `<option value="">先勾选选手</option>`;
    if (selected.includes(oldValue)) element.value = oldValue;
  });

  constraints = constraints.filter((item) => selected.includes(item.a) && selected.includes(item.b));
  renderConstraints();
}

function renderConstraints() {
  const target = $("#constraintsList");
  if (!target) return;
  if (!constraints.length) {
    target.innerHTML = `<div class="empty-state compact-empty">暂无预设</div>`;
    return;
  }

  target.innerHTML = constraints
    .map((item, index) => `
      <div class="constraint-item">
        <span>${escapeHtml(getPlayer(item.a)?.name || "-")} ${item.type === "teammate" ? "挚友" : "仇人"} ${escapeHtml(getPlayer(item.b)?.name || "-")}</span>
        <button class="text-button" data-remove-constraint="${index}" type="button">移除</button>
      </div>
    `)
    .join("");
}

function updateSelectionUi() {
  const count = getSelectedPlayerIds().length;
  const isFull = count === 10;
  const label = $("#selectionCount");
  if (label) label.textContent = `已选 ${count}/10`;
  $$("#playerPicker .player-chip").forEach((chip) => {
    const input = chip.querySelector("input");
    const checked = Boolean(input?.checked);
    chip.classList.toggle("is-selected", isFull && checked);
    chip.classList.toggle("is-dimmed", isFull && !checked);
    if (input) input.disabled = isFull && !checked;
  });
  renderConstraintOptions();
}

function updateAdminUi() {
  document.body.classList.toggle("is-admin", isAdmin);
  const status = $("#adminStatus");
  if (status) status.textContent = isAdmin
    ? "管理员模式已开启，当前页面可以修改数据。"
    : "未进入管理员模式。进入后可以添加/删除人员、改评分、保存比赛和管理数据。";
  const login = $("#adminLogin");
  const logout = $("#adminLogout");
  const passwordInput = $("#adminPasswordInput");
  if (login) login.style.display = isAdmin ? "none" : "";
  if (logout) logout.style.display = isAdmin ? "" : "none";
  if (passwordInput) passwordInput.style.display = isAdmin ? "none" : "";
  $$("[data-rating-input]").forEach((input) => {
    input.disabled = !isAdmin;
  });
}

function formatRating(value) {
  return Number(value || 0).toFixed(1);
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}/${month}/${day} ${hour}:${minute}`;
}

function setDurationValue(value) {
  const minutes = $("#matchDurationMinutes");
  const seconds = $("#matchDurationSeconds");
  if (!minutes || !seconds) return;
  const match = String(value || "").match(/(\d+)\s*:\s*(\d+)/);
  minutes.value = match ? String(Number(match[1])) : "";
  seconds.value = match ? String(Math.min(59, Number(match[2]))) : "";
}

function getDurationValue() {
  const minutes = $("#matchDurationMinutes")?.value;
  const seconds = $("#matchDurationSeconds")?.value;
  if (!minutes && !seconds) return "";
  const safeMinutes = Number(minutes || 0);
  const safeSeconds = Math.min(59, Number(seconds || 0));
  return `${safeMinutes}:${String(safeSeconds).padStart(2, "0")}`;
}

function setScoreValue(value) {
  const radiant = $("#matchScoreRadiant");
  const dire = $("#matchScoreDire");
  if (!radiant || !dire) return;
  const match = String(value || "").match(/(\d+)\s*-\s*(\d+)/);
  radiant.value = match ? match[1] : "";
  dire.value = match ? match[2] : "";
}

function getScoreValue() {
  const radiant = $("#matchScoreRadiant")?.value;
  const dire = $("#matchScoreDire")?.value;
  if (!radiant && !dire) return "";
  return `${Number(radiant || 0)}-${Number(dire || 0)}`;
}

function formatShortMatchDate(value) {
  if (!value) return "-";
  const parts = String(value).split("-");
  return parts.length === 3 ? `${parts[1]}-${parts[2]}` : String(value);
}

function formatAdminMatchCode(match) {
  const matchNo = String(Number(match.matchNo || 1)).padStart(2, "0");
  return `${formatShortMatchDate(match.date)}-${matchNo}`;
}

function normalizeHeroName(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s_'’.-]/g, "");
}

function findHero(value) {
  const key = normalizeHeroName(value);
  if (!key) return null;
  return HEROES.find((hero) => {
    const candidates = [hero.cn, hero.name, hero.slug, ...(hero.aliases || [])];
    return candidates.some((item) => normalizeHeroName(item) === key);
  }) || null;
}

function heroImageUrl(hero) {
  return `${HERO_IMAGE_BASE}/${hero.slug}.png`;
}

function renderHeroAvatar(heroName) {
  const hero = findHero(heroName);
  if (!hero) return "";
  return `<img class="hero-avatar" src="${heroImageUrl(hero)}" alt="" title="${escapeHtml(hero.cn)}" loading="lazy" />`;
}

function renderPlayerNameWithHero(name, heroName) {
  const avatar = renderHeroAvatar(heroName);
  return `<span class="player-hero-label">${avatar}<em>${escapeHtml(name)}</em></span>`;
}

function ensureHeroOptions() {
  if (!HEROES.length || $("#heroOptions")) return;
  const datalist = document.createElement("datalist");
  datalist.id = "heroOptions";
  datalist.innerHTML = HEROES
    .map((hero) => `<option value="${escapeHtml(hero.cn)}">${escapeHtml(hero.name)}</option>`)
    .join("");
  document.body.appendChild(datalist);
}

function formatTeamNamesPlain(ids = []) {
  return ids
    .map((id) => getPlayer(id)?.name)
    .filter(Boolean)
    .join("、") || "-";
}

function formatTeamList(ids, positions = {}, details = {}) {
  const items = [...ids]
    .sort((a, b) => Number(details?.[a]?.position || positions?.[a] || 99) - Number(details?.[b]?.position || positions?.[b] || 99))
    .map((id) => {
      const player = getPlayer(id);
      if (!player) return "";
      return `<i>${renderPlayerNameWithHero(player.name, details?.[id]?.hero)}</i>`;
    })
    .filter(Boolean)
    .join("");
  return items || "<i>-</i>";
}

function formatWinLoss(stats) {
  return stats.games ? `${stats.wins}胜${stats.losses}负` : "无记录";
}

function formatAverage(value) {
  return value === null || value === undefined ? "-" : String(value);
}

function renderMatchDetailSummary(match) {
  const details = match.playerDetails || {};
  const rows = [...match.radiant, ...match.dire]
    .sort((a, b) => Number(details[a]?.position || match.positions?.[a] || 99) - Number(details[b]?.position || match.positions?.[b] || 99))
    .map((id) => {
      const player = getPlayer(id);
      const detail = details[id] || {};
      return `
        <tr>
          <td>${renderPlayerNameWithHero(player?.name || "-", detail.hero)}</td>
          <td>${renderStatValue(detail.gpm)}</td>
          <td>${renderStatValue(detail.xpm)}</td>
          <td>${renderStatValue(detail.netWorth10)}</td>
          <td>${renderStatValue(detail.damage)}</td>
          <td>${renderStatValue(detail.healing)}</td>
          <td>${escapeHtml(detail.special || "数据未录入")}</td>
        </tr>
      `;
    });

  if (!rows.length) return "";
  return `
    <section class="match-data-card">
      <h4>个人数据</h4>
      <div class="match-data-table-wrap">
        <table class="match-data-table">
          <thead>
            <tr>
              <th>选手</th>
              <th>GPM</th>
              <th>XPM</th>
              <th>10分钟经济</th>
              <th>伤害</th>
              <th>治疗</th>
              <th>特殊内容</th>
            </tr>
          </thead>
          <tbody>${rows.join("")}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderStatValue(value) {
  return value === "" || value === null || value === undefined ? `<span class="missing-data">数据未录入</span>` : escapeHtml(value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function bindEvents() {
  setupAdminLayout();

  document.addEventListener("error", (event) => {
    if (event.target?.classList?.contains("hero-avatar")) {
      event.target.remove();
    }
  }, true);

  $$(".nav-tab").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  $("#recentMatches").addEventListener("click", handleMatchCardOpen);
  $("#recentMatches").addEventListener("keydown", handleMatchCardKeydown);
  $("#closeMatchDialog").addEventListener("click", () => $("#matchDetailDialog").close());
  $("#matchDetailDialog").addEventListener("click", (event) => {
    if (event.target.id === "matchDetailDialog") event.target.close();
  });

  $("#rankingSort")?.addEventListener("change", renderRankings);

  $("#players").addEventListener("click", (event) => {
    const sortKey = event.target.dataset.recordSort;
    if (!sortKey) return;
    recordSort = sortKey;
    renderPlayers();
  });

  $("#rankings").addEventListener("click", (event) => {
    const sortKey = event.target.dataset.dataSort;
    if (!sortKey) return;
    dataSort = sortKey;
    renderRankings();
  });

  $("#playerForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await adminApi("/api/players", {
        method: "POST",
        body: JSON.stringify({
          name: $("#playerName").value.trim(),
          rating: $("#playerRating").value || 5,
          note: $("#playerNote").value.trim()
        })
      });
      event.currentTarget.reset();
      await loadState();
    } catch (error) {
      alert(error.message);
    }
  });

  $("#playerPicker").addEventListener("change", handlePlayerPickerChange);

  $("#matchPlayerPicker").addEventListener("click", (event) => {
    const assignButton = event.target.closest("[data-assign-side]");
    if (assignButton) {
      assignMatchPlayer(assignButton.dataset.playerId, assignButton.dataset.assignSide);
      return;
    }

    const button = event.target.closest("[data-match-player]");
    if (!button) return;
    updateSelectedDetailFromForm();
    selectedMatchPlayerId = button.dataset.matchPlayer;
    renderMatchEntryEditor();
  });

  $("#matchDetailEditor").addEventListener("input", () => {
    updateSelectedDetailFromForm();
  });

  $("#matchDetailEditor").addEventListener("change", () => {
    updateSelectedDetailFromForm();
    renderMatchEntryEditor();
  });

  $("#addConstraint").addEventListener("click", () => {
    const a = $("#constraintPlayerA").value;
    const b = $("#constraintPlayerB").value;
    const type = $("#constraintType").value;
    if (!a || !b || a === b) {
      alert("请选择两名不同的选手。");
      return;
    }
    if (constraints.some((item) => item.a === a && item.b === b && item.type === type)) {
      alert("这个预设已经存在。");
      return;
    }
    constraints.push({ a, b, type });
    renderConstraints();
  });

  $("#constraintsList").addEventListener("click", (event) => {
    const index = event.target.dataset.removeConstraint;
    if (index === undefined) return;
    constraints.splice(Number(index), 1);
    renderConstraints();
  });

  $("#adminPlayersBody").addEventListener("click", async (event) => {
    const deleteId = event.target.dataset.deletePlayer;
    if (!deleteId) return;

    try {
      if (!confirm("确定删除这个选手吗？相关历史比赛会保留，但无法再显示这个名字。")) return;
      await adminApi(`/api/players/${deleteId}`, { method: "DELETE" });
      await loadState();
    } catch (error) {
      alert(error.message);
    }
  });

  $("#adminPlayersBody").addEventListener("change", async (event) => {
    const input = event.target.closest("[data-rating-input]");
    if (!input) return;

    try {
      await adminApi(`/api/players/${input.dataset.ratingInput}/rating`, {
        method: "PUT",
        body: JSON.stringify({ rating: input.value })
      });
      await loadState();
    } catch (error) {
      alert(error.message);
    }
  });

  $("#clearSelection").addEventListener("click", async () => {
    try {
      db.currentTeams = { radiant: [], dire: [] };
      await adminApi("/api/teams/manual", {
        method: "POST",
        body: JSON.stringify(db.currentTeams)
      });
      hasGeneratedTeams = false;
      matchDetails = {};
      selectedMatchPlayerId = null;
      renderAll();
    } catch (error) {
      alert(error.message);
    }
  });

  $$('input[name="balanceMode"]').forEach((input) => {
    input.addEventListener("change", updateBalanceModeDescription);
  });
  updateBalanceModeDescription();
  $("#generateTeams").addEventListener("click", () => saveTeams().catch((error) => alert(error.message)));

  $("#matchDate").valueAsDate = new Date();

  $("#matchForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      updateSelectedDetailFromForm();
      ensureMatchDetails();
      if (!canSaveMatchDraft()) return;
      const score = getScoreValue();
      const duration = getDurationValue();
      await adminApi(editingMatchId ? `/api/matches/${editingMatchId}` : "/api/matches", {
        method: editingMatchId ? "PUT" : "POST",
        body: JSON.stringify({
          date: $("#matchDate").value,
          matchNo: $("#matchNo").value || 1,
          winner: $("#matchWinner").value,
          score: [score, duration].filter(Boolean).join(" / "),
          note: $("#matchNote").value.trim(),
          radiant: matchEntryTeams.radiant,
          dire: matchEntryTeams.dire,
          positions: getCurrentPositions(),
          playerDetails: matchDetails
        })
      });
      resetMatchForm();
      await loadState();
    } catch (error) {
      alert(error.message);
    }
  });

  $("#matchesList").addEventListener("click", handleMatchCardOpen);
  $("#matchesList").addEventListener("keydown", handleMatchCardKeydown);

  $("#adminMatchesList").addEventListener("click", async (event) => {
    const editId = event.target.dataset.editMatch;
    const deleteId = event.target.dataset.deleteMatch;
    if (editId) {
      editMatch(editId);
      return;
    }
    if (!deleteId) return;
    if (!confirm("确定删除这场比赛记录吗？")) return;

    try {
      await adminApi(`/api/matches/${deleteId}`, { method: "DELETE" });
      await loadState();
    } catch (error) {
      alert(error.message);
    }
  });

  $("#exportData").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `dota-inhouse-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });

  $("#importData").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const imported = JSON.parse(await file.text());
      await adminApi("/api/import", {
        method: "POST",
        body: JSON.stringify(imported)
      });
      await loadState();
      alert("导入成功。");
    } catch (error) {
      alert(error.message || "导入失败，请确认文件是本工具导出的 JSON。");
    } finally {
      event.target.value = "";
    }
  });

  $("#resetData").addEventListener("click", async () => {
    if (!confirm("确定清空所有选手和比赛数据吗？这个操作不能撤销。")) return;
    try {
      await adminApi("/api/reset", { method: "POST" });
      await loadState();
    } catch (error) {
      alert(error.message);
    }
  });

  $("#adminLogin").addEventListener("click", async () => {
    try {
      const password = $("#adminPasswordInput").value;
      if (!password) {
        alert("请输入管理员密码。");
        return;
      }
      await verifyAdminPassword(password);
      $("#adminPasswordInput").value = "";
      alert("已进入管理员模式。");
    } catch (error) {
      alert(error.message);
    }
  });

  $("#adminLogout").addEventListener("click", () => {
    sessionStorage.removeItem(ADMIN_PASSWORD_KEY);
    isAdmin = false;
    updateAdminUi();
    alert("已退出管理员模式。");
  });

  updateAdminUi();
}

function setupAdminLayout() {
  const mount = $("#adminMatchFormMount");
  const form = $("#matchForm");
  if (mount && form && form.parentElement !== mount) {
    mount.appendChild(form);
  }
}

bindEvents();
restoreAdminSession().then(loadState).catch((error) => {
  document.body.innerHTML = `
    <main style="padding: 32px; font-family: system-ui, sans-serif;">
      <h1>后端服务没有连接上</h1>
      <p>请在项目目录运行 <code>npm start</code>，然后打开 <code>http://localhost:3000</code>。</p>
      <pre>${escapeHtml(error.message)}</pre>
    </main>
  `;
});
