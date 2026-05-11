let db = {
  players: [],
  matches: [],
  currentTeams: { radiant: [], dire: [] }
};

const POSITIONS = ["1", "2", "3", "4", "5"];
const HEROES = Array.isArray(window.DOTA_HEROES) ? window.DOTA_HEROES : [];
const HERO_IMAGE_BASE = "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes";
const ADMIN_PASSWORD_KEY = "dota-admin-password";
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

let isAdmin = Boolean(sessionStorage.getItem(ADMIN_PASSWORD_KEY));
let constraints = [];
let matchDetails = {};
let selectedMatchPlayerId = null;
let matchEntryTeams = { radiant: [], dire: [] };
let editingMatchId = null;
let recordSort = "rating";
let recordSortDirection = "desc";
let hasGeneratedTeams = false;
let playerById = new Map();
let statsByPlayerId = new Map();
let dataStatsByPlayerId = new Map();
let heroUsageByPlayerId = new Map();
let heroRankStats = [];
let pairRankStats = { teammate: [], opponent: [] };
let pendingExcelMatches = [];
let heroRankModes = {
  positive: "winrate",
  negative: "winrate"
};
let heroUsageSort = "total";
let pairRankModes = {
  bestFriends: "winrate",
  poorFriends: "winrate",
  stomp: "winrate"
};

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

function pairStatKey(a, b) {
  return [a, b].sort().join("::");
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
  const opponentStatsByKey = new Map();

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
    });

    (match.radiant || []).forEach((radiantId) => {
      (match.dire || []).forEach((direId) => {
        addOpponentPair(opponentStatsByKey, radiantId, direId, match.winner === "radiant");
        addOpponentPair(opponentStatsByKey, direId, radiantId, match.winner === "dire");
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
    opponent: finalizePairStats(opponentStatsByKey)
  };
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
      <span class="table-heading"><span>位置</span></span>
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

function getRecordSortIcon(key) {
  if (recordSort !== key) return "";
  return recordSortDirection === "desc" ? "▾" : "▴";
}

function renderBasicData() {
  renderDataTable("basicData", BASIC_DATA_COLUMNS, $("#basicDataBody"));
}

function renderAdvancedData() {
  renderDataTable("advancedData", ADVANCED_DATA_COLUMNS, $("#advancedDataBody"));
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
      key: "games",
      title: "热度榜",
      heroes: [...rankedHeroes].sort((a, b) => b.games - a.games || b.wins - a.wins || a.name.localeCompare(b.name, "zh-Hans")),
      value: (hero) => `${hero.games} 场`
    },
    {
      key: "singleHeat",
      title: "绝活榜",
      heroes: getSingleHeroHeatStats().sort((a, b) => b.count - a.count || a.playerName.localeCompare(b.playerName, "zh-Hans") || a.name.localeCompare(b.name, "zh-Hans")),
      record: (hero) => `${hero.wins}-${hero.count - hero.wins}`,
      value: (hero) => `（${hero.playerName}）${hero.count}场`
    }
  ];

  target.innerHTML = boards.map(renderHeroRankCard).join("");
}

function getSingleHeroHeatStats() {
  return getPlayersWithHeroUsage()
    .flatMap((player) => player.heroes.map((hero) => ({
      ...hero,
      playerName: player.name,
      count: hero.count
    })));
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
        <h3>${escapeHtml(board.title)}</h3>
        ${board.modes ? `
          <div class="rank-mode-control" aria-label="${escapeHtml(board.title)}排序方式">
            ${board.modes.map((item) => `
              <button class="${mode === item ? "is-active" : ""}" data-hero-rank="${board.key}" data-hero-mode="${item}" type="button">${getHeroModeLabel(item)}</button>
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

function getHeroModeLabel(mode) {
  return {
    winrate: "胜率",
    netWins: "净胜"
  }[mode] || mode;
}

function renderRelations() {
  const target = $("#pairRankGrid");
  if (!target) return;
  const teammatePairs = pairRankStats.teammate.filter((pair) => pair.games > 0);
  const opponentPairs = pairRankStats.opponent.filter((pair) => pair.games > 0);
  const boards = [
    {
      key: "bestFriends",
      title: "最佳挚友",
      pairs: sortPairs(teammatePairs, pairRankModes.bestFriends, getPairRankDirection("bestFriends", pairRankModes.bestFriends)),
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
      pairs: sortPairs(opponentPairs, pairRankModes.stomp, getPairRankDirection("stomp", pairRankModes.stomp)),
      type: "opponent",
      modes: ["games", "winrate", "netWins"],
      hideRecord: true,
      value: (pair, mode) => mode === "winrate" ? `${pair.wins}-${pair.losses}` : formatPairModeValue(pair, mode)
    }
  ];

  target.innerHTML = boards.map(renderPairRankCard).join("");
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
                <strong>${renderPairNames(pair, board.type)}</strong>
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

function renderPairNames(pair, type = "teammate") {
  if (type === "opponent") {
    return `${escapeHtml(getPlayer(pair.playerId)?.name || "-")} <span class="pair-vs-icon" aria-label="对阵" title="对阵"></span> ${escapeHtml(getPlayer(pair.opponentId)?.name || "-")}`;
  }
  return escapeHtml(formatPairNames(pair, type));
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

function renderMatches() {
  $("#matchesCountLabel").textContent = `${db.matches.length} 场`;
  renderMatchCards($("#matchesList"), db.matches);
}

function renderAdmin() {
  renderAdminPlayers();
  renderMatchEntryEditor();
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
          <input class="rating-input" data-rating-input="${player.id}" type="number" min="0" step="0.5" value="${formatRating(player.rating)}" />
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
    basicData: renderBasicData,
    advancedData: renderAdvancedData,
    heroes: renderHeroes,
    relations: renderRelations,
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
        const tens = Math.floor(count / 10);
        const ones = count % 10;
        const balls = [
          ...Array.from({ length: tens }, () => `<i class="position-dot position-dot-${position} position-dot-ten" title="${position}号位 10 次">10</i>`),
          ...Array.from({ length: ones }, () => `<i class="position-dot position-dot-${position}" title="${position}号位"></i>`)
        ].join("");
        return `
          <span class="position-zone" title="${position}号位 ${count} 次">
            <span class="position-balls">${balls}</span>
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
  switchView("data");
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

  db.currentTeams = await api("/api/teams", {
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
        <div class="table-wrap">
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

  $("#relations")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-pair-rank][data-pair-mode]");
    if (!button) return;
    pairRankModes[button.dataset.pairRank] = button.dataset.pairMode;
    renderRelations();
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

  ["#basicData", "#advancedData"].forEach((selector) => {
    $(selector)?.addEventListener("click", (event) => {
    const sortButton = event.target.closest("[data-data-sort]");
    const sortKey = sortButton?.dataset.dataSort;
    if (!sortKey) return;
    const viewId = event.currentTarget.id;
    const sortState = dataSortState[viewId];
    if (sortState.key === sortKey) {
      sortState.direction = sortState.direction === "desc" ? "asc" : "desc";
    } else {
      sortState.key = sortKey;
      sortState.direction = "desc";
    }
      viewId === "basicData" ? renderBasicData() : renderAdvancedData();
    });
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
