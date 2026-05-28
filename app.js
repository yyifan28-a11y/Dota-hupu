let db = {
  players: [],
  matches: [],
  currentTeams: { radiant: [], dire: [] },
  playoffTeams: { A: [], B: [], C: [], D: [] }
};

const POSITIONS = ["1", "2", "3", "4", "5"];
const HEROES = Array.isArray(window.DOTA_HEROES) ? window.DOTA_HEROES : [];
const HERO_IMAGE_BASE = "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes";
const ADMIN_PASSWORD_KEY = "dota-admin-password";
const APP_ENTERED_KEY = "dota-app-entered";
const ACTIVE_VIEW_KEY = "dota-active-view";
const TEAM_GENERATION_COOLDOWN_KEY = "dota-team-generation-cooldown";
const TEAM_GENERATION_COOLDOWN_MS = 60 * 1000;
const REQUIRED_DETAIL_FIELDS = [
  "hero",
  "position",
  "kills",
  "deaths",
  "assists",
  "participation",
  "damageShare",
  "gpm",
  "xpm",
  "netWorth10",
  "damage",
  "buildingDamage",
  "damageTaken",
  "healing"
];
const BALANCE_MODE_DESCRIPTIONS = {
  position: "尽量让同队选手的常用位置不重复。",
  combination: "优先减少老队友组合，让大家更常遇到新搭配。",
  random: "在可用候选里随机抽一组，不额外考虑位置、胜率或历史组合。",
  winrate: "让两边平均胜率尽量接近。"
};
const BALANCE_MODE_LABELS = {
  position: "位置优先",
  combination: "组合优先",
  random: "完全随机",
  winrate: "胜率平衡"
};

const RATING_TREND_COLORS = [
  "#d61f69",
  "#2563eb",
  "#f59e0b",
  "#16a34a",
  "#7c3aed",
  "#ef4444",
  "#0891b2",
  "#c2410c",
  "#84cc16",
  "#db2777",
  "#4f46e5",
  "#ca8a04",
  "#0d9488",
  "#e11d48",
  "#9333ea",
  "#65a30d",
  "#ea580c",
  "#0284c7",
  "#a21caf",
  "#b45309",
  "#059669",
  "#dc2626",
  "#6366f1",
  "#be123c",
  "#22c55e",
  "#f97316",
  "#06b6d4",
  "#a855f7",
  "#eab308",
  "#14b8a6",
  "#f43f5e",
  "#8b5cf6"
];

let isAdmin = Boolean(sessionStorage.getItem(ADMIN_PASSWORD_KEY));
let constraints = [];
let matchDetails = {};
let selectedMatchPlayerId = null;
let matchEntryTeams = { radiant: [], dire: [] };
let editingMatchId = null;
let recordSort = "rating";
let recordSortDirection = "desc";
let recordCardActiveRanks = {};
let hasGeneratedTeams = false;
let generatedBalanceMode = "position";
let playerById = new Map();
let statsByPlayerId = new Map();
let dataStatsByPlayerId = new Map();
let heroUsageByPlayerId = new Map();
let heroRankStats = [];
let pairRankStats = { teammate: [], trio: [], opponent: [] };
let pendingExcelMatches = [];
let pendingRatingSnapshots = [];
let showAllDashboardMatches = false;
let activeDataViewMode = "basic";
let selectedPlayerProfileId = "";
let selectedPlayerProfilePosition = "";
let selectedPlayerProfileHeroKey = "";
let showAllPlayerProfileMatches = false;
let adminPlayoffDraftTeams = null;
let adminPlayoffSelectedPlayerId = "";
let adminPlayoffSelectedTeam = "";
let teamGenerationCooldownTimer = null;
let playerSearchSelectedId = "";
let isComposingPlayerSearch = false;
let ratingTrendSelectedIds = [];
let ratingTrendHasUserSelection = false;
let heroRankModes = {
  positive: "winrate",
  negative: "winrate",
  singleHeat: "total",
  reverseSingleHeat: "netLoss"
};
let heroUsageSort = "total";
let pairRankModes = {
  bestFriends: "winrate",
  bigThree: "winrate",
  poorFriends: "winrate",
  stomp: "winrate"
};
let stateLoadPromise = null;

const dataSortState = {
  basicData: { key: "rating", direction: "desc" },
  advancedData: { key: "gpm", direction: "desc" }
};

const BASIC_DATA_COLUMNS = [
  { key: "name", label: "昵称", sortLabel: "按昵称排序" },
  { key: "rating", label: "评分", sortLabel: "按评分排序" },
  { key: "kills", label: "场均击杀", sortLabel: "按场均击杀排序" },
  { key: "deaths", label: "场均死亡", sortLabel: "按场均死亡排序" },
  { key: "assists", label: "场均助攻", sortLabel: "按场均助攻排序" },
  { key: "damage", label: "场均伤害量", sortLabel: "按场均伤害量排序" },
  { key: "damageShare", label: "场均伤害占比", sortLabel: "按场均伤害占比排序", type: "percent" }
];

const ADVANCED_DATA_COLUMNS = [
  { key: "name", label: "昵称", sortLabel: "按昵称排序" },
  { key: "gpm", label: "场均 GPM", sortLabel: "按场均 GPM 排序" },
  { key: "xpm", label: "场均 XPM", sortLabel: "按场均 XPM 排序" },
  { key: "participation", label: "场均参战率", sortLabel: "按场均参战率排序", type: "percent" },
  { key: "buildingDamage", label: "场均建筑伤害", sortLabel: "按场均建筑伤害排序" },
  { key: "netWorth10", label: "场均10分钟经济", sortLabel: "按场均10分钟经济排序" },
  { key: "damageTaken", label: "场均承受伤害", sortLabel: "按场均承受伤害排序" }
];

const RECORD_COLUMNS = [
  { key: "name", label: "昵称", sortLabel: "按昵称排序" },
  { key: "rating", label: "评分", sortLabel: "按评分排序" },
  { key: "netWins", label: "胜负", sortLabel: "按胜负排序" },
  { key: "games", label: "场次", sortLabel: "按场次排序" },
  { key: "position-1", label: "一号位", sortLabel: "按一号位次数排序" },
  { key: "position-2", label: "二号位", sortLabel: "按二号位次数排序" },
  { key: "position-3", label: "三号位", sortLabel: "按三号位次数排序" },
  { key: "position-4", label: "四号位", sortLabel: "按四号位次数排序" },
  { key: "position-5", label: "五号位", sortLabel: "按五号位次数排序" }
];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.error || `请求失败：${response.status}`);
    Object.assign(error, payload);
    throw error;
  }

  if (response.status === 204) return null;
  return response.json();
}

async function adminApi(path, options = {}) {
  let password = sessionStorage.getItem(ADMIN_PASSWORD_KEY);
  const hadStoredPassword = Boolean(password);
  if (!password) {
    password = $("#adminPasswordInput")?.value;
    if (!password) throw new Error("请先在“数据”页的管理员入口输入密码并进入管理员模式。");
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
  adminPlayoffDraftTeams = null;
  rebuildDerivedStats();
  updateSplashStats();
  renderAll();
}

function ensureStateLoaded() {
  if (stateLoadPromise) return stateLoadPromise;
  stateLoadPromise = loadState().catch((error) => {
    stateLoadPromise = null;
    throw error;
  });
  return stateLoadPromise;
}

async function loadSplashSummary() {
  const summary = await api("/api/summary");
  updateSplashStats(summary);
}

function updateSplashStats(summary = null) {
  const playerCount = $("#splashPlayerCount");
  const matchCount = $("#splashMatchCount");
  if (playerCount) playerCount.textContent = summary?.players ?? db.players.length;
  if (matchCount) matchCount.textContent = summary?.matches ?? db.matches.length;
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
    records: Object.fromEntries(POSITIONS.map((position) => [position, { wins: 0, losses: 0 }])),
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
    kills: null,
    deaths: null,
    assists: null,
    gpm: null,
    xpm: null,
    netWorth10: null,
    damage: null,
    buildingDamage: null,
    damageTaken: null,
    damageShare: null,
    participation: null
  };
}

function getHeroIdentity(heroName) {
  const name = String(heroName || "").trim();
  const hero = findHero(name);
  return {
    key: hero?.slug || normalizeHeroName(name),
    name: hero?.cn || name,
    originalName: name
  };
}

function addHeroUsage(playerId, heroName, isWin) {
  const usage = heroUsageByPlayerId.get(playerId);
  if (!usage) return;
  const identity = getHeroIdentity(heroName);
  if (!identity.key) return;
  const current = usage.get(identity.key) || { ...identity, count: 0, wins: 0 };
  current.count += 1;
  if (isWin) current.wins += 1;
  usage.set(identity.key, current);
}

function addHeroRankGame(heroStatsByKey, heroName, isWin) {
  const identity = getHeroIdentity(heroName);
  if (!identity.key) return;
  const stats = heroStatsByKey.get(identity.key) || {
    ...identity,
    games: 0,
    wins: 0
  };
  stats.games += 1;
  if (isWin) stats.wins += 1;
  heroStatsByKey.set(identity.key, stats);
}

function addTeammatePair(pairStatsByKey, a, b, isWin) {
  const key = pairStatKey(a, b);
  const stats = pairStatsByKey.get(key) || {
    key,
    players: key.split("::"),
    games: 0,
    wins: 0
  };
  stats.games += 1;
  if (isWin) stats.wins += 1;
  pairStatsByKey.set(key, stats);
}

function addTeammateTrio(trioStatsByKey, a, b, c, isWin) {
  const key = trioStatKey(a, b, c);
  const stats = trioStatsByKey.get(key) || {
    key,
    players: key.split("::"),
    games: 0,
    wins: 0
  };
  stats.games += 1;
  if (isWin) stats.wins += 1;
  trioStatsByKey.set(key, stats);
}

function pairStatKey(a, b) {
  return [a, b].sort().join("::");
}

function trioStatKey(a, b, c) {
  return [a, b, c].sort().join("::");
}

function addOpponentPair(pairStatsByKey, playerId, opponentId, isWin) {
  const key = `${playerId}::${opponentId}`;
  const stats = pairStatsByKey.get(key) || {
    key,
    playerId,
    opponentId,
    games: 0,
    wins: 0
  };
  stats.games += 1;
  if (isWin) stats.wins += 1;
  pairStatsByKey.set(key, stats);
}

function addOpponentMatchup(pairStatsByKey, playerId, opponentId) {
  const players = [playerId, opponentId].sort();
  const key = players.join("::");
  const stats = pairStatsByKey.get(key) || {
    key,
    playerId: players[0],
    opponentId: players[1],
    games: 0,
    wins: 0
  };
  stats.games += 1;
  pairStatsByKey.set(key, stats);
}

function finalizePairStats(stats) {
  return Array.from(stats.values()).map((item) => {
    const losses = item.games - item.wins;
    return {
      ...item,
      losses,
      netWins: item.wins - losses,
      winrate: item.games ? item.wins / item.games : 0
    };
  });
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
  const score = scoreParts[0] || "";
  return Boolean(
    match.date
    && Number(match.matchNo || 0) > 0
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
    return isCompleteMatchDetail({ ...detail, position: detail.position || match.positions?.[playerId] || "" });
  });
}

function hasNumericDetail(value) {
  if (isBlank(value)) return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0;
}

function isCompleteDetailField(detail = {}, field) {
  if (field === "hero") return !isBlank(detail.hero);
  if (field === "position") return POSITIONS.includes(String(detail.position || ""));
  return hasNumericDetail(detail[field]);
}

function isCompleteMatchDetail(detail = {}) {
  return REQUIRED_DETAIL_FIELDS.every((field) => isCompleteDetailField(detail, field));
}

function renderEntryStatusIcon(isComplete, label) {
  return `<span class="entry-status ${isComplete ? "is-complete" : "is-missing"}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"></span>`;
}

function renderMatchQualityBadge(match) {
  const quality = getMatchQuality(match);
  return `<span class="quality-badge quality-${quality}">${getMatchQualityLabel(quality)}</span>`;
}

