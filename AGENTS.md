# AGENTS.md

## 项目概览

这是一个 Dota2 虎扑内战记录工具，当前形态是单页前端 + Node.js 原生 HTTP 服务 + SQLite 数据库。

主要用途：

- 维护内战选手、评分、战绩和评分走势。
- 生成 5v5 天辉/夜魇对阵，支持位置、历史组合、随机、胜率等平衡偏好。
- 录入和查看比赛，包括比分、胜方、阵容、位置、英雄、个人数据。
- 统计战绩、基础/高阶数据、英雄使用、单场纪录、队友/对手关系。
- 从 Excel 预览和导入比赛数据、评分历史。

## 技术栈

- 运行时：Node.js，要求 `>=24.0.0`，`.nvmrc` 当前为 `24`。
- 后端：`node:http` 原生服务，没有 Express。
- 数据库：Node 内置 `node:sqlite` 的 `DatabaseSync`，默认数据库文件为 `dota.db`。
- 前端：原生 HTML/CSS/JavaScript，无构建步骤。
- Excel：`xlsx` npm 包。
- 静态资源：`index.html`、`styles.css`、`app.js`、`heroes.js` 由后端直接服务。

## 运行方式

在项目根目录运行：

```bash
npm start
```

默认访问地址：

```text
http://localhost:3000/
```

常用环境变量：

- `PORT`：服务端口，默认 `3000`。
- `ADMIN_PASSWORD`：管理员密码，默认 `admin123`。
- `DATABASE_PATH` 或 `SQLITE_PATH`：SQLite 文件路径，默认项目根目录下的 `dota.db`。

Windows 本地快捷启动文件：

- `启动.bat`：进入固定项目路径并运行 `node server.js`。

线上部署参考：

- `DEPLOY.md` 记录了 Railway/Volume 相关部署思路。
- `服务器指令.txt` 记录了服务器拉取代码、安装依赖、重启 pm2 的命令片段。

## 主要文件

- `server.js`：后端入口，负责静态文件、API、SQLite 初始化/迁移、组队算法、Excel 解析和导入。
- `app.js`：前端主逻辑，负责状态加载、页面渲染、交互事件、统计计算、比赛详情弹窗、组队器、Excel 预览等。
- `styles.css`：全部页面样式。近期对“纪录”卡片、表格 hover、字体和卡片动画做过较多调整。
- `index.html`：单页应用骨架，包含侧边导航、各视图容器、弹窗和管理区域。
- `heroes.js`：Dota 英雄数据，前端和部分脚本用于英雄名称匹配、头像 URL 生成。
- `dota.db`：本地 SQLite 数据库，不应随意删除或覆盖。
- `backups/`：备份目录。
- `记录/`：Excel、图片等原始记录材料。
- `scripts/seed-demo.js`：向数据库插入演示选手和比赛。
- `scripts/add-random-matches.js`：随机生成比赛数据。
- `scripts/fill-match-heroes.js`：用 `heroes.js` 给历史比赛补齐/修正英雄信息。

## 数据库结构

`server.js` 启动时会自动创建/补齐以下表：

- `players`
  - `id`
  - `name`
  - `steam_id`
  - `rating`
  - `rating_updated_at`
  - `note`
  - `created_at`

- `matches`
  - `id`
  - `date`
  - `match_no`
  - `match_id`
  - `winner`：`radiant` 或 `dire`
  - `score`：例如 `32-47 / 51:45`
  - `note`
  - `radiant`：JSON 字符串，选手 id 数组
  - `dire`：JSON 字符串，选手 id 数组
  - `positions`：JSON 字符串，选手 id 到 1-5 号位的映射
  - `player_details`：JSON 字符串，个人英雄和数据
  - `created_at`

- `app_state`
  - 保存 `currentTeams` 等应用状态。

- `rating_snapshots`
  - 按日期保存选手评分历史，用于评分走势。

注意：

- `matches.radiant`、`matches.dire`、`matches.positions`、`matches.player_details` 在数据库里是 JSON 字符串，API 返回时会解析为对象/数组。
- 完整比赛判定依赖 `hasBasicMatchInfo` 和 `hasCompletePlayerDetails`。统计中很多逻辑会跳过草稿或不完整比赛。