function rebuildDerivedStats() {
  playerById = new Map(db.players.map((player) => [player.id, player]));
  statsByPlayerId = new Map(db.players.map((player) => [player.id, createEmptyPlayerStats()]));
  heroUsageByPlayerId = new Map(db.players.map((player) => [player.id, new Map()]));
  const heroStatsByKey = new Map();
  const teammateStatsByKey = new Map();
  const trioStatsByKey = new Map();
  const opponentStatsByKey = new Map();
  const opponentMatchupStatsByKey = new Map();

  const dataTotals = new Map(db.players.map((player) => [player.id, {
    kills: 0,
    deaths: 0,
    assists: 0,
    gpm: 0,
    xpm: 0,
    netWorth10: 0,
    damage: 0,
    buildingDamage: 0,
    damageTaken: 0,
    damageShare: 0,
    participation: 0
  }]));
  const dataCounts = new Map(db.players.map((player) => [player.id, {
    kills: 0,
    deaths: 0,
    assists: 0,
    gpm: 0,
    xpm: 0,
    netWorth10: 0,
    damage: 0,
    buildingDamage: 0,
    damageTaken: 0,
    damageShare: 0,
    participation: 0
  }]));

  db.matches.forEach((match) => {
    const quality = getMatchQuality(match);
    if (quality === "draft") return;

    [
      ["radiant", match.radiant || []],
      ["dire", match.dire || []]
    ].forEach(([side, ids]) => {
      const isWin = match.winner === side;
      ids.forEach((playerId) => {
        const stats = statsByPlayerId.get(playerId);
        if (!stats) return;

        stats.games += 1;
        if (isWin) stats.wins += 1;

        const position = match.playerDetails?.[playerId]?.position || match.positions?.[playerId];
        if (POSITIONS.includes(position)) {
          stats.positionStats.counts[position] += 1;
          if (isWin) {
            stats.positionStats.records[position].wins += 1;
          } else {
            stats.positionStats.records[position].losses += 1;
          }
          stats.positionStats.total += 1;
        }

        const heroName = match.playerDetails?.[playerId]?.hero;
        if (!isBlank(heroName)) {
          addHeroUsage(playerId, heroName, isWin);
          addHeroRankGame(heroStatsByKey, heroName, isWin);
        }
      });

      for (let index = 0; index < ids.length; index += 1) {
        for (let nextIndex = index + 1; nextIndex < ids.length; nextIndex += 1) {
          addTeammatePair(teammateStatsByKey, ids[index], ids[nextIndex], isWin);
        }
      }

      for (let first = 0; first < ids.length; first += 1) {
        for (let second = first + 1; second < ids.length; second += 1) {
          for (let third = second + 1; third < ids.length; third += 1) {
            addTeammateTrio(trioStatsByKey, ids[first], ids[second], ids[third], isWin);
          }
        }
      }
    });

    (match.radiant || []).forEach((radiantId) => {
      (match.dire || []).forEach((direId) => {
        addOpponentPair(opponentStatsByKey, radiantId, direId, match.winner === "radiant");
        addOpponentPair(opponentStatsByKey, direId, radiantId, match.winner === "dire");
        addOpponentMatchup(opponentMatchupStatsByKey, radiantId, direId);
      });
    });

    Object.entries(match.playerDetails || {}).forEach(([playerId, detail]) => {
      const totals = dataTotals.get(playerId);
      const counts = dataCounts.get(playerId);
      if (!totals || !counts) return;

      Object.keys(totals).forEach((key) => {
        const value = Number(detail[key]);
        if (!Number.isFinite(value) || value < 0) return;
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
        Object.keys(totals).map((key) => {
          if (!counts[key]) return [key, null];
          const average = totals[key] / counts[key];
          const isPercent = key === "damageShare" || key === "participation";
          return [key, isPercent ? Number(average.toFixed(3)) : Math.round(average)];
        })
      )
    ];
  }));
  heroRankStats = Array.from(heroStatsByKey.values()).map((hero) => {
    const losses = hero.games - hero.wins;
    return {
      ...hero,
      losses,
      netWins: hero.wins - losses,
      winrate: hero.games ? hero.wins / hero.games : 0
    };
  });
  pairRankStats = {
    teammate: finalizePairStats(teammateStatsByKey),
    trio: finalizePairStats(trioStatsByKey),
    opponent: finalizePairStats(opponentStatsByKey),
    opponentMatchup: finalizePairStats(opponentMatchupStatsByKey)
  };
}

function sumRating(ids) {
  return ids.reduce((total, id) => total + Number(getPlayer(id)?.rating || 0), 0);
}

function renderEmpty(target) {
  target.innerHTML = $("#emptyStateTemplate").innerHTML;
}

function switchView(viewId) {
  const hasTargetView = Boolean($(`#${viewId}`));
  if (!hasTargetView) viewId = "dashboard";
  const navGroups = {
    players: ["players", "data", "heroes"],
    playerProfile: ["playerProfile", "relations", "ratingTrends", "records"]
  };
  const parentView = Object.entries(navGroups).find(([, views]) => views.includes(viewId))?.[0] || "";

  $$(".nav-tab").forEach((button) => {
    const isExact = button.dataset.view === viewId;
    const isParent = button.dataset.navDefault === parentView;
    button.classList.toggle("is-active", isExact);
    button.classList.toggle("is-section-active", isParent);
  });

  $$(".nav-sub-group").forEach((group) => {
    group.classList.toggle("is-open", group.dataset.navGroup === parentView);
  });

  $$(".view").forEach((view) => {
    view.classList.toggle("is-active", view.id === viewId);
  });

  renderCurrentView();
  sessionStorage.setItem(ACTIVE_VIEW_KEY, viewId);
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

  renderDashboardMatches();
}

function renderDashboardMatches() {
  const matches = getMatchesByScheduleDesc();
  const visibleMatches = showAllDashboardMatches ? matches : matches.slice(0, 3);
  renderMatchCards($("#recentMatches"), visibleMatches);
  const toggleButton = $("#toggleAllMatches");
  if (!toggleButton) return;
  toggleButton.textContent = showAllDashboardMatches ? "收起比赛" : "显示所有比赛";
  toggleButton.classList.toggle("is-hidden", matches.length <= 3);
}

function getPlayoffTeams() {
  return db.playoffTeams || { A: [], B: [], C: [], D: [] };
}

function clonePlayoffTeams(teams = getPlayoffTeams()) {
  return {
    A: Array.isArray(teams.A) ? [...teams.A] : [],
    B: Array.isArray(teams.B) ? [...teams.B] : [],
    C: Array.isArray(teams.C) ? [...teams.C] : [],
    D: Array.isArray(teams.D) ? [...teams.D] : []
  };
}

function renderPlayoffs() {
  const target = $("#playoffBracket");
  if (!target) return;
  const teams = getPlayoffTeams();
  target.innerHTML = `
    <section class="playoff-corner playoff-top-left">
      ${renderPlayoffTeam("A", teams.A || [])}
    </section>
    <section class="playoff-center-node playoff-top-node">
      <span>2026/05/29 20:00</span>
      <small>BO3</small>
    </section>
    <section class="playoff-corner playoff-top-right">
      ${renderPlayoffTeam("D", teams.D || [])}
    </section>
    <section class="playoff-champion" aria-label="决赛胜者">
      <div class="playoff-trophy" aria-hidden="true">🏆</div>
      <strong>总冠军</strong>
      <span>A/D 胜者 vs B/C 胜者</span>
    </section>
    <section class="playoff-corner playoff-bottom-left">
      ${renderPlayoffTeam("B", teams.B || [])}
    </section>
    <section class="playoff-center-node playoff-bottom-node">
      <span>2026/05/30 20:00</span>
      <small>BO3</small>
    </section>
    <section class="playoff-corner playoff-bottom-right">
      ${renderPlayoffTeam("C", teams.C || [])}
    </section>
  `;
}

function renderPlayoffTeam(team, ids) {
  const players = ids.map((id) => getPlayer(id)).filter(Boolean);
  return `
    <div class="playoff-team-card">
      <div class="playoff-team-title">
        <strong>TEAM ${team}</strong>
      </div>
      <div class="playoff-player-list">
        ${players.length ? players.map((player) => `<span>${escapeHtml(player.name)}</span>`).join("") : `<em>未选择出场人员</em>`}
      </div>
    </div>
  `;
}

function getMatchesByScheduleDesc(matches = db.matches) {
  return [...matches].sort(compareMatchesByScheduleDesc);
}

function compareMatchesByScheduleDesc(a, b) {
  const dateDiff = String(b.date || "").localeCompare(String(a.date || ""));
  if (dateDiff) return dateDiff;
  return Number(b.matchNo || 0) - Number(a.matchNo || 0);
}

function renderMiniRank(target, players, valueFormatter) {
  if (!target) return;
  const topFive = players.slice(0, 5);
  if (!topFive.length) {
    target.innerHTML = `<li class="muted">暂无数据</li>`;
    return;
  }

  target.innerHTML = topFive
    .map((player) => `
      <li>
        <span class="mini-rank-player">
          <b>${escapeHtml(player.name)}</b>
          <em>${formatMiniRankRecord(player)}</em>
        </span>
        <strong>${escapeHtml(valueFormatter(player))}</strong>
      </li>
    `)
    .join("");
}

function formatMiniRankRecord(player) {
  const wins = Number(player.stats?.wins || 0);
  const losses = Number(player.stats?.losses || 0);
  return `${wins}-${losses}`;
}

function renderPlayers() {
  const body = $("#playersBody");
  renderRecordHeader(body.closest("table"));

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

function renderRecordHeader(table) {
  if (!table) return;
  table.classList.add("record-table");
  const header = table.querySelector("thead tr");
  if (!header) return;
  const positionColumns = RECORD_COLUMNS.filter((column) => column.key.startsWith("position-"));
  header.innerHTML = `
    ${RECORD_COLUMNS.slice(0, 4).map((column) => `
      <th>
        <button class="table-heading sort-heading" data-record-sort="${column.key}" type="button" aria-label="${escapeHtml(column.sortLabel)}">
          <span>${escapeHtml(column.label)}</span>
          <span class="sort-arrow ${recordSort === column.key ? "is-active" : ""}">${getRecordSortIcon(column.key)}</span>
        </button>
      </th>
    `).join("")}
    <th class="record-position-heading">
      <span class="table-heading record-position-title">
        <span>位置</span>
        <span class="position-legend" aria-label="图例"><svg class="position-legend-star" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.8l2.7 5.7 6.2.8-4.6 4.3 1.2 6.1-5.5-3.1-5.5 3.1 1.2-6.1-4.6-4.3 6.2-.8L12 2.8z" /></svg>=10</span>
      </span>
      <span class="position-axis" aria-label="位置编号">
        ${positionColumns.map((column) => `
          <b>
            <button class="position-sort-button" data-record-sort="${column.key}" type="button" aria-label="${escapeHtml(column.sortLabel)}">
              <span>${escapeHtml(column.label)}</span>
              <span class="sort-arrow ${recordSort === column.key ? "is-active" : ""}">${getRecordSortIcon(column.key)}</span>
            </button>
          </b>
        `).join("")}
      </span>
    </th>
  `;
}

function getPlayerProfilePlayers() {
  return getPlayersWithStats()
    .sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0) || a.name.localeCompare(b.name, "zh-Hans"));
}

function ensureSelectedPlayerProfileId(players) {
  if (players.some((player) => player.id === selectedPlayerProfileId)) return;
  selectedPlayerProfileId = players[0]?.id || "";
  selectedPlayerProfilePosition = "";
  selectedPlayerProfileHeroKey = "";
  showAllPlayerProfileMatches = false;
}

function getFilteredPlayerProfileStats(playerId) {
  const totals = {
    kills: 0,
    deaths: 0,
    assists: 0,
    gpm: 0,
    xpm: 0,
    netWorth10: 0,
    damage: 0,
    damageShare: 0,
    buildingDamage: 0
  };
  const counts = Object.fromEntries(Object.keys(totals).map((key) => [key, 0]));
  const stats = { games: 0, wins: 0, losses: 0 };

  db.matches.forEach((match) => {
    if (getMatchQuality(match) === "draft") return;
    const side = match.radiant?.includes(playerId) ? "radiant" : match.dire?.includes(playerId) ? "dire" : "";
    if (!side) return;

    const detail = match.playerDetails?.[playerId] || {};
    const position = detail.position || match.positions?.[playerId] || "";
    if (selectedPlayerProfilePosition && position !== selectedPlayerProfilePosition) return;

    const heroIdentity = getHeroIdentity(detail.hero);
    if (selectedPlayerProfileHeroKey && heroIdentity.key !== selectedPlayerProfileHeroKey) return;

    stats.games += 1;
    if (match.winner === side) {
      stats.wins += 1;
    } else {
      stats.losses += 1;
    }

    Object.keys(totals).forEach((key) => {
      const value = Number(detail[key]);
      if (!Number.isFinite(value) || value < 0) return;
      totals[key] += value;
      counts[key] += 1;
    });
  });

  const dataStats = Object.fromEntries(
    Object.keys(totals).map((key) => {
      if (!counts[key]) return [key, null];
      const average = totals[key] / counts[key];
      const isPercent = key === "damageShare";
      return [key, isPercent ? Number(average.toFixed(3)) : Math.round(average)];
    })
  );

  return { ...stats, dataStats };
}

function getPlayerProfileMatches(playerId) {
  return getMatchesByScheduleDesc(db.matches.filter((match) => {
    if (getMatchQuality(match) === "draft") return false;
    return match.radiant?.includes(playerId) || match.dire?.includes(playerId);
  }));
}

function renderPlayerProfile() {
  const list = $("#playerProfileList");
  const detail = $("#playerProfileDetail");
  if (!list || !detail) return;

  const players = getPlayerProfilePlayers();
  ensureSelectedPlayerProfileId(players);

  if (!players.length) {
    list.innerHTML = `<p class="muted">暂无选手</p>`;
    detail.innerHTML = `<p class="muted">暂无选手</p>`;
    return;
  }

  list.innerHTML = players.map((player) => {
    const isActive = player.id === selectedPlayerProfileId;
    return `
      <button class="player-profile-tab ${isActive ? "is-active" : ""}" data-player-profile-id="${escapeHtml(player.id)}" type="button">
        <strong>${escapeHtml(player.name)}</strong>
      </button>
    `;
  }).join("");

  const player = players.find((item) => item.id === selectedPlayerProfileId) || players[0];
  const stats = player.stats || createEmptyPlayerStats();
  const filteredStats = getFilteredPlayerProfileStats(player.id);
  const dataStats = filteredStats.dataStats;
  const playerMatches = getPlayerProfileMatches(player.id);
  const visibleMatches = showAllPlayerProfileMatches ? playerMatches : playerMatches.slice(0, 4);
  const activeHero = Array.from(heroUsageByPlayerId.get(player.id)?.values() || [])
    .find((hero) => hero.key === selectedPlayerProfileHeroKey);
  const dataScope = selectedPlayerProfilePosition
    ? getPlayerProfilePositionLabel(selectedPlayerProfilePosition)
    : selectedPlayerProfileHeroKey ? (activeHero?.name || "所选英雄") : "总体";
  const metrics = [
    { label: "总场次", value: filteredStats.games },
    { label: "胜", value: filteredStats.wins },
    { label: "负", value: filteredStats.losses },
    { key: "kills", label: "击杀" },
    { key: "deaths", label: "死亡" },
    { key: "assists", label: "助攻" },
    { key: "gpm", label: "GPM" },
    { key: "xpm", label: "XPM" },
    { key: "netWorth10", label: "10分钟经济" },
    { key: "damage", label: "伤害量" },
    { key: "damageShare", label: "伤害占比", type: "percent" },
    { key: "buildingDamage", label: "建筑伤害" }
  ];

  detail.innerHTML = `
    <div class="player-profile-title">
      <div>
        <h3>${escapeHtml(player.name)}</h3>
        <p>${stats.games ? `${stats.wins}胜 ${stats.losses}负 · ${stats.games}场` : "暂无比赛记录"}</p>
      </div>
      <span>评分 ${formatRating(player.rating)}</span>
    </div>

    <section class="player-profile-section">
      ${renderPlayerProfilePositions(stats.positionStats)}
    </section>

    <section class="player-profile-section">
      ${renderPlayerProfileHeroes(player.id)}
    </section>

    <section class="player-profile-section">
      <div class="player-profile-section-header">
        <h4>场均数据</h4>
        <small>${escapeHtml(dataScope)}</small>
      </div>
      <div class="player-profile-stats">
        ${metrics.map((metric) => `
          <div class="player-profile-stat">
            <span>${metric.label}</span>
            <strong>${metric.key ? formatAverage(dataStats[metric.key], metric.type) : metric.value}</strong>
          </div>
        `).join("")}
      </div>
    </section>

    <section class="player-profile-section">
      <div class="player-profile-section-header">
        <h4>比赛</h4>
        <button class="secondary-button compact-button ${playerMatches.length <= 4 ? "is-hidden" : ""}" id="togglePlayerProfileMatches" type="button">
          ${showAllPlayerProfileMatches ? "收起比赛" : "显示全部"}
        </button>
      </div>
      <div id="playerProfileMatches" class="match-list"></div>
    </section>
  `;

  renderMatchCards($("#playerProfileMatches"), visibleMatches);
}

function renderPlayerProfilePositions(positionStats = createEmptyPositionStats()) {
  return `
    <div class="player-profile-positions">
      ${POSITIONS.map((position) => {
        const record = positionStats.records?.[position] || { wins: 0, losses: 0 };
        return `
          <button class="player-profile-position ${selectedPlayerProfilePosition === position ? "is-active" : ""}" data-player-profile-position="${position}" type="button">
            <strong>${getPlayerProfilePositionLabel(position)}</strong>
            <small>${record.wins}-${record.losses}</small>
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function getPlayerProfilePositionLabel(position) {
  return {
    1: "一号位",
    2: "二号位",
    3: "三号位",
    4: "四号位",
    5: "五号位"
  }[position] || `${position}号位`;
}

function renderPlayerProfileHeroes(playerId) {
  const heroes = Array.from(heroUsageByPlayerId.get(playerId)?.values() || [])
    .sort((a, b) => b.count - a.count || b.wins - a.wins || a.name.localeCompare(b.name, "zh-Hans"));

  if (!heroes.length) return `<p class="muted">暂无英雄记录</p>`;

  return `
    <div class="player-profile-heroes">
      ${heroes.map((hero) => `
        <button class="player-profile-hero ${selectedPlayerProfileHeroKey === hero.key ? "is-active" : ""}" data-player-profile-hero="${escapeHtml(hero.key)}" title="${escapeHtml(`${hero.name} ${hero.count}场`)}" type="button">
          ${renderHeroUsageAvatar(hero.name)}
          <b>${hero.count}</b>
        </button>
      `).join("")}
    </div>
  `;
}

function getRecordSortIcon(key) {
  if (recordSort !== key) return "";
  return recordSortDirection === "desc" ? "▾" : "▴";
}

function renderDataView() {
  const viewId = getActiveDataViewId();
  const columns = activeDataViewMode === "advanced" ? ADVANCED_DATA_COLUMNS : BASIC_DATA_COLUMNS;
  renderDataTable(viewId, columns, $("#dataViewBody"));
  updateDataViewSwitch();
}

function getActiveDataViewId() {
  return activeDataViewMode === "advanced" ? "advancedData" : "basicData";
}

function updateDataViewSwitch() {
  $$("[data-data-view-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.dataViewMode === activeDataViewMode);
  });
}

function renderHeroes() {
  renderHeroRankings();
  renderPlayerHeroUsage();
}

function renderPlayerHeroUsage() {
  const target = $("#playerHeroUsageList");
  if (!target) return;

  const players = getPlayersWithHeroUsage()
    .sort((a, b) => {
      if (heroUsageSort === "unique") {
        return b.uniqueHeroCount - a.uniqueHeroCount || b.total - a.total || a.name.localeCompare(b.name, "zh-Hans");
      }
      return b.total - a.total || b.uniqueHeroCount - a.uniqueHeroCount || a.name.localeCompare(b.name, "zh-Hans");
    });

  const rows = players.filter((player) => player.total > 0);
  if (!rows.length) {
    target.innerHTML = `<p class="muted">暂无英雄记录</p>`;
    return;
  }

  target.innerHTML = rows
    .map((player) => `
      <article class="hero-usage-row">
        <strong>
          <em>${escapeHtml(player.name)}</em>
          <span class="hero-usage-count-pair">
            <b class="${heroUsageSort === "unique" ? "is-active" : ""}">${player.uniqueHeroCount}</b>
            <i>|</i>
            <b class="${heroUsageSort === "total" ? "is-active" : ""}">${player.total}</b>
          </span>
        </strong>
        <div class="hero-usage-avatars" aria-label="${escapeHtml(player.name)} 英雄使用记录">
          ${renderHeroUsageAvatars(player.heroes)}
        </div>
      </article>
    `)
    .join("");

  updateHeroUsageSortControl();
}

function renderHeroUsageAvatars(heroes) {
  return heroes
    .map((hero) => Array.from({ length: hero.count }, () => renderHeroUsageAvatar(hero.name)).join(""))
    .join("");
}

function updateHeroUsageSortControl() {
  $$("[data-hero-usage-sort]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.heroUsageSort === heroUsageSort);
  });
}

function renderHeroUsageAvatar(heroName) {
  const avatar = renderHeroAvatar(heroName);
  if (avatar) return avatar;
  return `<span class="hero-avatar hero-avatar-fallback">${escapeHtml(String(heroName || "-").slice(0, 1))}</span>`;
}

function getPlayersWithHeroUsage() {
  return db.players
    .map((player) => {
      const heroes = Array.from(heroUsageByPlayerId.get(player.id)?.values() || [])
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-Hans"));
      const total = heroes.reduce((sum, hero) => sum + hero.count, 0);
      return { ...player, heroes, uniqueHeroCount: heroes.length, total };
    })
    .sort((a, b) => b.uniqueHeroCount - a.uniqueHeroCount || b.total - a.total || a.name.localeCompare(b.name, "zh-Hans"));
}

function renderHeroRankings() {
  const target = $("#heroRankGrid");
  if (!target) return;
  const rankedHeroes = heroRankStats.filter((hero) => hero.games > 0);
  const boards = [
    {
      key: "positive",
      title: "版本答案",
      heroes: sortHeroes(rankedHeroes, heroRankModes.positive, "desc"),
      modes: ["winrate", "netWins"]
    },
    {
      key: "negative",
      title: "版本垃圾",
      heroes: sortHeroes(rankedHeroes, heroRankModes.negative, "asc"),
      modes: ["winrate", "netWins"]
    },
    {
      key: "singleHeat",
      title: "绝活榜",
      heroes: sortSingleHeroHeatStats(getSingleHeroHeatStats(), heroRankModes.singleHeat),
      modes: ["total", "perfect", "wins"],
      note: heroRankModes.singleHeat === "perfect" ? "胜率统计仅展示使用场数 ≥ 3 场的记录" : "",
      record: (hero) => `${hero.wins}-${hero.count - hero.wins}`,
      value: (hero) => formatSingleHeroHeatValue(hero, heroRankModes.singleHeat)
    },
    {
      key: "reverseSingleHeat",
      title: "反向绝活榜",
      heroes: sortReverseSingleHeroHeatStats(getSingleHeroHeatStats(), heroRankModes.reverseSingleHeat),
      modes: ["perfectLoss", "netLoss"],
      note: heroRankModes.reverseSingleHeat === "perfectLoss" ? "胜率统计仅展示使用场数 ≥ 3 场的记录" : "",
      record: (hero) => `${hero.wins}-${hero.count - hero.wins}`,
      value: (hero) => formatReverseSingleHeroHeatValue(hero, heroRankModes.reverseSingleHeat)
    }
  ];

  target.innerHTML = [
    ...boards.map(renderHeroRankCard),
    renderHeroAppearanceBoard(rankedHeroes)
  ].join("");
}

function renderHeroAppearanceBoard(heroes) {
  const groups = getHeroAppearanceGroups(heroes);
  const unplayedHeroes = getUnplayedHeroes(heroes);
  return `
    <section class="panel hero-appearance-card">
      <div class="panel-header">
        <h3>英雄出场场次</h3>
      </div>
      ${groups.length ? `
        <div class="hero-appearance-table" role="table" aria-label="英雄出场场次">
          ${groups.map((group) => `
            <div class="hero-appearance-row" role="row">
              <div class="hero-appearance-count" role="cell">
                <strong>${group.games}</strong>
                <span>场</span>
              </div>
              <div class="hero-appearance-heroes" role="cell">
                ${group.heroes.map((hero) => renderHeroAppearanceAvatar(hero)).join("")}
              </div>
            </div>
          `).join("")}
        </div>
      ` : `<p class="muted">暂无数据</p>`}
      <div class="hero-unplayed">
        <div class="hero-unplayed-header">
          <h4>未出场英雄</h4>
          <span>${unplayedHeroes.length} 位</span>
        </div>
        ${unplayedHeroes.length ? `
          <div class="hero-unplayed-list" aria-label="未出场英雄">
            ${unplayedHeroes.map((hero) => renderHeroAppearanceAvatar({ ...hero, name: hero.cn, wins: 0, losses: 0 })).join("")}
          </div>
        ` : `<p class="muted">所有英雄均有出场记录</p>`}
      </div>
    </section>
  `;
}

function renderHeroAppearanceAvatar(hero) {
  const title = `${hero.name} ${hero.wins}-${hero.losses}`;
  const matchedHero = findHero(hero.name);
  if (matchedHero) {
    return `<img class="hero-avatar" src="${heroImageUrl(matchedHero)}" alt="" title="${escapeHtml(title)}" loading="lazy" />`;
  }
  return `<span class="hero-avatar hero-avatar-fallback" title="${escapeHtml(title)}">${escapeHtml(String(hero.name || "-").slice(0, 1))}</span>`;
}

function getUnplayedHeroes(playedHeroes) {
  const playedSlugs = new Set(playedHeroes.map((hero) => hero.key).filter(Boolean));
  return HEROES
    .filter((hero) => !playedSlugs.has(hero.slug))
    .sort((a, b) => a.cn.localeCompare(b.cn, "zh-Hans"));
}

function getHeroAppearanceGroups(heroes) {
  const sortedHeroes = [...heroes]
    .filter((hero) => hero.games > 0)
    .sort((a, b) => b.games - a.games || b.wins - a.wins || a.name.localeCompare(b.name, "zh-Hans"));
  const groups = [];
  sortedHeroes.forEach((hero) => {
    let group = groups[groups.length - 1];
    if (!group || group.games !== hero.games) {
      group = { games: hero.games, heroes: [] };
      groups.push(group);
    }
    group.heroes.push(hero);
  });
  return groups;
}

function getSingleHeroHeatStats() {
  return getPlayersWithHeroUsage()
    .flatMap((player) => player.heroes.map((hero) => ({
      ...hero,
      playerName: player.name,
      count: hero.count
    })));
}

function sortSingleHeroHeatStats(heroes, mode = "total") {
  const ranked = mode === "perfect"
    ? heroes.filter((hero) => hero.count >= 3)
    : heroes;
  return [...ranked].sort((a, b) => {
    if (mode === "wins") {
      return b.wins - a.wins || b.count - a.count || a.playerName.localeCompare(b.playerName, "zh-Hans") || a.name.localeCompare(b.name, "zh-Hans");
    }
    if (mode === "perfect") {
      return (b.wins / b.count) - (a.wins / a.count)
        || b.count - a.count
        || b.wins - a.wins
        || a.playerName.localeCompare(b.playerName, "zh-Hans")
        || a.name.localeCompare(b.name, "zh-Hans");
    }
    return b.count - a.count || b.wins - a.wins || a.playerName.localeCompare(b.playerName, "zh-Hans") || a.name.localeCompare(b.name, "zh-Hans");
  });
}

function formatSingleHeroHeatValue(hero, mode = "total") {
  const suffix = mode === "perfect"
    ? `${Math.round((hero.wins / hero.count) * 100)}%`
    : mode === "wins" ? `${hero.wins}胜` : `${hero.count}场`;
  return `（${hero.playerName}）${suffix}`;
}

function sortReverseSingleHeroHeatStats(heroes, mode = "losses") {
  const ranked = mode === "perfectLoss"
    ? heroes.filter((hero) => hero.count >= 3)
    : heroes;
  return [...ranked].sort((a, b) => {
    const aLosses = a.count - a.wins;
    const bLosses = b.count - b.wins;
    if (mode === "perfectLoss") {
      return (a.wins / a.count) - (b.wins / b.count)
        || b.count - a.count
        || bLosses - aLosses
        || a.playerName.localeCompare(b.playerName, "zh-Hans")
        || a.name.localeCompare(b.name, "zh-Hans");
    }
    if (mode === "netLoss") {
      return (bLosses - b.wins) - (aLosses - a.wins)
        || bLosses - aLosses
        || b.count - a.count
        || a.playerName.localeCompare(b.playerName, "zh-Hans")
        || a.name.localeCompare(b.name, "zh-Hans");
    }
    return bLosses - aLosses
      || b.count - a.count
      || a.wins - b.wins
      || a.playerName.localeCompare(b.playerName, "zh-Hans")
      || a.name.localeCompare(b.name, "zh-Hans");
  });
}

function formatReverseSingleHeroHeatValue(hero, mode = "losses") {
  const losses = hero.count - hero.wins;
  const netLoss = losses - hero.wins;
  const suffix = mode === "netLoss"
    ? (netLoss > 0 ? `-${netLoss}` : netLoss < 0 ? `+${Math.abs(netLoss)}` : "0")
    : mode === "perfectLoss" ? `${Math.round((hero.wins / hero.count) * 100)}%`
    : `${losses}负`;
  return `（${hero.playerName}）${suffix}`;
}

function sortHeroes(heroes, mode, direction) {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...heroes].sort((a, b) => {
    const valueDiff = multiplier * (getHeroModeValue(a, mode) - getHeroModeValue(b, mode));
    if (valueDiff) return valueDiff;
    return b.games - a.games || b.netWins - a.netWins || a.name.localeCompare(b.name, "zh-Hans");
  });
}

function renderHeroRankCard(board) {
  const heroes = board.heroes.slice(0, 5);
  const mode = heroRankModes[board.key] || "games";
  return `
    <section class="panel hero-rank-card">
      <div class="panel-header">
        <div class="hero-rank-heading">
          <h3>${escapeHtml(board.title)}</h3>
          ${board.note ? `<small>${escapeHtml(board.note)}</small>` : ""}
        </div>
        ${board.modes ? `
          <div class="rank-mode-control" aria-label="${escapeHtml(board.title)}排序方式">
            ${board.modes.map((item) => `
              <button class="${mode === item ? "is-active" : ""}" data-hero-rank="${board.key}" data-hero-mode="${item}" type="button">${getHeroModeLabel(item, board.key)}</button>
            `).join("")}
          </div>
        ` : ""}
      </div>
      ${heroes.length ? `
        <ol class="hero-rank-list">
          ${heroes.map((hero) => `
            <li>
              <span class="hero-rank-main">
                ${renderHeroUsageAvatar(hero.name)}
                <span>
                  <em>${board.record ? board.record(hero) : `${hero.wins}-${hero.losses}`}</em>
                </span>
              </span>
              <b>${escapeHtml(board.value ? board.value(hero) : formatHeroModeValue(hero, mode))}</b>
            </li>
          `).join("")}
        </ol>
      ` : `<p class="muted">暂无数据</p>`}
    </section>
  `;
}

function getHeroModeValue(hero, mode) {
  if (mode === "netWins") return hero.netWins;
  return hero.winrate;
}

function formatHeroModeValue(hero, mode) {
  if (mode === "netWins") return `${hero.netWins > 0 ? "+" : ""}${hero.netWins}`;
  return `${Math.round(hero.winrate * 100)}%`;
}

function getHeroModeLabel(mode, boardKey = "") {
  return {
    winrate: "胜率",
    netWins: boardKey === "negative" ? "净负" : "净胜",
    total: "总数",
    wins: "胜场",
    perfect: "胜率",
    losses: "负场",
    netLoss: "净负",
    perfectLoss: "胜率"
  }[mode] || mode;
}

function renderRelations() {
  renderTeammateQuery();
  renderOpponentQuery();
  const target = $("#pairRankGrid");
  if (!target) return;
  const teammatePairs = pairRankStats.teammate.filter((pair) => pair.games > 0);
  const teammateTrios = pairRankStats.trio.filter((trio) => trio.games > 0);
  const opponentPairs = pairRankStats.opponent.filter((pair) => pair.games > 0);
  const opponentMatchups = (pairRankStats.opponentMatchup || []).filter((pair) => pair.games > 0);
  const stompMode = pairRankModes.stomp || "winrate";
  const stompPairs = stompMode === "games" ? opponentMatchups : opponentPairs;
  const boards = [
    {
      key: "bestFriends",
      title: "最佳挚友",
      pairs: sortPairs(teammatePairs, pairRankModes.bestFriends, getPairRankDirection("bestFriends", pairRankModes.bestFriends)),
      type: "teammate",
      modes: ["winrate", "netWins"]
    },
    {
      key: "bigThree",
      title: "三巨头",
      pairs: sortPairs(teammateTrios, pairRankModes.bigThree, getPairRankDirection("bigThree", pairRankModes.bigThree)),
      type: "teammate",
      modes: ["winrate", "netWins"]
    },
    {
      key: "poorFriends",
      title: "卧龙凤雏",
      pairs: sortPairs(teammatePairs, pairRankModes.poorFriends, getPairRankDirection("poorFriends", pairRankModes.poorFriends)),
      type: "teammate",
      modes: ["winrate", "netWins"]
    },
    {
      key: "stomp",
      title: "爆杀榜",
      pairs: sortPairs(stompPairs, stompMode, getPairRankDirection("stomp", stompMode)),
      type: "opponent",
      modes: ["games", "winrate", "netWins"],
      hideRecord: true,
      value: (pair, mode) => mode === "winrate" ? `${pair.wins}-${pair.losses}` : formatPairModeValue(pair, mode)
    }
  ];

  target.innerHTML = boards.map(renderPairRankCard).join("");
}

function renderTeammateQuery() {
  const controls = $("#teammateQueryControls");
  const result = $("#teammateQueryResult");
  if (!controls || !result) return;

  const previousValues = $$("[data-teammate-query-index]")
    .sort((a, b) => Number(a.dataset.teammateQueryIndex) - Number(b.dataset.teammateQueryIndex))
    .map((select) => select.value);
  const selectedIds = [];
  const fields = [];

  for (let index = 0; index < 5; index += 1) {
    const options = index === 0
      ? db.players
        .map((player) => ({ id: player.id, label: player.name }))
        .sort((a, b) => a.label.localeCompare(b.label, "zh-Hans"))
      : getTeammateCandidates(selectedIds);
    const selectedValue = options.some((item) => item.id === previousValues[index]) ? previousValues[index] : "";

    if (index > 0 && !selectedIds.length) break;
    if (index > 0 && !options.length) break;

    fields.push(renderTeammateQueryField(index, options, selectedValue));
    if (!selectedValue) break;
    selectedIds.push(selectedValue);
  }

  controls.innerHTML = fields.join("");
  result.innerHTML = renderTeammateQueryResult(selectedIds);
}

function renderSelectOptions(options, placeholder) {
  return [
    `<option value="">${escapeHtml(placeholder)}</option>`,
    ...options.map((item) => `<option value="${item.id}">${escapeHtml(item.label)}</option>`)
  ].join("");
}

function renderTeammateQueryField(index, options, selectedValue) {
  const label = String.fromCharCode(65 + index);
  return `
    <label>
      选手 ${label}
      <select data-teammate-query-index="${index}">
        ${renderSelectOptions(options, `选择选手 ${label}`)}
      </select>
    </label>
  `.replace(`value="${selectedValue}"`, `value="${selectedValue}" selected`);
}

function getTeammateCandidates(requiredIds) {
  const candidates = new Set();
  db.matches.forEach((match) => {
    if (getMatchQuality(match) === "draft") return;
    const side = getMatchSideWithPlayers(match, requiredIds);
    if (!side) return;
    getMatchTeamIds(match, side).forEach((playerId) => {
      if (!requiredIds.includes(playerId)) candidates.add(playerId);
    });
  });

  return [...candidates]
    .map((id) => getPlayer(id))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans"))
    .map((player) => ({ id: player.id, label: player.name }));
}

function renderTeammateQueryResult(selectedIds) {
  if (selectedIds.length < 2) {
    return `<p class="muted">请选择 A 和 B，后续选手可选。</p>`;
  }

  const record = getTeammateGroupRecord(selectedIds);
  const names = selectedIds.map((id) => getPlayer(id)?.name || "-").join(" + ");
  if (!record.games) {
    return `<p class="muted">${escapeHtml(names)} 暂无同队比赛。</p>`;
  }

  return `
    <div class="teammate-query-summary">
      <strong>${escapeHtml(names)}</strong>
      <span>${record.wins}-${record.losses}</span>
      <span>胜率 ${Math.round(record.winrate * 100)}%</span>
      <span>共 ${record.games} 场</span>
    </div>
    <ol class="teammate-query-matches">
      ${record.matches.slice(0, 8).map((item) => `
        <li>
          <span>${escapeHtml(formatAdminMatchCode(item.match))}</span>
          <span>${item.side === "radiant" ? "天辉" : "夜魇"}</span>
          <span>${escapeHtml(item.match.score || "-")}</span>
          <b class="${item.isWin ? "is-win" : "is-loss"}">${item.isWin ? "胜" : "负"}</b>
        </li>
      `).join("")}
    </ol>
  `;
}

function getTeammateGroupRecord(playerIds) {
  const matches = [];
  let wins = 0;
  db.matches.forEach((match) => {
    if (getMatchQuality(match) === "draft") return;
    const side = getMatchSideWithPlayers(match, playerIds);
    if (!side) return;
    const isWin = match.winner === side;
    wins += isWin ? 1 : 0;
    matches.push({ match, side, isWin });
  });

  const losses = matches.length - wins;
  return {
    games: matches.length,
    wins,
    losses,
    winrate: matches.length ? wins / matches.length : 0,
    matches
  };
}

function getMatchSideWithPlayers(match, playerIds) {
  if (!playerIds.length) return "";
  const radiant = new Set(match.radiant || []);
  const dire = new Set(match.dire || []);
  if (playerIds.every((id) => radiant.has(id))) return "radiant";
  if (playerIds.every((id) => dire.has(id))) return "dire";
  return "";
}

function getMatchTeamIds(match, side) {
  return side === "radiant" ? (match.radiant || []) : (match.dire || []);
}

function renderOpponentQuery() {
  const selectA = $("#opponentQueryA");
  const selectB = $("#opponentQueryB");
  const result = $("#opponentQueryResult");
  if (!selectA || !selectB || !result) return;

  const oldA = selectA.value;
  const oldB = selectB.value;
  const playerOptions = db.players
    .map((player) => ({ id: player.id, label: player.name }))
    .sort((a, b) => a.label.localeCompare(b.label, "zh-Hans"));
  const playerIds = new Set(playerOptions.map((player) => player.id));
  const selectedA = playerIds.has(oldA) ? oldA : "";
  const bOptions = playerOptions.filter((player) => player.id !== selectedA);
  const selectedB = bOptions.some((player) => player.id === oldB) ? oldB : "";

  selectA.innerHTML = renderSelectOptions(playerOptions, "选择选手 A");
  selectA.value = selectedA;
  selectB.innerHTML = renderSelectOptions(bOptions, "选择选手 B");
  selectB.value = selectedB;
  result.innerHTML = renderOpponentQueryResult(selectedA, selectedB);
}