## 后端 API

公开接口：

- `GET /api/state`：读取完整前端状态。
- `POST /api/teams`：生成并保存 5v5 阵容。这个接口不要求管理员密码。
- `POST /api/teams/manual`：手动保存当前阵容。这个接口不要求管理员密码。

管理员接口需要请求头：

```text
x-admin-password: <管理员密码>
```

主要管理员接口：

- `POST /api/admin/check`
- `POST /api/players`
- `PUT /api/players/:id/rating`
- `DELETE /api/players/:id`
- `POST /api/matches`
- `PUT /api/matches/:id`
- `DELETE /api/matches/:id`
- `POST /api/import`
- `POST /api/excel/preview`
- `POST /api/excel/import`
- `POST /api/rating-history/preview`
- `POST /api/rating-history/import`
- `POST /api/reset`

## 前端页面

侧边栏通过 `.nav-tab[data-view]` 切换视图，`switchView` 会激活对应 `.view` 并调用 `renderCurrentView`。

主要视图：

- `dashboard`：总览，显示比赛场次、选手数量、评分榜、参赛榜、胜率榜、净胜榜和最近比赛。
- `players`：战绩页，表格 id 为 `playersBody`，使用 `record-table` 样式，可按评分、胜负、场次、位置倾向排序。
- `data`：数据页，表格 id 为 `dataViewTable`/`dataViewBody`，使用 `rankings-table` 样式，可切换基础数据/高阶数据。
- `heroes`：英雄页，包含英雄排行榜和选手英雄使用统计。
- `records`：纪录页，展示单场最高击杀、死亡、助攻、输出、GPM、XPM、参战率、建筑伤害、KDA、10 分钟经济、承伤、最长/最短比赛、总人头等。
- `relations`：队友/对手页，支持指定选手组合查询，并显示关系排行榜。
- `ratingTrends`：评分走势页，SVG 折线图，支持选手勾选、全选/清空。
- `generator`：对阵生成器，选择 10 名选手，设置预设约束和平衡模式，生成并复制对阵图。
- `admin`：管理页，包含选手管理、比赛录入/编辑、Excel 导入、评分历史导入、清空/导入数据等。

## 重要前端状态

`app.js` 顶部维护了较多全局状态：

- `db`：从 `/api/state` 拉取的主状态。
- `isAdmin`：管理员模式，依赖 `sessionStorage` 中的 `dota-admin-password`。
- `recordSort` / `recordSortDirection`：战绩页排序。
- `dataSortState`：数据页排序。
- `recordCardActiveRanks`：纪录页每张卡当前展开第几名。
- `activeDataViewMode`：数据页基础/高阶切换。
- `heroRankModes`、`heroUsageSort`、`pairRankModes`：英雄/关系页排序模式。
- `ratingTrendSelectedIds`、`ratingTrendHasUserSelection`：评分走势勾选状态。
- `TEAM_GENERATION_COOLDOWN_KEY`：组队器 cooldown 存在 `localStorage`。

## 组队逻辑

后端 `generateTeams` 会先枚举 10 人中所有 5v5 组合，再过滤：

1. 必须满足“同队/对手”预设约束。
2. 双方评分总和差值必须小于等于 1。
3. 根据模式选择最优组合：
   - `position`：减少同队常用位置重复。
   - `combination`：减少历史同队组合重复。
   - `random`：从有效组合中随机。
   - `winrate`：尽量接近双方平均胜率。

## Excel 导入

依赖 `xlsx` 包。

比赛导入：

- 前端调用 `/api/excel/preview` 预览。
- 后端 `parseExcelMatches` 遍历 workbook sheet。
- sheet 需要能识别阵营、选手、英雄等列。
- 预览结果会提示缺失选手、重复、导入错误等。
- 确认后调用 `/api/excel/import` 写入数据库。

评分历史导入：