function renderOpponentQueryResult(playerId, opponentId) {
  if (!playerId || !opponentId) {
    return `<p class="muted">请选择两名对手。</p>`;
  }

  const record = getOpponentRecord(playerId, opponentId);
  const names = `${getPlayer(playerId)?.name || "-"} vs ${getPlayer(opponentId)?.name || "-"}`;
  if (!record.games) {
    return `<p class="muted">${escapeHtml(names)} 暂无交手记录。</p>`;
  }

  return `
    <div class="teammate-query-summary">
      <strong>${escapeHtml(names)}</strong>
      <span>${record.wins}-${record.losses}</span>
      <span>胜率 ${Math.round(record.winrate * 100)}%</span>
      <span>共 ${record.games} 场</span>
    </div>
    <ol class="teammate-query-matches">
      ${record.matches.slice(0, 8).map((item) => `
        <li>
          <span>${escapeHtml(formatAdminMatchCode(item.match))}</span>
          <span>${item.side === "radiant" ? "天辉" : "夜魇"}</span>
          <span>${escapeHtml(item.match.score || "-")}</span>
          <b class="${item.isWin ? "is-win" : "is-loss"}">${item.isWin ? "胜" : "负"}</b>
        </li>
      `).join("")}
    </ol>
  `;
}

function getOpponentRecord(playerId, opponentId) {
  const matches = [];
  let wins = 0;
  db.matches.forEach((match) => {
    if (getMatchQuality(match) === "draft") return;
    const playerSide = getMatchSideWithPlayers(match, [playerId]);
    const opponentSide = getMatchSideWithPlayers(match, [opponentId]);
    if (!playerSide || !opponentSide || playerSide === opponentSide) return;
    const isWin = match.winner === playerSide;
    wins += isWin ? 1 : 0;
    matches.push({ match, side: playerSide, isWin });
  });

  const losses = matches.length - wins;
  return {
    games: matches.length,
    wins,
    losses,
    winrate: matches.length ? wins / matches.length : 0,
    matches
  };
}

function getPairRankDirection(key, mode) {
  if (key === "poorFriends" && mode !== "games") return "asc";
  return "desc";
}

function sortPairs(pairs, mode, direction) {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...pairs].sort((a, b) => {
    const valueDiff = multiplier * (getPairModeValue(a, mode) - getPairModeValue(b, mode));
    if (valueDiff) return valueDiff;
    return b.games - a.games || b.netWins - a.netWins || formatPairNames(a).localeCompare(formatPairNames(b), "zh-Hans");
  });
}

function renderPairRankCard(board) {
  const pairs = board.pairs.slice(0, 5);
  const mode = pairRankModes[board.key] || "winrate";
  return `
    <section class="panel pair-rank-card">
      <div class="panel-header">
        <h3>${escapeHtml(board.title)}</h3>
        <div class="rank-mode-control" aria-label="${escapeHtml(board.title)}排序方式">
          ${board.modes.map((item) => `
            <button class="${mode === item ? "is-active" : ""}" data-pair-rank="${board.key}" data-pair-mode="${item}" type="button">${getPairModeLabel(item)}</button>
          `).join("")}
        </div>
      </div>
      ${pairs.length ? `
        <ol class="pair-rank-list">
          ${pairs.map((pair) => `
            <li>
              <span class="pair-rank-main">
                <strong>${renderPairNames(pair, board.type, mode)}</strong>
                <em>${board.hideRecord ? "&nbsp;" : `${pair.wins}-${pair.losses}`}</em>
              </span>
              <b>${escapeHtml(board.value ? board.value(pair, mode) : formatPairModeValue(pair, mode))}</b>
            </li>
          `).join("")}
        </ol>
      ` : `<p class="muted">暂无数据</p>`}
    </section>
  `;
}

function getPairModeValue(pair, mode) {
  if (mode === "games") return pair.games;
  if (mode === "netWins") return pair.netWins;
  return pair.winrate;
}

function formatPairModeValue(pair, mode) {
  if (mode === "games") return `${pair.games}场`;
  if (mode === "netWins") return `${pair.netWins > 0 ? "+" : ""}${pair.netWins}`;
  return `${Math.round(pair.winrate * 100)}%`;
}

function getPairModeLabel(mode) {
  return {
    games: "场次",
    winrate: "胜率",
    netWins: "净胜"
  }[mode] || mode;
}

function formatPairNames(pair, type = "teammate") {
  if (type === "opponent") {
    return `${getPlayer(pair.playerId)?.name || "-"} vs ${getPlayer(pair.opponentId)?.name || "-"}`;
  }
  return (pair.players || []).map((id) => getPlayer(id)?.name || "-").join(" + ");
}

function renderPairNames(pair, type = "teammate", mode = "") {
  if (type === "opponent") {
    const separator = mode === "games"
      ? `<span class="pair-vs-text">VS</span>`
      : `<span class="pair-vs-icon" aria-label="对阵" title="对阵"></span>`;
    return `${escapeHtml(getPlayer(pair.playerId)?.name || "-")} ${separator} ${escapeHtml(getPlayer(pair.opponentId)?.name || "-")}`;
  }
  return escapeHtml(formatPairNames(pair, type));
}

function renderRatingTrends() {
  const snapshots = Array.isArray(db.ratingSnapshots) ? db.ratingSnapshots : [];
  const playerList = $("#ratingTrendPlayerList");
  const chart = $("#ratingTrendChart");
  if (!playerList || !chart) return;

  const latestRatings = new Map();
  const playersWithHistory = db.players
    .filter((player) => snapshots.some((item) => item.playerId === player.id))
    .map((player) => {
      const latestRating = getLatestRating(player.id, snapshots);
      latestRatings.set(player.id, latestRating);
      return player;
    })
    .sort((a, b) => latestRatings.get(b.id) - latestRatings.get(a.id) || a.name.localeCompare(b.name, "zh-Hans"));

  if (!snapshots.length || !playersWithHistory.length) {
    playerList.innerHTML = "";
    chart.innerHTML = `<div class="empty-state">暂无评分走势数据</div>`;
    return;
  }

  if (!ratingTrendSelectedIds.length && !ratingTrendHasUserSelection) {
    ratingTrendSelectedIds = playersWithHistory.map((player) => player.id);
  }
  const validIds = new Set(playersWithHistory.map((player) => player.id));
  const selectedSet = new Set(ratingTrendSelectedIds.filter((id) => validIds.has(id)));
  ratingTrendSelectedIds = playersWithHistory.map((player) => player.id).filter((id) => selectedSet.has(id));

  const controls = `
    <div class="rating-trend-player-actions">
      <button class="ghost-button compact-button" data-rating-trend-action="select-all" type="button">全选</button>
      <button class="ghost-button compact-button" data-rating-trend-action="clear" type="button">清空</button>
    </div>
  `;
  const playerItems = playersWithHistory.map((player) => {
    const isSelected = ratingTrendSelectedIds.includes(player.id);
    const color = getRatingTrendPlayerColor(player.id);
    return `
    <label class="rating-trend-player ${isSelected ? "is-selected" : ""}">
      <input data-rating-trend-player="${player.id}" type="checkbox" ${isSelected ? "checked" : ""} />
      <i class="rating-trend-player-dot" style="background:${color}"></i>
      <span>${escapeHtml(player.name)}</span>
      <em>${formatRating(latestRatings.get(player.id))}</em>
    </label>
  `;
  }).join("");
  playerList.innerHTML = controls + playerItems;

  chart.innerHTML = renderRatingTrendChart(snapshots, ratingTrendSelectedIds);
}

function renderRatingTrendChart(snapshots, selectedIds) {
  const dates = getRatingTrendDates(snapshots);
  if (!dates.length) return `<div class="empty-state">暂无评分走势数据</div>`;

  const series = selectedIds.length
    ? selectedIds
      .map((playerId) => buildRatingTrendSeries(playerId, dates, snapshots))
      .filter((item) => item.points.some((point) => point.rating !== null))
    : [];
  if (selectedIds.length && !series.length) return `<div class="empty-state">所选选手暂无评分记录</div>`;

  const ratings = series.length
    ? series.flatMap((item) => item.points.map((point) => point.rating).filter((value) => value !== null))
    : snapshots.map((snapshot) => Number(snapshot.rating)).filter(Number.isFinite);
  if (!ratings.length) return `<div class="empty-state">暂无评分走势数据</div>`;
  const minRating = Math.max(0, Math.floor(Math.min(...ratings) * 2) / 2 - 0.5);
  const maxRating = Math.ceil(Math.max(...ratings) * 2) / 2 + 0.5;
  const height = 620;
  const margin = { top: 28, right: 112, bottom: 48, left: 58 };
  const pointGap = 54;
  const width = Math.max(760, margin.left + margin.right + Math.max(1, dates.length - 1) * pointGap);
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const xFor = (index) => margin.left + (dates.length === 1 ? plotWidth / 2 : (index / (dates.length - 1)) * plotWidth);
  const yFor = (rating) => margin.top + (1 - ((rating - minRating) / (maxRating - minRating || 1))) * plotHeight;
  const yTicks = Array.from({ length: Math.round((maxRating - minRating) / 0.5) + 1 }, (_, index) => Number((minRating + index * 0.5).toFixed(1)));
  const dateStep = 1;

  const grid = yTicks.map((tick) => {
    const y = yFor(tick);
    return `<g><line class="rating-trend-grid-line" x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" /><text class="rating-trend-axis" x="${margin.left - 12}" y="${y + 4}" text-anchor="end">${formatRating(tick)}</text></g>`;
  }).join("");
  const xLabels = dates.map((date, index) => {
    if (index % dateStep !== 0 && index !== dates.length - 1) return "";
    const x = xFor(index);
    return `<text class="rating-trend-axis" x="${x}" y="${height - margin.bottom + 18}" text-anchor="middle">${formatRatingTrendDateLabel(date, snapshots)}</text>`;
  }).join("");
  const paths = series.map((item) => {
    const path = item.points.reduce((commands, point, index) => {
      if (point.rating === null) return commands;
      const command = commands ? "L" : "M";
      return `${commands} ${command}${xFor(index).toFixed(1)} ${yFor(point.rating).toFixed(1)}`;
    }, "");
    const lastPointIndex = item.points.findLastIndex((point) => point.rating !== null);
    const lastPoint = item.points[lastPointIndex];
    const label = lastPoint
      ? `<text class="rating-trend-series-label" x="${xFor(lastPointIndex) + 10}" y="${yFor(lastPoint.rating) + 4}" fill="${item.color}">${escapeHtml(item.name)}</text>`
      : "";
    const markers = item.points.map((point, index) => point.rating === null ? "" : `<circle class="rating-trend-dot" cx="${xFor(index).toFixed(1)}" cy="${yFor(point.rating).toFixed(1)}" r="3" fill="${item.color}"><title>${escapeHtml(item.name)} ${point.date}: ${formatRating(point.rating)}</title></circle>`).join("");
    return `
      <g class="rating-trend-series">
        <path class="rating-trend-hit-line" d="${path.trim()}" />
        <path class="rating-trend-line" d="${path.trim()}" stroke="${item.color}" />
        ${markers}
        ${label}
      </g>
    `;
  }).join("");
  const emptySelectionLabel = selectedIds.length ? "" : `<text class="rating-trend-empty-label" x="${margin.left + plotWidth / 2}" y="${margin.top + plotHeight / 2}" text-anchor="middle">未选择选手</text>`;
  return `
    <svg class="rating-trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="选手评分走势折线图">
      <rect class="rating-trend-plot-bg" x="${margin.left}" y="${margin.top}" width="${plotWidth}" height="${plotHeight}" />
      ${grid}
      <line class="rating-trend-axis-line" x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" />
      <line class="rating-trend-axis-line" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" />
      ${xLabels}
      ${emptySelectionLabel}
      ${paths}
    </svg>
  `;
}

function getRatingTrendDates(snapshots) {
  return [...new Set(snapshots.map((snapshot) => snapshot.date).filter(Boolean))].sort();
}

function buildRatingTrendSeries(playerId, dates, snapshots) {
  const player = getPlayer(playerId);
  const playerSnapshots = snapshots
    .filter((snapshot) => snapshot.playerId === playerId)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const byDate = new Map(
    playerSnapshots.map((snapshot) => [snapshot.date, Number(snapshot.rating)])
  );
  let carried = playerSnapshots
    .filter((snapshot) => snapshot.date < dates[0] && Number.isFinite(Number(snapshot.rating)))
    .map((snapshot) => Number(snapshot.rating))
    .at(-1) ?? null;
  return {
    playerId,
    name: player?.name || "-",
    color: getRatingTrendPlayerColor(playerId),
    points: dates.map((date) => {
      if (Number.isFinite(byDate.get(date))) carried = byDate.get(date);
      return { date, rating: carried };
    })
  };
}

function getRatingTrendPlayerColor(playerId) {
  const value = String(playerId || "");
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return RATING_TREND_COLORS[Math.abs(hash) % RATING_TREND_COLORS.length];
}

function getLatestRating(playerId, snapshots) {
  const playerSnapshots = snapshots
    .filter((snapshot) => snapshot.playerId === playerId && Number.isFinite(Number(snapshot.rating)))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const latest = playerSnapshots.at(-1);
  return latest ? Number(latest.rating) : 0;
}

function formatShortRatingDate(date) {
  const [, month, day] = String(date || "").split("-");
  return month && day ? `${month}-${day}` : date;
}

function formatRatingTrendDateLabel(date, snapshots) {
  const isInitial = snapshots.some((snapshot) => snapshot.date === date && snapshot.source === "import_initial");
  return isInitial ? "初始" : formatShortRatingDate(date);
}

function renderDataTable(viewId, columns, body) {
  if (!body) return;
  renderDataHeader(body.closest("table"), columns, viewId);

  const players = db.players
    .map((player) => ({
      ...player,
      dataStats: getPlayerDataStats(player.id)
    }))
    .sort((a, b) => compareDataPlayers(a, b, viewId));

  if (!players.length) {
    body.innerHTML = `<tr><td colspan="${columns.length}" class="muted">暂无选手</td></tr>`;
    return;
  }

  body.innerHTML = players
    .map((player) => `
      <tr>
        ${columns.map((column) => `<td>${renderDataCell(player, column)}</td>`).join("")}
      </tr>
    `)
    .join("");
}

function renderDataCell(player, column) {
  if (column.key === "name") return `<strong>${escapeHtml(player.name)}</strong>`;
  if (column.key === "rating") return formatRating(player.rating);
  return formatAverage(player.dataStats[column.key], column.type);
}

function renderDataHeader(table, columns, viewId) {
  if (!table) return;
  table.classList.add("rankings-table");
  const header = table.querySelector("thead tr");
  if (!header) return;
  const sortState = dataSortState[viewId];
  header.innerHTML = columns
    .map((column) => `
      <th>
        <button class="table-heading sort-heading" data-data-sort="${column.key}" type="button" aria-label="${escapeHtml(column.sortLabel)}">
          <span>${escapeHtml(column.label)}</span>
          <span class="sort-arrow ${sortState.key === column.key ? "is-active" : ""}">${sortState.key === column.key ? (sortState.direction === "desc" ? "▾" : "▴") : ""}</span>
        </button>
      </th>
    `)
    .join("");
}

function compareRecordPlayers(a, b) {
  const direction = recordSortDirection === "asc" ? 1 : -1;
  if (recordSort === "name") return direction * a.name.localeCompare(b.name, "zh-Hans");
  if (recordSort === "rating") return direction * (Number(a.rating || 0) - Number(b.rating || 0)) || a.name.localeCompare(b.name, "zh-Hans");
  if (recordSort === "netWins") return direction * (a.stats.netWins - b.stats.netWins) || direction * (a.stats.wins - b.stats.wins) || direction * (Number(a.rating || 0) - Number(b.rating || 0)) || a.name.localeCompare(b.name, "zh-Hans");
  if (recordSort === "games") return direction * (a.stats.games - b.stats.games) || direction * (a.stats.wins - b.stats.wins) || direction * (Number(a.rating || 0) - Number(b.rating || 0)) || a.name.localeCompare(b.name, "zh-Hans");
  if (recordSort.startsWith("position-")) {
    const position = recordSort.replace("position-", "");
    return direction * ((a.positionStats.counts[position] || 0) - (b.positionStats.counts[position] || 0)) || direction * (Number(a.rating || 0) - Number(b.rating || 0)) || a.name.localeCompare(b.name, "zh-Hans");
  }
  return 0;
}

function compareDataPlayers(a, b, viewId) {
  const sortState = dataSortState[viewId];
  const direction = sortState.direction === "asc" ? 1 : -1;
  if (sortState.key === "name") return direction * a.name.localeCompare(b.name, "zh-Hans");
  const aValue = getDataSortValue(a, sortState.key);
  const bValue = getDataSortValue(b, sortState.key);
  const aMissing = aValue === null || aValue === undefined;
  const bMissing = bValue === null || bValue === undefined;
  if (aMissing && bMissing) return a.name.localeCompare(b.name, "zh-Hans");
  if (aMissing) return 1;
  if (bMissing) return -1;
  return direction * (aValue - bValue) || a.name.localeCompare(b.name, "zh-Hans");
}

function getDataSortValue(player, key) {
  if (key === "rating") return Number(player.rating || 0);
  return player.dataStats[key];
}

function renderPicker() {
  const picker = $("#playerPicker");
  if (!db.players.length) {
    renderEmpty(picker);
    renderPlayerSearchResults();
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
          <span>评分 ${formatRating(player.rating)}</span>
        </span>
      </label>
    `)
    .join("");
  renderPlayerSearchResults();
  updateSelectionUi();
}

function renderPlayerSearchResults() {
  const target = $("#playerSearchResults");
  const input = $("#playerSearchInput");
  if (!target || !input) return;

  const query = normalizeSearchText(input.value);
  if (!query) {
    playerSearchSelectedId = "";
    target.hidden = true;
    target.innerHTML = "";
    updatePlayerSearchConfirm();
    return;
  }

  const selectedPlayer = getPlayer(playerSearchSelectedId);
  if (selectedPlayer && normalizeSearchText(input.value) === normalizeSearchText(getPlayerSearchSelectionLabel(selectedPlayer))) {
    target.hidden = true;
    target.innerHTML = "";
    updatePlayerSearchConfirm();
    return;
  }

  const selectedIds = new Set(getSelectedPlayerIds());
  const matches = db.players
    .filter((player) => getPlayerSearchText(player).includes(query))
    .slice(0, 8);

  target.hidden = false;
  if (!matches.length) {
    playerSearchSelectedId = "";
    target.innerHTML = `<span class="muted">&#27809;&#26377;&#21305;&#37197;&#30340;&#36873;&#25163;&#12290;</span>`;
    updatePlayerSearchConfirm();
    return;
  }

  if (!matches.some((player) => player.id === playerSearchSelectedId)) {
    playerSearchSelectedId = matches[0].id;
  }

  target.innerHTML = matches.map((player) => {
    const isSelected = player.id === playerSearchSelectedId;
    const alreadyPicked = selectedIds.has(player.id);
    return `
      <button class="player-search-result ${isSelected ? "is-active" : ""} ${alreadyPicked ? "is-picked" : ""}" data-search-player="${player.id}" type="button">
        <strong>${escapeHtml(player.name)}</strong>
        <span>&#35780;&#20998; ${formatRating(player.rating)}${alreadyPicked ? " &middot; &#24050;&#36873;&#25321;" : ""}</span>
      </button>
    `;
  }).join("");
  updatePlayerSearchConfirm();
}

function updatePlayerSearchConfirm() {
  const button = $("#confirmPlayerSearch");
  if (!button) return;
  const selectedIds = new Set(getSelectedPlayerIds());
  const canAdd = Boolean(playerSearchSelectedId)
    && !selectedIds.has(playerSearchSelectedId);
  button.disabled = !canAdd;
}

function getPlayerSearchText(player) {
  return normalizeSearchText([
    player.name,
    player.steamId,
    player.steam_id
  ].filter(Boolean).join(" "));
}

function getPlayerDisplayId(player) {
  return player?.steam_id || player?.steamId || player?.name || "";
}

function getPlayerSearchSelectionLabel(player) {
  return player?.name || getPlayerDisplayId(player);
}

function normalizeSearchText(value) {
  return String(value || "").trim().toLowerCase();
}

function confirmPlayerSearchSelection() {
  if (!playerSearchSelectedId) return;
  const input = $$("#playerPicker input").find((item) => item.value === playerSearchSelectedId);
  if (!input) return;
  if (input.checked) {
    alert("这个选手已经选择了。");
    return;
  }
  if (getSelectedPlayerIds().length >= 10) {
    alert("人数已满");
    return;
  }
  input.checked = true;
  const searchInput = $("#playerSearchInput");
  if (searchInput) searchInput.value = "";
  playerSearchSelectedId = "";
  updateSelectionUi();
  renderPlayerSearchResults();
}

function renderTeams() {
  const teamsGrid = $("#generatedTeams");
  if (teamsGrid) teamsGrid.classList.toggle("is-hidden", !hasGeneratedTeams);
  $("#teamShareActions")?.classList.toggle("is-hidden", !hasGeneratedTeams);
  renderTeam($("#radiantTeam"), db.currentTeams.radiant);
  renderTeam($("#direTeam"), db.currentTeams.dire);
  const radiantRating = sumRating(db.currentTeams.radiant).toFixed(1);
  const direRating = sumRating(db.currentTeams.dire).toFixed(1);
  $("#radiantRating").textContent = `总分 ${radiantRating}`;
  $("#direRating").textContent = `总分 ${direRating}`;
  $("#generatedModeLabel").textContent = BALANCE_MODE_LABELS[generatedBalanceMode] || "位置优先";
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

async function copyTeamsScreenshot() {
  const target = $("#generatedTeams");
  if (!target || target.classList.contains("is-hidden")) {
    alert("请先生成 5v5 对阵。");
    return;
  }

  const button = $("#copyTeamsScreenshot");
  const oldText = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = "正在复制...";
  }

  try {
    const canvas = renderTeamsToCanvas();
    await copyCanvasToClipboard(canvas);
    if (button) button.textContent = "已复制";
    window.setTimeout(() => {
      if (button) button.textContent = oldText;
    }, 1200);
  } catch (error) {
    alert(`复制截图失败：${error.message || "请确认浏览器剪切板权限"}`);
    if (button) button.textContent = oldText;
  } finally {
    if (button) button.disabled = false;
  }
}

function renderTeamsToCanvas() {
  const width = 1040;
  const height = 520;
  const canvas = document.createElement("canvas");
  const scale = Math.max(2, Math.min(3, window.devicePixelRatio || 1));
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext("2d");
  context.scale(scale, scale);
  drawTeamsScreenshot(context, width, height);
  return canvas;
}

async function copyCanvasToClipboard(canvas) {
  if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    try {
      const blob = await canvasToPngBlob(canvas);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      return;
    } catch {
      // Some embedded browsers deny async image clipboard writes. Fall back to a selected image copy.
    }
  }

  if (copyCanvasViaSelection(canvas)) return;
  throw new Error("当前浏览器拒绝写入图片剪切板");
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      blob ? resolve(blob) : reject(new Error("无法生成截图"));
    }, "image/png");
  });
}

function copyCanvasViaSelection(canvas) {
  const container = document.createElement("div");
  container.contentEditable = "true";
  container.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;";
  const image = document.createElement("img");
  image.src = canvas.toDataURL("image/png");
  container.append(image);
  document.body.append(container);

  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(container);
  selection.removeAllRanges();
  selection.addRange(range);
  const copied = document.execCommand("copy");
  selection.removeAllRanges();
  container.remove();
  return copied;
}

function drawTeamsScreenshot(context, width, height) {
  const palette = {
    background: "#f3f6f4",
    surface: "#ffffff",
    soft: "#eef4f1",
    line: "#d8e2dd",
    ink: "#17211c",
    muted: "#69766f",
    green: "#1d7f5c",
    greenDark: "#126246",
    red: "#b94b43"
  };
  const font = `"Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif`;
  const radiant = db.currentTeams.radiant || [];
  const dire = db.currentTeams.dire || [];
  const radiantRating = sumRating(radiant).toFixed(1);
  const direRating = sumRating(dire).toFixed(1);
  const modeLabel = BALANCE_MODE_LABELS[generatedBalanceMode] || "位置优先";

  context.fillStyle = palette.background;
  context.fillRect(0, 0, width, height);
  drawRoundRect(context, 30, 30, width - 60, height - 60, 18, palette.surface, palette.line);

  drawTeamCard(context, {
    x: 58,
    y: 70,
    width: 380,
    height: 380,
    title: "天辉",
    ids: radiant,
    total: radiantRating,
    accent: palette.green,
    palette,
    font
  });

  drawVersusBlock(context, {
    x: 456,
    y: 150,
    width: 128,
    modeLabel,
    palette,
    font
  });

  drawTeamCard(context, {
    x: 602,
    y: 70,
    width: 380,
    height: 380,
    title: "夜魇",
    ids: dire,
    total: direRating,
    accent: palette.red,
    palette,
    font
  });
}

function drawTeamCard(context, options) {
  const { x, y, width, height, title, ids, total, accent, palette, font } = options;
  drawRoundRect(context, x, y, width, height, 14, "#fbfdfc", palette.line);
  context.fillStyle = accent;
  context.fillRect(x, y + 14, 4, height - 28);

  context.fillStyle = palette.ink;
  context.font = `900 24px ${font}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(title, x + width / 2, y + 40);

  ids.forEach((id, index) => {
    const player = getPlayer(id);
    const rowY = y + 78 + index * 52;
    drawRoundRect(context, x + 32, rowY, width - 64, 42, 10, palette.soft, palette.line);
    context.fillStyle = palette.ink;
    context.font = `800 19px ${font}`;
    context.textAlign = "left";
    context.fillText(player?.name || "-", x + 48, rowY + 21);
    context.fillStyle = palette.muted;
    context.font = `700 18px ${font}`;
    context.textAlign = "right";
    context.fillText(formatRating(player?.rating || 0), x + width - 48, rowY + 21);
  });

  context.strokeStyle = palette.line;
  context.beginPath();
  context.moveTo(x + 100, y + height - 54);
  context.lineTo(x + width - 100, y + height - 54);
  context.stroke();

  context.fillStyle = accent;
  context.font = `900 19px ${font}`;
  context.textAlign = "center";
  context.fillText(`总分 ${total}`, x + width / 2, y + height - 26);
}

function drawVersusBlock(context, options) {
  const { x, y, width, modeLabel, palette, font } = options;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = palette.muted;
  context.font = `900 22px ${font}`;
  context.fillText(modeLabel, x + width / 2, y);
  context.fillStyle = palette.greenDark;
  context.font = `900 42px ${font}`;
  context.fillText("VS", x + width / 2, y + 76);
}

function drawRoundRect(context, x, y, width, height, radius, fill, stroke) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
  if (fill) {
    context.fillStyle = fill;
    context.fill();
  }
  if (stroke) {
    context.strokeStyle = stroke;
    context.stroke();
  }
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
      <strong class="available-player-name">${escapeHtml(player.name)}</strong>
      <span class="available-player-side">${escapeHtml(stateLabel)}</span>
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
  const isComplete = isCompleteMatchDetail(detail);
  const meta = [
    detail.position ? `${detail.position}号位` : "未选位置",
    detail.hero || "未选英雄"
  ].join(" · ");

  return `
    <button class="match-player-button ${selectedMatchPlayerId === playerId ? "is-active" : ""} ${isComplete ? "is-complete" : "is-incomplete"}" data-match-player="${playerId}" type="button">
      <strong>${renderPlayerNameWithHero(player?.name || "-", detail.hero)}${renderEntryStatusIcon(isComplete, isComplete ? "数据已录入完整" : "仍有数据未录入")}</strong>
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
  const isComplete = isCompleteMatchDetail(detail);

  editor.innerHTML = `
    <div class="detail-heading">
      <h4>${renderPlayerNameWithHero(player?.name || "-", detail.hero)}</h4>
      <span class="detail-entry-state">${renderEntryStatusIcon(isComplete, isComplete ? "个人数据已录入完整" : "个人数据未录入完整")}${isComplete ? "已录入完整" : "未录入完整"}</span>
    </div>
    <div class="detail-grid">
      <label>
        英雄选择
        <input data-detail-field="hero" list="heroOptions" value="${escapeHtml(detail.hero)}" />
      </label>
      <label>
        位置
        <select data-detail-field="position">
          <option value="">未选择</option>
          ${POSITIONS.map((position) => `<option value="${position}" ${detail.position === position ? "selected" : ""}>${position} 号位</option>`).join("")}
        </select>
      </label>
      <label>
        击杀
        <input data-detail-field="kills" type="number" min="0" step="1" value="${escapeHtml(detail.kills)}" />
      </label>
      <label>
        死亡
        <input data-detail-field="deaths" type="number" min="0" step="1" value="${escapeHtml(detail.deaths)}" />
      </label>
      <label>
        助攻
        <input data-detail-field="assists" type="number" min="0" step="1" value="${escapeHtml(detail.assists)}" />
      </label>
      <label>
        参战率
        <span class="input-suffix">
          <input data-detail-field="participation" type="number" min="0" step="0.001" value="${escapeHtml(detail.participation)}" />
          <span>%</span>
        </span>
      </label>
      <label>
        输出占比
        <span class="input-suffix">
          <input data-detail-field="damageShare" type="number" min="0" step="0.001" value="${escapeHtml(detail.damageShare)}" />
          <span>%</span>
        </span>
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
        建筑伤害
        <input data-detail-field="buildingDamage" type="number" min="0" step="1" value="${escapeHtml(detail.buildingDamage)}" />
      </label>
      <label>
        承受伤害
        <input data-detail-field="damageTaken" type="number" min="0" step="1" value="${escapeHtml(detail.damageTaken)}" />
      </label>
      <label>
        治疗量
        <input data-detail-field="healing" type="number" min="0" step="1" value="${escapeHtml(detail.healing)}" />
      </label>
      <label class="wide">
        特殊内容
        <input data-detail-field="special" value="${escapeHtml(detail.special)}" />
      </label>
    </div>
  `;
  updateMatchEntryStatusIndicators();
}

function renderRecords() {
  const target = $("#recordsGrid");
  if (!target) return;

  const records = getRecordCards();
  target.innerHTML = records.map(renderRecordCard).join("");
}

function getRecordCards() {
  const personalRecords = [
    { key: "kills", label: "单场最高击杀", format: formatIntegerRecord },
    { key: "deaths", label: "单场最高死亡", format: formatIntegerRecord },
    { key: "assists", label: "单场最高助攻", format: formatIntegerRecord },
    { key: "damage", label: "单局最高输出", format: formatIntegerRecord },
    { key: "damageShare", label: "单局最高输出占比", format: formatPercentRecord },
    { key: "gpm", label: "单局最高 GPM", format: formatIntegerRecord },
    { key: "xpm", label: "单局最高 XPM", format: formatIntegerRecord },
    { key: "participation", label: "最高参战率", format: formatPercentRecord },
    { key: "buildingDamage", label: "最高建筑伤害", format: formatIntegerRecord },
    { key: "kda", label: "单场最佳 KDA", format: formatKdaRecord, value: getDetailKda },
    { key: "netWorth10", label: "最高10分钟经济", format: formatIntegerRecord },
    { key: "damageTaken", label: "最高承受伤害", format: formatIntegerRecord }
  ].map(findPersonalRecords);

  return [
    ...personalRecords,
    findDurationRecords("单局最长时间", "longest"),
    findDurationRecords("单局最短时间", "shortest"),
    findMatchKillRecords("单场最多人头", "highest"),
    findMatchKillRecords("单场最少人头", "lowest")
  ];
}

function findPersonalRecords(config) {
  const entries = [];
  db.matches.forEach((match) => {
    Object.entries(match.playerDetails || {}).forEach(([playerId, detail]) => {
      const value = config.value ? config.value(detail) : Number(detail?.[config.key]);
      if (!Number.isFinite(value) || value < 0) return;
      entries.push({
        type: "personal",
        rawValue: value,
        value: config.format(value),
        player: getPlayer(playerId),
        hero: detail.hero,
        matchLabel: formatRecordMatchLabel(match),
        matchId: match.id
      });
    });
  });
  entries.sort((a, b) => b.rawValue - a.rawValue || String(a.matchLabel).localeCompare(String(b.matchLabel), "zh-Hans"));
  return { key: config.key, label: config.label, entries: entries.slice(0, 3) };
}

function findDurationRecords(label, mode) {
  const entries = [];
  db.matches.forEach((match) => {
    const seconds = getMatchDurationSeconds(match);
    if (!Number.isFinite(seconds)) return;
    entries.push({
      rawValue: seconds,
      value: formatDurationRecord(seconds),
      matchLabel: formatRecordMatchLabel(match),
      hero: getWinnerPositionOneHero(match),
      matchId: match.id
    });
  });
  entries.sort((a, b) => {
    const valueDiff = mode === "longest" ? b.rawValue - a.rawValue : a.rawValue - b.rawValue;
    return valueDiff || String(a.matchLabel).localeCompare(String(b.matchLabel), "zh-Hans");
  });
  return { key: `duration-${mode}`, label, entries: entries.slice(0, 3) };
}

function findMatchKillRecords(label, mode) {
  const entries = [];
  db.matches.forEach((match) => {
    const kills = getMatchTotalKills(match);
    if (!Number.isFinite(kills)) return;
    entries.push({
      rawValue: kills,
      value: String(kills),
      matchLabel: formatRecordMatchLabel(match),
      hero: getWinnerPositionOneHero(match),
      matchId: match.id
    });
  });
  entries.sort((a, b) => {
    const valueDiff = mode === "lowest" ? a.rawValue - b.rawValue : b.rawValue - a.rawValue;
    return valueDiff || String(a.matchLabel).localeCompare(String(b.matchLabel), "zh-Hans");
  });
  return { key: `match-kills-${mode}`, label, entries: entries.slice(0, 3) };
}