- 前端调用 `/api/rating-history/preview`。
- 后端 `parseRatingHistoryExcel` 识别“选手”列和日期列。
- 导入后会写入 `rating_snapshots`，并把每个选手最新日期评分同步到 `players.rating`。

## 当前 UI/样式约定

全局布局：

- 左侧固定侧边栏，右侧主内容区域。
- 主要样式都在 `styles.css`，没有 CSS 模块或预处理器。

纪录卡片：

- 由 `renderRecords`、`renderRecordCard`、`renderRecordRankPanel` 生成。
- 每个纪录卡最多展示前三名。
- 当前实现使用 flex 展开动画，而不是 grid 列宽。
- 鼠标移入第二/第三名后会保持该名次展开，不会在鼠标移开后自动回到第一名。
- 左键点击任意名次卡片会打开对应比赛详情。
- 英雄背景展开时不再盖半透明遮罩，收缩态仍有暗遮罩。
- 标题字体当前设置为 `"Alimama ShuHeiTi Bold"`，回退到 `"Alimama ShuHeiTi"`、`Microsoft YaHei` 等。
- 选手 ID 中含小写英文时会加 `record-player-id-lowercase`，字号比中文/全大写 ID 更大，弥补小写 x-height 偏小的问题。

战绩/数据表格：

- `record-table tbody tr` 和 `rankings-table tbody tr` 有同行 hover 效果。
- 数据页首列 sticky，需要单独处理 hover 背景。

## 开发注意事项

### 本地服务器自动启动

- 每次在新的对话或恢复的对话中继续处理本项目时，先检查 `http://localhost:3000/` 是否可访问。
- 如果本地服务器未运行，则无需等待用户提醒，直接在项目根目录后台执行 `npm start`，Windows 下使用隐藏窗口启动。
- 启动后等待 `http://localhost:3000/api/state` 可访问，再继续需要页面或 API 的开发、检查与浏览器验证。
- 如果端口被其他程序占用、启动失败或健康检查未通过，立即向用户说明；不要反复启动多个服务进程。
- 仅在用户明确要求停止服务器时停止，不要在普通任务结束时自动关闭。

- 不需要构建，改完静态文件后刷新浏览器即可。
- 修改 `app.js` 后建议运行：

```bash
node --check app.js
```

- 修改 `server.js` 后建议运行：

```bash
node --check server.js
```

- 若要实际验证页面，启动 `npm start` 并打开 `http://localhost:3000/`。
- 不要随意删除或覆盖 `dota.db`，这是当前本地数据源。
- `README.md`、`DEPLOY.md` 和部分脚本在当前环境显示有乱码；需要判断业务含义时优先读 `server.js`、`app.js`、`index.html` 的实际逻辑。
- 项目已有 `node_modules/`，但新环境仍应使用 `npm install`。
- 前端是原生 JS，大量功能通过事件委托绑定在页面容器上；新增交互时优先沿用现有 `data-*` 属性和事件委托模式。
- 后端没有路由框架，新增 API 时直接在 `handleApi` 中追加分支，并注意管理员权限校验。
- 数据库存 JSON 字段时保持 API 返回格式兼容，避免前端统计函数断裂。

## Git/工作区提醒

- 当前工作区可能存在未跟踪的 Excel、图片、备份和数据库相关文件。
- `dota.db`、日志、备份、Excel 原始记录通常属于本地数据，不要在不明确用户意图时清理或重置。
- 若要提交代码，先确认是否只包含目标改动，避免把本地数据文件一起纳入提交。

## 性能影响提醒

- 后续任何可能造成明显读取变慢、首屏加载延迟、滚动或交互卡顿、动画掉帧、内存占用显著增加的修改，必须主动向用户说明性能风险。
- 性能风险应尽量在实施前提醒；如果只有实现或验证后才能判断，则必须在交付时明确说明。
- 如果没有主动提醒性能风险，用户可以默认该项修改不会造成可感知的网页变慢或卡顿。
- 设计与实现时优先避免不必要的大量 DOM、重复统计计算、频繁重绘、超大静态资源、无节制的模糊/滤镜和阻塞式数据读取。