function renderRecordCard(record) {
  const entries = record.entries || [];
  const activeRank = Math.min(entries.length - 1, Math.max(0, Number(recordCardActiveRanks[record.key] || 0)));
  const stackClass = [
    "record-card-stack",
    `is-rank-${activeRank + 1}`,
    entries.length ? "" : "is-empty"
  ].filter(Boolean).join(" ");
  if (!entries.length) {
    return `
      <article class="${stackClass}">
        <button class="record-card is-empty" disabled type="button">
          <span class="record-card-title">${escapeHtml(record.label)}</span>
          <strong>暂无数据</strong>
        </button>
      </article>
    `;
  }

  return `
    <article class="${stackClass}" data-record-card="${escapeHtml(record.key)}">
      ${[0, 1, 2].map((rank) => renderRecordRankPanel(record, entries[rank], rank, activeRank)).join("")}
    </article>
  `;
}

function renderRecordRankPanel(record, entry, rank, activeRank) {
  const isActive = rank === activeRank;
  const disabled = !entry?.matchId;
  const heroImage = getRecordHeroImageUrl(entry?.hero);
  const playerId = entry?.type === "personal" ? getRecordPlayerId(entry.player) : "";
  const playerIdClass = hasLowercaseLatin(playerId) ? " record-player-id-lowercase" : "";
  const cardStyle = heroImage ? ` style="--record-bg-image: url('${escapeHtml(heroImage)}')"` : "";
  const cardClass = [
    "record-card",
    "record-rank-panel",
    `record-rank-panel-${rank + 1}`,
    isActive ? "is-expanded" : "is-collapsed",
    disabled ? "is-empty" : "",
    heroImage ? "has-hero-bg" : ""
  ].filter(Boolean).join(" ");
  const actionAttribute = [
    !disabled ? `data-open-match="${escapeHtml(entry.matchId)}"` : "",
    `data-record-rank="${rank}"`,
    `data-record-key="${escapeHtml(record.key)}"`
  ].filter(Boolean).join(" ");

  return `
    <button class="${cardClass}"${cardStyle} ${disabled ? "disabled" : actionAttribute} type="button" aria-label="${escapeHtml(record.label)} 第 ${rank + 1} 名">
      <span class="record-rank-badge record-rank-badge-${rank + 1}" aria-hidden="true">${formatRecordRankLabel(rank)}</span>
      ${entry ? `
        <span class="record-card-title">${escapeHtml(record.label)}</span>
        <span class="record-card-body">
          <span class="record-card-main">
            <strong>${escapeHtml(entry.value)}</strong>
            ${entry.type === "personal" ? `<em class="record-player-id${playerIdClass}">${escapeHtml(playerId)}</em>` : ""}
          </span>
        </span>
        ${entry.type === "personal" ? "" : `<small>${escapeHtml(entry.matchLabel || "比赛信息未录入")}</small>`}
      ` : ""}
    </button>
  `;
}

function formatRecordRankLabel(rank) {
  return ["1st", "2nd", "3rd"][rank] || `${rank + 1}th`;
}

function getRecordHeroImageUrl(heroName) {
  const hero = findHero(heroName);
  return hero ? heroImageUrl(hero) : "";
}

function getWinnerPositionOneHero(match) {
  if (!match) return "";
  const winnerIds = match.winner === "dire" ? match.dire : match.radiant;
  const details = match.playerDetails || {};
  const positions = match.positions || {};
  const carryId = winnerIds.find((id) => String(details?.[id]?.position || positions?.[id] || "") === "1") || winnerIds[0];
  return details?.[carryId]?.hero || "";
}

function formatRecordMatchLabel(match) {
  if (!match) return "";
  const dateParts = String(match.date || "").match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  const dateLabel = dateParts
    ? `${dateParts[2].padStart(2, "0")}-${dateParts[3].padStart(2, "0")}`
    : "日期未录入";
  return `${dateLabel}-${String(Number(match.matchNo || 1)).padStart(2, "0")}`;
}

function getRecordPlayerId(player) {
  return player?.steam_id || player?.steamId || player?.name || "选手未录入";
}

function hasLowercaseLatin(value) {
  return /[a-z]/.test(String(value || ""));
}

function formatIntegerRecord(value) {
  return String(Math.round(value));
}

function formatPercentRecord(value) {
  const percent = value <= 1 ? value * 100 : value;
  return `${percent.toFixed(1)}%`;
}

function formatKdaRecord(value) {
  return value.toFixed(2);
}

function getDetailKda(detail) {
  const kills = Number(detail?.kills);
  const assists = Number(detail?.assists);
  const deaths = Number(detail?.deaths);
  if (!Number.isFinite(kills) || !Number.isFinite(assists) || !Number.isFinite(deaths)) return null;
  return (kills + assists) / Math.max(1, deaths);
}

function getMatchDurationSeconds(match) {
  const duration = String(match.score || "").split("/").slice(1).join("/").trim();
  if (!duration) return null;
  const parts = duration.match(/\d+/g)?.map(Number) || [];
  if (parts.length >= 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0] * 60;
  return null;
}

function formatDurationRecord(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function getMatchTotalKills(match) {
  const score = String(match.score || "").split("/")[0] || "";
  const scores = score.match(/\d+/g)?.map(Number) || [];
  if (scores.length >= 2) return scores[0] + scores[1];

  const detailKills = Object.values(match.playerDetails || {})
    .map((detail) => Number(detail?.kills))
    .filter((value) => Number.isFinite(value) && value >= 0);
  return detailKills.length ? detailKills.reduce((sum, value) => sum + value, 0) : null;
}

function renderAdmin() {
  renderAdminPlayers();
  renderAdminPlayoffTeams();
  renderMatchEntryEditor();
  renderAdminMatches();
  updateAdminUi();
}

function renderAdminPlayoffTeams() {
  const target = $("#adminPlayoffTeams");
  if (!target) return;
  if (!adminPlayoffDraftTeams) adminPlayoffDraftTeams = clonePlayoffTeams();
  const teams = adminPlayoffDraftTeams;
  const players = [...db.players].sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0) || a.name.localeCompare(b.name, "zh-Hans"));
  const assignedIds = new Set(Object.values(teams).flat());
  const canAdd = Boolean(adminPlayoffSelectedPlayerId && adminPlayoffSelectedTeam)
    && !assignedIds.has(adminPlayoffSelectedPlayerId)
    && (teams[adminPlayoffSelectedTeam]?.length || 0) < 5;
  const canSave = ["A", "B", "C", "D"].every((team) => (teams[team] || []).length === 5);
  target.innerHTML = `
    <section class="playoff-admin-pool">
      <h4>选手池</h4>
      <div class="playoff-admin-player-list">
        ${players.length ? players.map((player) => {
          const isAssigned = assignedIds.has(player.id);
          const isActive = adminPlayoffSelectedPlayerId === player.id;
          return `
            <button class="playoff-admin-player ${isActive ? "is-active" : ""} ${isAssigned ? "is-assigned" : ""}" data-playoff-player="${escapeHtml(player.id)}" type="button" ${isAssigned ? "disabled" : ""}>
              <span>${escapeHtml(player.name)}</span>
            </button>
          `;
        }).join("") : `<p class="muted">暂无选手</p>`}
      </div>
    </section>

    <div class="playoff-admin-actions">
      <button class="primary-button" id="addPlayoffPlayer" type="button" ${canAdd ? "" : "disabled"}>加入</button>
      <p>${adminPlayoffSelectedPlayerId && adminPlayoffSelectedTeam ? "将选手加入所选队伍" : "先选择选手和队伍"}</p>
    </div>

    <section class="playoff-admin-teams">
      ${["A", "B", "C", "D"].map((team) => `
        <button class="playoff-admin-team ${adminPlayoffSelectedTeam === team ? "is-active" : ""}" data-playoff-target-team="${team}" type="button">
          <span>
            <strong>${team}队</strong>
            <em>${(teams[team] || []).length}/5</em>
          </span>
          ${(teams[team] || []).length ? `<i data-clear-playoff-team="${team}">清除</i>` : ""}
          <div class="playoff-admin-roster">
            ${(teams[team] || []).length
              ? teams[team].map((id) => `<b>${escapeHtml(getPlayer(id)?.name || "未知选手")}</b>`).join("")
              : `<small>选择此队伍</small>`}
          </div>
        </button>
      `).join("")}
    </section>

    <button class="primary-button playoff-save-button ${canSave ? "" : "is-hidden"}" id="savePlayoffTeams" type="button">保存</button>
  `;
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
          <div class="rating-editor">
            <input class="rating-input" data-rating-input="${player.id}" type="number" min="0" step="0.5" value="${formatRating(player.rating)}" />
            <button class="ghost-button compact-button rating-save-button" data-save-rating="${player.id}" type="button" hidden>保存</button>
          </div>
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

function updateRatingSaveButton(input) {
  const button = input?.closest(".rating-editor")?.querySelector("[data-save-rating]");
  if (!button) return;
  const player = getPlayer(input.dataset.ratingInput);
  const inputRating = Number(input.value);
  const currentRating = Number(player?.rating || 0);
  const hasValidChange = Number.isFinite(inputRating) && inputRating >= 0 && inputRating !== currentRating;
  button.hidden = !hasValidChange;
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
        <span>比赛ID</span>
        <strong>${escapeHtml(match.matchId || "数据未录入")}</strong>
      </div>
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

function setRecordStackActiveRank(stack, activeRank) {
  const rank = Math.max(0, Math.min(2, Number(activeRank) || 0));
  const recordKey = stack?.dataset.recordCard;
  if (!stack || !recordKey) return;

  recordCardActiveRanks[recordKey] = rank;
  stack.classList.toggle("is-rank-1", rank === 0);
  stack.classList.toggle("is-rank-2", rank === 1);
  stack.classList.toggle("is-rank-3", rank === 2);
  stack.querySelectorAll(".record-rank-panel").forEach((panel) => {
    const isActive = Number(panel.dataset.recordRank || 0) === rank;
    panel.classList.toggle("is-expanded", isActive);
    panel.classList.toggle("is-collapsed", !isActive);
  });
}

function handleRecordCardPreview(event) {
  const card = event.target.closest("[data-record-rank][data-record-key]");
  if (!card) return;
  const stack = card.closest("[data-record-card]");
  setRecordStackActiveRank(stack, card.dataset.recordRank);
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
    playoffs: renderPlayoffs,
    players: renderPlayers,
    playerProfile: renderPlayerProfile,
    data: renderDataView,
    heroes: renderHeroes,
    records: renderRecords,
    relations: renderRelations,
    ratingTrends: renderRatingTrends,
    generator: renderGenerator,
    admin: renderAdmin
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
        const record = stats.records?.[position] || { wins: 0, losses: 0 };
        return `
          <span class="position-zone position-zone-${position}" title="${position}号位 ${count} 次，胜负 ${record.wins}-${record.losses}">
            ${renderPositionDots(count)}
            <span class="position-record" aria-label="胜负 ${record.wins}-${record.losses}">
              <span class="position-record-item">+${record.wins}</span>
              <span class="position-record-divider"></span>
              <span class="position-record-item">-${record.losses}</span>
            </span>
          </span>
        `;
      }).join("")}
    </div>
  `;
}

function renderPositionDots(count) {
  const safeCount = Math.max(0, Math.floor(Number(count || 0)));
  const tens = Math.floor(safeCount / 10);
  const ones = safeCount % 10;
  const tenDots = Array.from({ length: tens }, () => `
    <span class="position-dot position-dot-ten" title="10 次">
      <svg class="position-dot-star" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 2.8l2.7 5.7 6.2.8-4.6 4.3 1.2 6.1-5.5-3.1-5.5 3.1 1.2-6.1-4.6-4.3 6.2-.8L12 2.8z" />
      </svg>
    </span>
  `).join("");
  const oneDots = Array.from({ length: ones }, () => `<span class="position-dot position-dot-one" title="1 次"></span>`).join("");

  return `
    <span class="position-dot-count" aria-label="${safeCount} 次">
      ${tenDots}${oneDots}
    </span>
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

function updateMatchEntryStatusIndicators() {
  const currentDetail = selectedMatchPlayerId ? (matchDetails[selectedMatchPlayerId] || createEmptyDetail()) : {};
  const isCurrentDetailComplete = isCompleteMatchDetail(currentDetail);
  REQUIRED_DETAIL_FIELDS.forEach((field) => {
    const input = $(`[data-detail-field="${field}"]`);
    if (!input) return;
    setEntryLabelStatus(input.closest("label"), isCompleteDetailField(currentDetail, field));
  });

  const detailState = $(".detail-entry-state");
  if (detailState) {
    detailState.innerHTML = `${renderEntryStatusIcon(isCurrentDetailComplete, isCurrentDetailComplete ? "个人数据已录入完整" : "个人数据未录入完整")}${isCurrentDetailComplete ? "已录入完整" : "未录入完整"}`;
  }

  const selectedButton = $$("[data-match-player]").find((button) => button.dataset.matchPlayer === selectedMatchPlayerId);
  if (selectedButton) {
    selectedButton.classList.toggle("is-complete", isCurrentDetailComplete);
    selectedButton.classList.toggle("is-incomplete", !isCurrentDetailComplete);
    const status = selectedButton.querySelector(".entry-status");
    if (status) {
      status.classList.toggle("is-complete", isCurrentDetailComplete);
      status.classList.toggle("is-missing", !isCurrentDetailComplete);
      status.title = isCurrentDetailComplete ? "数据已录入完整" : "仍有数据未录入";
      status.setAttribute("aria-label", status.title);
    }
  }

  const basicStatuses = [
    ["#matchDate", !isBlank($("#matchDate")?.value)],
    ["#matchNo", !isBlank($("#matchNo")?.value)],
    ["#matchScoreRadiant", !isBlank($("#matchScoreRadiant")?.value) && !isBlank($("#matchScoreDire")?.value)],
    ["#matchDurationMinutes", !isBlank($("#matchDurationMinutes")?.value) && !isBlank($("#matchDurationSeconds")?.value)],
    ["#matchWinner", !isBlank($("#matchWinner")?.value)]
  ];

  basicStatuses.forEach(([selector, isComplete]) => {
    setEntryLabelStatus($(selector)?.closest("label"), isComplete);
  });
}

function setEntryLabelStatus(label, isComplete) {
  if (!label) return;
  label.classList.toggle("entry-field-complete", isComplete);
  label.classList.toggle("entry-field-missing", !isComplete);

  let status = label.querySelector(":scope > .entry-status");
  if (!status) {
    status = document.createElement("span");
    status.className = "entry-status";
    label.prepend(status);
  }
  status.classList.toggle("is-complete", isComplete);
  status.classList.toggle("is-missing", !isComplete);
  status.title = isComplete ? "已录入" : "未录入";
  status.setAttribute("aria-label", status.title);
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
  $("#matchId").value = match.matchId || "";
  const [score = "", duration = ""] = String(match.score || "").split(" / ");
  setScoreValue(score.trim());
  setDurationValue(duration.trim());
  $("#matchWinner").value = match.winner || "radiant";
  $("#matchNote").value = match.note || "";
  $("#matchSubmitButton").textContent = "保存修改";
  $("#matchForm").classList.remove("is-hidden");
  switchView("admin");
  renderMatchEntryEditor();
  revealMatchEntryPanel();
}

function resetMatchForm() {
  setScoreValue("");
  setDurationValue("");
  $("#matchNote").value = "";
  $("#matchNo").value = "";
  $("#matchId").value = "";
  editingMatchId = null;
  matchDetails = {};
  matchEntryTeams = { radiant: [], dire: [] };
  selectedMatchPlayerId = null;
  $("#matchSubmitButton").textContent = "录入比赛";
  $("#matchForm").classList.remove("is-hidden");
  renderMatchEntryEditor();
}

function revealMatchEntryPanel() {
  const entryPanel = $("#adminMatchEntryPanel");
  const historyPanel = $("#adminMatchHistoryPanel");
  if (entryPanel) entryPanel.open = true;
  if (historyPanel) historyPanel.open = false;

  requestAnimationFrame(() => {
    entryPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
    $("#matchDate")?.focus({ preventScroll: true });
  });
}

function createEmptyDetail() {
  return {
    hero: "",
    position: "",
    kills: "",
    deaths: "",
    assists: "",
    participation: "",
    damageShare: "",
    gpm: "",
    xpm: "",
    netWorth10: "",
    damage: "",
    buildingDamage: "",
    damageTaken: "",
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
    if (isBlank(detail.kills)) missingFields.push(`${playerName} 的击杀`);
    if (isBlank(detail.deaths)) missingFields.push(`${playerName} 的死亡`);
    if (isBlank(detail.assists)) missingFields.push(`${playerName} 的助攻`);
    if (isBlank(detail.participation)) missingFields.push(`${playerName} 的参战率`);
    if (isBlank(detail.damageShare)) missingFields.push(`${playerName} 的输出占比`);
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

  const mode = getBalanceMode();
  db.currentTeams = await api("/api/teams", {
    method: "POST",
    body: JSON.stringify({
      ids,
      mode,
      constraints
    })
  });
  saveTeamGenerationCooldown(ids);
  generatedBalanceMode = mode;
  hasGeneratedTeams = true;
  renderPicker();
  renderTeams();
  updateGenerateTeamsButton();
}

function getTeamGenerationCooldown(ids) {
  const key = teamGenerationKey(ids);
  const record = readTeamGenerationCooldown();
  if (!record || record.key !== key) return { remainingMs: 0 };
  const remainingMs = TEAM_GENERATION_COOLDOWN_MS - (Date.now() - Number(record.createdAt || 0));
  return { remainingMs: Math.max(0, remainingMs) };
}

function saveTeamGenerationCooldown(ids) {
  localStorage.setItem(TEAM_GENERATION_COOLDOWN_KEY, JSON.stringify({
    key: teamGenerationKey(ids),
    createdAt: Date.now()
  }));
}

function readTeamGenerationCooldown() {
  try {
    return JSON.parse(localStorage.getItem(TEAM_GENERATION_COOLDOWN_KEY) || "null");
  } catch {
    return null;
  }
}

function teamGenerationKey(ids) {
  return [...new Set(ids)].sort().join("::");
}

function formatTeamGenerationError(error) {
  const details = error.details || {};
  const parts = [error.message];
  if (Number.isFinite(details.validPlayerCount) && details.validPlayerCount !== 10) {
    parts.push(`有效选手数：${details.validPlayerCount}/10。`);
  }
  if (Number.isFinite(details.afterConstraints) && details.afterConstraints === 0) {
    parts.push("当前分队预设互相冲突，所有组合都被过滤了。");
  }
  if (Number.isFinite(details.afterConstraints) && details.afterConstraints > 0 && details.withinRatingLimit === 0) {
    parts.push(`预设内共有 ${details.afterConstraints} 种组合，但最接近的评分差是 ${formatRating(details.bestDiff)}，仍大于 1。`);
  }
  return parts.join("\n");
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
  updatePlayerSearchConfirm();
  renderConstraintOptions();
  updateGenerateTeamsButton();
}

function updateGenerateTeamsButton() {
  const button = $("#generateTeams");
  if (!button) return;
  const ids = getSelectedPlayerIds();
  const cooldown = ids.length === 10 ? getTeamGenerationCooldown(ids) : { remainingMs: 0 };
  const remainingSeconds = Math.ceil(cooldown.remainingMs / 1000);
  const isCoolingDown = remainingSeconds > 0;
  button.disabled = isCoolingDown;
  button.classList.toggle("is-cooling-down", isCoolingDown);
  button.textContent = isCoolingDown ? `${remainingSeconds}s 后可再次生成` : "生成 5v5 对阵";

  if (teamGenerationCooldownTimer) {
    window.clearTimeout(teamGenerationCooldownTimer);
    teamGenerationCooldownTimer = null;
  }
  if (isCoolingDown) {
    teamGenerationCooldownTimer = window.setTimeout(updateGenerateTeamsButton, 1000);
  }
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

function formatAverage(value, type = "number") {
  if (value === null || value === undefined) return "-";
  if (type === "percent") {
    const number = Number(value);
    if (!Number.isFinite(number)) return "-";
    return `${(number <= 1 ? number * 100 : number).toFixed(1)}%`;
  }
  return String(value);
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
          <td>${renderStatValue(detail.kills)}</td>
          <td>${renderStatValue(detail.deaths)}</td>
          <td>${renderStatValue(detail.assists)}</td>
          <td>${renderPercentStat(detail.participation)}</td>
          <td>${renderPercentStat(detail.damageShare)}</td>
          <td>${renderStatValue(detail.gpm)}</td>
          <td>${renderStatValue(detail.xpm)}</td>
          <td>${renderStatValue(detail.netWorth10)}</td>
          <td>${renderStatValue(detail.damage)}</td>
          <td>${renderStatValue(detail.buildingDamage)}</td>
          <td>${renderStatValue(detail.damageTaken)}</td>
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
              <th>击杀</th>
              <th>死亡</th>
              <th>助攻</th>
              <th>参战率</th>
              <th>输出占比</th>
              <th>GPM</th>
              <th>XPM</th>
              <th>10分钟经济</th>
              <th>伤害</th>
              <th>建筑伤害</th>
              <th>承受伤害</th>
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

function renderPercentStat(value) {
  if (value === "" || value === null || value === undefined) return `<span class="missing-data">数据未录入</span>`;
  const number = Number(value);
  if (!Number.isFinite(number)) return escapeHtml(value);
  return `${(number <= 1 ? number * 100 : number).toFixed(1)}%`;
}

async function fileToBase64(file) {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function renderExcelImportPreview(result) {
  const target = $("#excelImportPreview");
  if (!target) return;
  const existingMatchKeys = new Set(db.matches.map((match) => matchKey(match)));
  pendingExcelMatches = sortExcelPreviewMatches(result.matches || [], existingMatchKeys);

  const errors = result.errors || [];
  const warnings = result.warnings || [];
  const rows = pendingExcelMatches.map((match, index) => {
    const isDuplicate = existingMatchKeys.has(matchKey(match));
    const hasMissingPlayers = Array.isArray(match.missingPlayers) && match.missingPlayers.length > 0;
    const importErrors = Array.isArray(match.importErrors) ? match.importErrors : [];
    const hasImportErrors = importErrors.length > 0;
    const shouldCheck = !isDuplicate && !hasMissingPlayers && !hasImportErrors;
    const rowMessages = [
      ...importErrors,
      ...(Array.isArray(match.missingPlayers) && match.missingPlayers.length
        ? [`缺少选手：${match.missingPlayers.join("、")}`]
        : [])
    ];
    return `
      <tr class="${isDuplicate || hasMissingPlayers || hasImportErrors ? "excel-duplicate-row" : ""}">
        <td><input data-excel-match-index="${index}" type="checkbox" ${shouldCheck ? "checked" : ""} ${hasMissingPlayers || hasImportErrors ? "disabled" : ""} /></td>
        <td>${escapeHtml(match.sheetName || "-")}</td>
        <td>${escapeHtml(match.date || "-")}</td>
        <td>${Number(match.matchNo || 1)}</td>
        <td>${escapeHtml(match.matchId || "-")}</td>
        <td>${match.winner === "radiant" ? "天辉" : "夜魇"}</td>
        <td>${escapeHtml(match.score || "-")}</td>
        <td title="${escapeHtml(rowMessages.join("\n"))}">
          ${renderMatchQualityBadge(match)}
          ${isDuplicate ? `<span class="duplicate-badge">已存在</span>` : ""}
          ${hasMissingPlayers ? `<span class="duplicate-badge">缺选手</span>` : ""}
          ${hasImportErrors ? `<span class="duplicate-badge">有错误</span>` : ""}
        </td>
      </tr>
    `;
  }).join("");

  target.innerHTML = `
    <div class="excel-preview-card">
      <h4>Excel 导入预览</h4>
      <p>识别到 ${pendingExcelMatches.length} 场比赛。缺少位置时会导入为空，之后可在比赛编辑里手动补。</p>
      ${errors.length ? `<div class="excel-message error">${errors.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}</div>` : ""}
      ${warnings.length ? `<div class="excel-message warning">${warnings.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}</div>` : ""}
      ${rows ? `
        <div class="table-wrap excel-preview-table-wrap">
          <table class="excel-preview-table">
            <thead><tr><th>导入</th><th>Sheet</th><th>日期</th><th>场次</th><th>比赛ID</th><th>胜方</th><th>比分 / 时长</th><th>状态</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      ` : ""}
      <div class="button-row">
        <button class="primary-button" id="confirmExcelImport" type="button" ${result.canImport ? "" : "disabled"}>确认导入 Excel 比赛</button>
        <button class="secondary-button" id="clearExcelImport" type="button">取消预览</button>
      </div>
    </div>
  `;
}

function renderRatingHistoryImportPreview(result) {
  const target = $("#ratingHistoryImportPreview");
  if (!target) return;

  pendingRatingSnapshots = Array.isArray(result.snapshots) ? result.snapshots : [];
  const errors = result.errors || [];
  const unmatchedPlayers = result.unmatchedPlayers || [];
  const dateColumns = result.dateColumns || [];
  const skippedColumns = result.skippedColumns || [];
  const matchedPlayers = result.matchedPlayers || [];
  const previewRows = pendingRatingSnapshots.slice(0, 12).map((snapshot) => `
    <tr>
      <td>${escapeHtml(snapshot.date)}</td>
      <td>${escapeHtml(snapshot.playerName || "-")}</td>
      <td>${formatRating(snapshot.rating)}</td>
    </tr>
  `).join("");

  target.innerHTML = `
    <div class="excel-preview-card">
      <h4>历史评分导入预览</h4>
      <p>识别到 ${dateColumns.length} 个日期列，匹配 ${matchedPlayers.length} 名选手，可导入 ${pendingRatingSnapshots.length} 条评分记录。</p>
      ${errors.length ? `<div class="excel-message error">${errors.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}</div>` : ""}
      ${unmatchedPlayers.length ? `<div class="excel-message warning"><p>未匹配选手：${escapeHtml(unmatchedPlayers.join("、"))}</p></div>` : ""}
      ${skippedColumns.length ? `<div class="excel-message warning"><p>已跳过列：${escapeHtml(skippedColumns.join("、"))}</p></div>` : ""}
      ${previewRows ? `
        <div class="table-wrap excel-preview-table-wrap">
          <table class="excel-preview-table">
            <thead><tr><th>日期</th><th>选手</th><th>评分</th></tr></thead>
            <tbody>${previewRows}</tbody>
          </table>
        </div>
      ` : ""}
      <div class="button-row">
        <button class="primary-button" id="confirmRatingHistoryImport" type="button" ${result.canImport ? "" : "disabled"}>确认导入历史评分</button>
        <button class="secondary-button" id="clearRatingHistoryImport" type="button">取消预览</button>
      </div>
    </div>
  `;
}

function sortExcelPreviewMatches(matches, existingMatchKeys) {
  return [...matches].sort((a, b) => getExcelPreviewRank(a, existingMatchKeys) - getExcelPreviewRank(b, existingMatchKeys));
}

function getExcelPreviewRank(match, existingMatchKeys) {
  const isDuplicate = existingMatchKeys.has(matchKey(match));
  const hasMissingPlayers = Array.isArray(match.missingPlayers) && match.missingPlayers.length > 0;
  const hasImportErrors = Array.isArray(match.importErrors) && match.importErrors.length > 0;
  if (!isDuplicate && !hasMissingPlayers && !hasImportErrors) return 0;
  if (!isDuplicate) return 1;
  return 2;
}

function matchKey(match) {
  if (!isBlank(match.matchId)) return `match-id::${match.matchId}`;
  return `${match.date || ""}::${Number(match.matchNo || 1)}`;
}

function formatDuplicateMatchLabel(match) {
  if (!isBlank(match.matchId)) return `比赛ID ${match.matchId}`;
  return `${formatShortMatchDate(match.date)}第${Number(match.matchNo || 1)}场`;
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
  setupPasswordControls();

  document.addEventListener("error", (event) => {
    if (event.target?.classList?.contains("hero-avatar")) {
      event.target.remove();
    }
  }, true);

  $$(".nav-tab").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view || button.dataset.navDefault));
  });

  $("#recentMatches").addEventListener("click", handleMatchCardOpen);
  $("#recentMatches").addEventListener("keydown", handleMatchCardKeydown);
  $("#toggleAllMatches")?.addEventListener("click", () => {
    showAllDashboardMatches = !showAllDashboardMatches;
    renderDashboardMatches();
  });
  $("#closeMatchDialog").addEventListener("click", () => $("#matchDetailDialog").close());
  $("#matchDetailDialog").addEventListener("click", (event) => {
    if (event.target.id === "matchDetailDialog") event.target.close();
  });

  $("#players").addEventListener("click", (event) => {
    const sortButton = event.target.closest("[data-record-sort]");
    const sortKey = sortButton?.dataset.recordSort;
    if (!sortKey) return;
    if (recordSort === sortKey) {
      recordSortDirection = recordSortDirection === "desc" ? "asc" : "desc";
    } else {
      recordSort = sortKey;
      recordSortDirection = "desc";
    }
    renderPlayers();
  });

  $("#playerProfile")?.addEventListener("click", (event) => {
    const playerButton = event.target.closest("[data-player-profile-id]");
    if (playerButton) {
      selectedPlayerProfileId = playerButton.dataset.playerProfileId;
      selectedPlayerProfilePosition = "";
      selectedPlayerProfileHeroKey = "";
      showAllPlayerProfileMatches = false;
      renderPlayerProfile();
      return;
    }

    if (event.target.closest("#togglePlayerProfileMatches")) {
      showAllPlayerProfileMatches = !showAllPlayerProfileMatches;
      renderPlayerProfile();
      return;
    }

    const matchCard = event.target.closest("[data-open-match]");
    if (matchCard) {
      handleMatchCardOpen(event);
      return;
    }

    const positionButton = event.target.closest("[data-player-profile-position]");
    if (positionButton) {
      const position = positionButton.dataset.playerProfilePosition;
      selectedPlayerProfilePosition = selectedPlayerProfilePosition === position ? "" : position;
      selectedPlayerProfileHeroKey = "";
      renderPlayerProfile();
      return;
    }

    const heroButton = event.target.closest("[data-player-profile-hero]");
    if (!heroButton) return;
    const heroKey = heroButton.dataset.playerProfileHero;
    selectedPlayerProfileHeroKey = selectedPlayerProfileHeroKey === heroKey ? "" : heroKey;
    selectedPlayerProfilePosition = "";
    renderPlayerProfile();
  });
  $("#playerProfile")?.addEventListener("keydown", handleMatchCardKeydown);

  $("#relations")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-pair-rank][data-pair-mode]");
    if (!button) return;
    pairRankModes[button.dataset.pairRank] = button.dataset.pairMode;
    renderRelations();
  });

  $("#relations")?.addEventListener("change", (event) => {
    if (event.target.closest("[data-teammate-query-index]")) {
      renderTeammateQuery();
      return;
    }
    if (event.target.closest("#opponentQueryA, #opponentQueryB")) {
      renderOpponentQuery();
    }
  });

  $("#ratingTrends")?.addEventListener("change", (event) => {
    const input = event.target.closest("[data-rating-trend-player]");
    if (!input) return;
    ratingTrendHasUserSelection = true;
    if (input.checked) {
      ratingTrendSelectedIds = [...new Set([...ratingTrendSelectedIds, input.dataset.ratingTrendPlayer])];
    } else {
      ratingTrendSelectedIds = ratingTrendSelectedIds.filter((id) => id !== input.dataset.ratingTrendPlayer);
    }
    renderRatingTrends();
  });

  $("#ratingTrends")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-rating-trend-action]");
    if (!button) return;
    const snapshots = Array.isArray(db.ratingSnapshots) ? db.ratingSnapshots : [];
    const validIds = new Set(snapshots.map((snapshot) => snapshot.playerId));
    ratingTrendHasUserSelection = true;
    ratingTrendSelectedIds = button.dataset.ratingTrendAction === "select-all"
      ? db.players.filter((player) => validIds.has(player.id)).map((player) => player.id)
      : [];
    renderRatingTrends();
  });

  $("#heroes")?.addEventListener("click", (event) => {
    const usageButton = event.target.closest("[data-hero-usage-sort]");
    if (usageButton) {
      heroUsageSort = usageButton.dataset.heroUsageSort;
      renderPlayerHeroUsage();
      return;
    }

    const button = event.target.closest("[data-hero-rank][data-hero-mode]");
    if (!button) return;
    heroRankModes[button.dataset.heroRank] = button.dataset.heroMode;
    renderHeroRankings();
  });

  $("#records")?.addEventListener("click", handleMatchCardOpen);
  $("#records")?.addEventListener("pointerover", handleRecordCardPreview);
  $("#records")?.addEventListener("mouseover", handleRecordCardPreview);
  $("#records")?.addEventListener("mousemove", handleRecordCardPreview);
  $("#records")?.addEventListener("focusin", handleRecordCardPreview);
  $("#records")?.addEventListener("keydown", handleMatchCardKeydown);

  $("#data")?.addEventListener("click", (event) => {
    const modeButton = event.target.closest("[data-data-view-mode]");
    if (modeButton) {
      activeDataViewMode = modeButton.dataset.dataViewMode === "advanced" ? "advanced" : "basic";
      renderDataView();
      return;
    }

    const sortButton = event.target.closest("[data-data-sort]");
    const sortKey = sortButton?.dataset.dataSort;
    if (!sortKey) return;
    const viewId = getActiveDataViewId();
    const sortState = dataSortState[viewId];
    if (sortState.key === sortKey) {
      sortState.direction = sortState.direction === "desc" ? "asc" : "desc";
    } else {
      sortState.key = sortKey;
      sortState.direction = "desc";
    }
    renderDataView();
  });

  $("#playerForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await adminApi("/api/players", {
        method: "POST",
        body: JSON.stringify({
          name: $("#playerName").value.trim(),
          rating: $("#playerRating").value || 5,
          note: $("#playerNote").value.trim()
        })
      });
      form.reset();
      await loadState();
    } catch (error) {
      alert(error.message);
    }
  });

  $("#playerPicker").addEventListener("change", handlePlayerPickerChange);
  $("#playerSearchInput")?.addEventListener("input", () => {
    if (isComposingPlayerSearch) return;
    playerSearchSelectedId = "";
    renderPlayerSearchResults();
  });
  $("#playerSearchInput")?.addEventListener("compositionstart", () => {
    isComposingPlayerSearch = true;
  });
  $("#playerSearchInput")?.addEventListener("compositionend", () => {
    isComposingPlayerSearch = false;
    playerSearchSelectedId = "";
    renderPlayerSearchResults();
  });
  $("#playerSearchInput")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    confirmPlayerSearchSelection();
  });
  $("#playerSearchResults")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-search-player]");
    if (!button) return;
    playerSearchSelectedId = button.dataset.searchPlayer;
    const player = getPlayer(playerSearchSelectedId);
    const input = $("#playerSearchInput");
    if (input && player) input.value = getPlayerSearchSelectionLabel(player);
    renderPlayerSearchResults();
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest(".player-search-panel")) return;
    const target = $("#playerSearchResults");
    if (target) target.hidden = true;
  });
  $("#confirmPlayerSearch")?.addEventListener("click", confirmPlayerSearchSelection);

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
    updateMatchEntryStatusIndicators();
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

  $("#adminPlayersBody").addEventListener("input", (event) => {
    const input = event.target.closest("[data-rating-input]");
    if (!input) return;
    updateRatingSaveButton(input);
  });

  $("#adminPlayersBody").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-save-rating]");
    if (!button) return;
    const input = button.closest(".rating-editor")?.querySelector("[data-rating-input]");
    if (!input) return;

    try {
      button.disabled = true;
      await adminApi(`/api/players/${button.dataset.saveRating}/rating`, {
        method: "PUT",
        body: JSON.stringify({ rating: input.value })
      });
      await loadState();
    } catch (error) {
      alert(error.message);
      button.disabled = false;
    }
  });

  $("#adminPlayoffTeams")?.addEventListener("click", async (event) => {
    if (!adminPlayoffDraftTeams) adminPlayoffDraftTeams = clonePlayoffTeams();

    const clearButton = event.target.closest("[data-clear-playoff-team]");
    if (clearButton) {
      event.preventDefault();
      const team = clearButton.dataset.clearPlayoffTeam;
      adminPlayoffDraftTeams[team] = [];
      if (adminPlayoffSelectedTeam === team) adminPlayoffSelectedTeam = "";
      renderAdminPlayoffTeams();
      return;
    }

    const playerButton = event.target.closest("[data-playoff-player]");
    if (playerButton) {
      adminPlayoffSelectedPlayerId = playerButton.dataset.playoffPlayer;
      renderAdminPlayoffTeams();
      return;
    }

    const teamButton = event.target.closest("[data-playoff-target-team]");
    if (teamButton) {
      adminPlayoffSelectedTeam = teamButton.dataset.playoffTargetTeam;
      renderAdminPlayoffTeams();
      return;
    }

    if (event.target.closest("#addPlayoffPlayer")) {
      const team = adminPlayoffSelectedTeam;
      const playerId = adminPlayoffSelectedPlayerId;
      const alreadyAssigned = Object.values(adminPlayoffDraftTeams).some((ids) => ids.includes(playerId));
      if (!team || !playerId || alreadyAssigned || adminPlayoffDraftTeams[team].length >= 5) return;
      adminPlayoffDraftTeams[team].push(playerId);
      adminPlayoffSelectedPlayerId = "";
      renderAdminPlayoffTeams();
      return;
    }

    if (!event.target.closest("#savePlayoffTeams")) return;
    try {
      db.playoffTeams = await adminApi("/api/playoffs/teams", {
        method: "POST",
        body: JSON.stringify({ teams: adminPlayoffDraftTeams })
      });
      adminPlayoffDraftTeams = clonePlayoffTeams(db.playoffTeams);
      renderAdminPlayoffTeams();
      renderPlayoffs();
      alert("季后赛队伍已保存。");
    } catch (error) {
      alert(error.message);
    }
  });

  $("#clearSelection").addEventListener("click", async () => {
    try {
      db.currentTeams = { radiant: [], dire: [] };
      await api("/api/teams/manual", {
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
  $("#generateTeams").addEventListener("click", () => saveTeams().catch((error) => alert(formatTeamGenerationError(error))));
  $("#copyTeamsScreenshot")?.addEventListener("click", () => copyTeamsScreenshot());

  $("#matchDate").valueAsDate = new Date();

  $("#matchForm").addEventListener("input", () => {
    updateSelectedDetailFromForm();
    updateMatchEntryStatusIndicators();
  });

  $("#matchForm").addEventListener("change", updateMatchEntryStatusIndicators);

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
          matchId: $("#matchId").value.trim(),
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

  $("#importExcelData")?.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const result = await adminApi("/api/excel/preview", {
        method: "POST",
        body: JSON.stringify({
          fileName: file.name,
          fileBase64: await fileToBase64(file)
        })
      });
      renderExcelImportPreview(result);
    } catch (error) {
      alert(error.message || "Excel 解析失败，请确认文件格式。");
    } finally {
      event.target.value = "";
    }
  });

  $("#excelImportPreview")?.addEventListener("click", async (event) => {
    if (event.target.id === "clearExcelImport") {
      pendingExcelMatches = [];
      $("#excelImportPreview").innerHTML = "";
      return;
    }

    if (event.target.id !== "confirmExcelImport") return;
    const selectedMatches = $$("[data-excel-match-index]:checked")
      .map((input) => pendingExcelMatches[Number(input.dataset.excelMatchIndex)])
      .filter(Boolean);
    if (!selectedMatches.length) {
      alert("请至少选择一场要导入的比赛。");
      return;
    }
    const existingKeys = new Set(db.matches.map((match) => matchKey(match)));
    const duplicates = selectedMatches.filter((match) => existingKeys.has(matchKey(match)));
    if (duplicates.length) {
      const duplicateText = duplicates
        .map((match) => `已存在${formatDuplicateMatchLabel(match)}比赛`)
        .join("\n");
      if (!confirm(`${duplicateText}\n是否继续录入？`)) return;
    }
    if (!confirm(`确认导入选中的 ${selectedMatches.length} 场 Excel 比赛吗？`)) return;

    try {
      const result = await adminApi("/api/excel/import", {
        method: "POST",
        body: JSON.stringify({ matches: selectedMatches })
      });
      db = result.state;
      rebuildDerivedStats();
      pendingExcelMatches = [];
      $("#excelImportPreview").innerHTML = "";
      renderAll();
      alert(`已导入 ${result.imported} 场比赛。`);
    } catch (error) {
      alert(error.details?.join("\n") || error.message);
    }
  });

  $("#importRatingHistoryData")?.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const result = await adminApi("/api/rating-history/preview", {
        method: "POST",
        body: JSON.stringify({
          fileName: file.name,
          fileBase64: await fileToBase64(file)
        })
      });
      renderRatingHistoryImportPreview(result);
    } catch (error) {
      alert(error.message || "历史评分 Excel 解析失败，请确认文件格式。");
    } finally {
      event.target.value = "";
    }
  });

  $("#ratingHistoryImportPreview")?.addEventListener("click", async (event) => {
    if (event.target.id === "clearRatingHistoryImport") {
      pendingRatingSnapshots = [];
      $("#ratingHistoryImportPreview").innerHTML = "";
      return;
    }

    if (event.target.id !== "confirmRatingHistoryImport") return;
    if (!pendingRatingSnapshots.length) {
      alert("没有可导入的历史评分。");
      return;
    }
    if (!confirm(`确认导入 ${pendingRatingSnapshots.length} 条历史评分记录吗？`)) return;

    try {
      const result = await adminApi("/api/rating-history/import", {
        method: "POST",
        body: JSON.stringify({ snapshots: pendingRatingSnapshots })
      });
      db = result.state;
      rebuildDerivedStats();
      pendingRatingSnapshots = [];
      $("#ratingHistoryImportPreview").innerHTML = "";
      renderAll();
      alert(`已导入 ${result.imported} 条历史评分记录。`);
    } catch (error) {
      alert(error.details?.join("\n") || error.message);
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

function setupPasswordControls() {
  const input = $("#adminPasswordInput");
  const toggle = $("#adminPasswordToggle");
  const capsHint = $("#adminCapsLockHint");
  if (!input) return;

  const updateCapsHint = (event) => {
    const isCapsLock = Boolean(event?.getModifierState?.("CapsLock"));
    capsHint?.classList.toggle("is-visible", isCapsLock);
  };

  input.addEventListener("keydown", updateCapsHint);
  input.addEventListener("keyup", updateCapsHint);
  input.addEventListener("focus", updateCapsHint);
  input.addEventListener("blur", () => capsHint?.classList.remove("is-visible"));

  toggle?.addEventListener("click", () => {
    const isVisible = input.type === "text";
    input.type = isVisible ? "password" : "text";
    toggle.setAttribute("aria-pressed", String(!isVisible));
    toggle.setAttribute("aria-label", isVisible ? "显示密码" : "隐藏密码");
    input.focus();
  });
}

function initializeSplashScreen() {
  const splash = $("#splashScreen");
  const enterButtons = $$(".splash-enter-button");
  const returnToSplashButton = $("#returnToSplashHome");
  const video = splash?.querySelector(".splash-video");
  const playButton = $("#playSplashVideo");
  const returnButton = $("#returnSplashHome");
  const progress = $("#splashVideoProgress");
  const progressText = $("#splashVideoProgressText");
  const progressBar = $("#splashVideoProgressBar");
  const splashTransitionDuration = 720;
  const appRevealDuration = 1280;
  let splashVideoObjectUrl = "";
  let splashVideoRequest = null;
  let isSplashVideoLoading = false;
  let hasSplashVideoLoaded = false;
  let isLeavingSplash = false;

  video?.addEventListener("error", () => {
    video.classList.add("is-hidden");
  });
  video?.addEventListener("canplay", () => {
    video.classList.add("is-ready");
  });
  video?.addEventListener("loadeddata", () => {
    video.classList.add("is-ready");
  });

  const setVideoProgress = (value) => {
    const percent = Math.max(0, Math.min(100, Math.round(value)));
    if (progressText) progressText.textContent = `${percent}%`;
    if (progressBar) progressBar.style.width = `${percent}%`;
  };

  const showSplashHome = ({ replayIntro = false } = {}) => {
    if (splashVideoRequest) {
      splashVideoRequest.abort();
      splashVideoRequest = null;
    }
    isSplashVideoLoading = false;
    document.body.classList.toggle("has-splash-video-returned", !replayIntro);
    document.body.classList.remove("is-splash-video-mode", "is-splash-video-playing");
    video?.pause();
    if (video) {
      try {
        video.currentTime = 0;
      } catch {
        // Video metadata may not exist yet when a download is cancelled.
      }
      video.removeAttribute("src");
      video.load();
      video.classList.remove("is-ready", "is-hidden");
    }
    if (splashVideoObjectUrl) {
      URL.revokeObjectURL(splashVideoObjectUrl);
      splashVideoObjectUrl = "";
    }
    hasSplashVideoLoaded = false;
    if (progress) progress.hidden = true;
    setVideoProgress(0);
    if (playButton) {
      playButton.disabled = false;
      playButton.textContent = "播放动画";
    }
  };

  const showSplashVideoLoading = () => {
    document.body.classList.remove("has-splash-video-returned");
    document.body.classList.add("is-splash-video-mode");
    document.body.classList.remove("is-splash-video-playing");
    if (progress) progress.hidden = false;
    setVideoProgress(0);
    if (playButton) {
      playButton.disabled = true;
      playButton.textContent = "正在加载";
    }
  };

  const showSplashVideoPlaying = () => {
    document.body.classList.add("is-splash-video-mode", "is-splash-video-playing");
    if (progress) progress.hidden = true;
  };

  const loadSplashVideo = () => new Promise((resolve, reject) => {
    if (!video) {
      reject(new Error("未找到开场影片"));
      return;
    }
    if (hasSplashVideoLoaded) {
      resolve();
      return;
    }

    const source = video.dataset.src;
    if (!source) {
      reject(new Error("未配置开场影片"));
      return;
    }

    splashVideoRequest = new XMLHttpRequest();
    splashVideoRequest.open("GET", source);
    splashVideoRequest.responseType = "blob";
    splashVideoRequest.onprogress = (event) => {
      if (event.lengthComputable) {
        setVideoProgress((event.loaded / event.total) * 100);
      }
    };
    splashVideoRequest.onabort = () => reject(new Error("开场影片加载已取消"));
    splashVideoRequest.onerror = () => reject(new Error("开场影片加载失败"));
    splashVideoRequest.onload = () => {
      if (splashVideoRequest.status < 200 || splashVideoRequest.status >= 300) {
        reject(new Error(`开场影片加载失败：${splashVideoRequest.status}`));
        return;
      }

      if (splashVideoObjectUrl) URL.revokeObjectURL(splashVideoObjectUrl);
      splashVideoObjectUrl = URL.createObjectURL(splashVideoRequest.response);
      video.addEventListener("loadeddata", () => {
        hasSplashVideoLoaded = true;
        setVideoProgress(100);
        resolve();
      }, { once: true });
      video.addEventListener("error", () => reject(new Error("开场影片无法播放")), { once: true });
      video.src = splashVideoObjectUrl;
      video.load();
    };
    splashVideoRequest.onloadend = () => {
      splashVideoRequest = null;
    };
    splashVideoRequest.send();
  });

  playButton?.addEventListener("click", async () => {
    if (isSplashVideoLoading || document.body.classList.contains("has-entered")) return;
    isSplashVideoLoading = true;
    showSplashVideoLoading();

    try {
      await loadSplashVideo();
      video.classList.add("is-ready");
      await video.play();
      showSplashVideoPlaying();
    } catch (error) {
      if (isLeavingSplash || !document.body.classList.contains("is-splash-video-mode")) return;
      showSplashHome();
      alert(error.message);
    } finally {
      isSplashVideoLoading = false;
    }
  });

  returnButton?.addEventListener("click", () => showSplashHome());

  const showStateLoadError = (error) => {
    enterButtons.forEach((button) => {
      button.disabled = false;
    });
    document.body.classList.remove("is-entering", "has-entered");
    document.body.innerHTML = `
      <main style="padding: 32px; font-family: system-ui, sans-serif;">
        <h1>后端服务没有连接上</h1>
        <p>请在项目目录运行 <code>npm start</code>，然后打开 <code>http://localhost:3000</code>。</p>
        <pre>${escapeHtml(error.message)}</pre>
      </main>
    `;
  };

  const enterApp = async (targetView) => {
    if (document.body.classList.contains("is-entering") || document.body.classList.contains("has-entered")) return;
    isLeavingSplash = true;
    sessionStorage.setItem(APP_ENTERED_KEY, "1");
    if (splashVideoRequest) splashVideoRequest.abort();
    enterButtons.forEach((button) => {
      button.disabled = true;
    });
    if (playButton) {
      playButton.disabled = true;
    }
    if (targetView && targetView !== "dashboard") {
      switchView(targetView);
    }
    document.body.classList.add("is-entering");
    video?.pause?.();
    window.setTimeout(() => {
      document.body.classList.add("has-entered");
    }, splashTransitionDuration);
    window.setTimeout(() => {
      document.body.classList.remove("is-entering");
    }, appRevealDuration);
    if (!db.players.length && !db.matches.length) {
      try {
        await ensureStateLoaded();
      } catch (error) {
        showStateLoadError(error);
        return;
      }
      if (targetView && targetView !== "dashboard") {
        switchView(targetView);
      }
      return;
    }
  };

  enterButtons.forEach((button) => {
    button.addEventListener("click", () => enterApp(button.dataset.splashTarget || "dashboard"));
  });

  returnToSplashButton?.addEventListener("click", () => {
    sessionStorage.removeItem(APP_ENTERED_KEY);
    sessionStorage.removeItem(ACTIVE_VIEW_KEY);
    isLeavingSplash = false;
    document.body.classList.remove("has-entered", "is-entering", "has-splash-video-returned");
    showSplashHome({ replayIntro: true });
    enterButtons.forEach((button) => {
      button.disabled = false;
    });
    switchView("dashboard");
    sessionStorage.removeItem(ACTIVE_VIEW_KEY);
    updateSplashStats();
  });

  if (sessionStorage.getItem(APP_ENTERED_KEY) === "1") {
    isLeavingSplash = true;
    document.body.classList.add("has-entered");
    switchView(sessionStorage.getItem(ACTIVE_VIEW_KEY) || "dashboard");
    ensureStateLoaded().catch(showStateLoadError);
  }
}

initializeSplashScreen();
bindEvents();
Promise.allSettled([restoreAdminSession(), loadSplashSummary()]).then((results) => {
  updateAdminUi();
  if (results[1]?.status === "rejected") {
    updateSplashStats({ players: 0, matches: 0 });
  }
});
