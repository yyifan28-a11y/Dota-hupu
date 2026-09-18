# 首页图制作与管理：任务交接

更新时间：2026-09-11。项目：E:/Coding/Codex Project/Dota。
旧任务：设计首页图管理流程（01a036ae-7449-7882-bc49-769a843c77e1）。

## 为什么换任务

旧任务在 Codex 重启后只显示到 2026-09-10 的草稿验证阶段。读取接口也停在轮次 01a08958-d6ff-7702-b9ea-9c33073dcf08，并返回 inProgress。原始记录中该轮有 task_started，未找到对应完成/中止事件；后续对话仍在同一 JSONL 中，逐行解析未发现格式错误。怀疑历史恢复/轮次边界异常，未确认内部原因，未修改原始会话文件。

原始记录：C:/Users/y_yif/.codex/sessions/2026/08/25/rollout-2026-08-25T10-09-57-01a036ae-7449-7882-bc49-769a843c77e1.jsonl。
这份交接是工作摘要，不是完整对话副本；若用户要求追溯细节，可只读提取该文件中的用户和最终回复，避免直接输出工具结果中的大段图片编码。

## 用户确定的产品流程

1. 用户发现好比赛，来对话制作该选手使用的英雄图，迭代到满意。
2. 助手提供可下载的成品文件。
3. 用户自己在线上网站管理页上传图片，选择比赛和本场选手。
4. 网站自动显示英雄、日期、K/D/A，用户预览后发布。
5. 首页左右按钮轮播，最多展示三张，第四张发布时归档旧图。

不要要求用户处理 assets 目录或填写路径；不要自行上传或发布艺术试稿。
用户允许图左字右、图右字左，也希望将来支持更自由的文字位置。当前只实现左右两种，自由排版未完成。
画面偏好：清晰英雄 + 有艺术感的背景点缀 + 大片黑暗留白；背景要自然、宽范围渐隐，不能产生明显左右分界。不要机械重复左右排版。兼顾高分屏全宽布局及下载性能。

## 网站当前进展

原生 Node HTTP + SQLite + 原生 HTML/CSS/JS，遵循 AGENTS.md。不是新项目，不要重新搭建。
首页图管理、数据库关联、上传等改动在 app.js、server.js、index.html、styles.css 中，尚未提交或部署线上。

- 管理页有新建草稿、编辑、预览、发布、归档和排序。
- 选已完整录入的比赛后，选本场选手，自动读取英雄和 K/D/A。
- 数据保存 matchRecordId / playerId，不仅靠名字或外部比赛 ID 匹配。
- 图片文件输入替换手填路径；保存时上传，编辑不选新图则保留旧图。
- 上传 POST /api/homepage-highlights/upload：管理员认证，静态 PNG/JPEG/WebP，最大 10 MB、4000 万像素；sharp 转为 quality 90 WebP，最长边 3840，不放大小图。
- 图片默认存放在 S3 数据库旁 uploads/highlights；可用 HIGHLIGHT_UPLOAD_DIR 指定。线上必须使用持久化存储，例如 /data/uploads/highlights。重启持久性已在临时数据库测试。
- 上传资源通过 /uploads/highlights/<uuid>.webp 读取，旧 assets 路径仍兼容。
- JSON 备份只含图片引用，迁移需要同时备份上传目录；归档不删除文件。
- DEPLOY.md 有相关部署说明；新增 sharp 依赖及 lockfile，.gitignore 忽略 uploads。
- scripts/check-highlight-upload.mjs 为独立副本集成测试，已通过鉴权、无效/超大图片拒绝、上传、关联草稿、重启保留测试。
- 浏览器曾实测旧草稿流程与新上传入口；不要声称整个线上发布流程已经验收。
- npm audit 报告现有 xlsx 高危问题，未在此任务中升级；新增 sharp 不是该告警来源。

实际展示数据仍是 xian 的 Puck、ldxy 的火猫两张。火猫画面用户已认可，不要再修改。
工作区还混有评分走势和榜单动画等修改，另一项“继续 Dota 项目开发”有相关历史；不能将所有未提交差异都当成本任务改动，不能贸然回退。
保护 SQLite、Excel、backups 和其他未跟踪文件。不要在正式库创建测试记录。

## 当前艺术任务：教练的邪影芳灵

比赛：2026-05-07 第三场（05-07-03），外部 ID 8801445758。
比赛记录 ID：8d906210-6b50-4946-9ee7-609361da16ab。
选手：教练，ID 97fee36d-22be-4c23-a896-ff16f7b2223a。
英雄：邪影芳灵 / Dark Willow；K/D/A 15 / 0 / 16，4 号位。

首版使用官方展示动画截帧 + AI 生成暗紫荆棘/幽光背景。用户认可模型形象，但觉得动作呆板。
用户明确要求保留官方模型正确性，同时自由控制动作，不接受 AI 重画英雄导致五官等错误；之前火猫反复发生错误，多次纠正。
因此本阶段用官方带骨骼 FBX，在 Blender 内调整骨骼与镜头，保留原网格和贴图。不要退回让 AI 整体重画英雄。

最新动作要求原话：我想让她身体前倾，头部占据较大比例，有一种冲向镜头的感觉。
已经做出 v2 并展示给用户，尚未得到认可或进一步修改意见。不要称 v2 已定稿。
v2：前倾躯干，抬头，一只手向前，另一只向后，近距离广角透视突出头部，身体/翅膀向后。当前光效/材质还可以细化。
用户提供的动作效果参考在 C:/Users/y_yif/AppData/Local/Temp/codex-clipboard-b1c213c7-2e23-433b-a06b-7af435329d71.png 是历史显示问题截图，不是动作参考。
真正动作参考：C:/Users/y_yif/AppData/Local/Temp/codex-clipboard-de26ca1d-cedf-4c0f-a441-012e0eb1f166.png（只参考动作和效果，不参考英雄造型）。

### 关键文件（相对项目根目录）

- output/highlights/dark-willow-jiaolian-2026-05-07-03-v1.webp：旧站立首版。
- output/highlights/dark-willow-jiaolian-2026-05-07-03-v2.webp：最新合成图，1536×1024，约 170 KB。
- output/highlights/dark-willow-rush-model-v2.png：v2 透明背景模型渲染。
- output/highlights/dark-willow-rush-scene.blend：可继续编辑的场景，贴图已打包。
- tmp/dark-willow-official/pose_render.py：摆姿势、材质、灯光、镜头及渲染脚本。
- tmp/dark-willow-official/compose_rush.mjs：将模型透明图叠到背景上，生成 v2。
- tmp/dark-willow-official/source/dark_willow_econ.fbx：官方模型，含骨骼。
- tmp/dark-willow-official/source/materials：官方贴图。
- tmp/dark-willow-official/imported.blend：初始导入场景。
- tmp/tools/blender-4.5.9-windows-x64/blender.exe：从 Blender 官方镜像取得的便携版，已可后台渲染；无需再次安装。
- 背景原图：C:/Users/y_yif/.codex/generated_images/01a036ae-7449-7882-bc49-769a843c77e1/exec-a7d4bf29-0875-4dbd-a112-ee91cdc3175a.png。

官方模型出处：https://www.dota2.com/workshop/requirements/dark_willow
资源包：https://media.steampowered.com/apps/dota2/workshop/dark_willow.zip

## 下一项任务如何继续

先读项目 AGENTS.md 和本文件，检查关键文件存在；查看 v2 图片后，等待/处理用户关于动作和构图的具体意见。当前重点是艺术图，不要顺手改网站其它部分。
如果要求修改姿态，复用 .blend 或脚本，另存版本，避免覆盖唯一已有成品。直接展示成品图，不要只给背景或下载链接。
如果用户要上线，则另行核实部署目标和持久化磁盘，不得假设此前已部署。
本地网站按 AGENTS.md 检查 3000 服务，需要启动时用隐藏窗口。

## 新艺术任务：白给的斧王（091703）

记录时间：2026-09-18。当前状态：v1 候选已完成并展示前待用户审阅；不是用户确认的定稿，也未上传、未发布、未修改首页代码。

比赛与选手信息：

- 比赛：2026-09-17 第三场（09-17-03 / 用户简称 091703），外部比赛 ID 9003243930。
- 比赛记录 ID：acbbd4e3-3c71-48fb-b0e3-df76a9bbe2e5。
- 选手：白给，ID 4e555b3c-cb83-461f-ba68-ffadbaf9f821。
- 英雄：斧王 / Axe；K/D/A 26 / 5 / 12，3 号位，夜魇获胜。

制作方向与已完成内容：

- 使用 Valve 官方斧王 Workshop FBX、默认武器和贴图，不对英雄本体做 AI 重画。
- 动作为淘汰之刃下劈前的蓄力：躯干扭转、右臂高举武器、左臂向前下方压住重心；镜头给英雄右侧主体与左侧暗区。
- 背景由内置 imagegen 单独生成，只含暗红战场烟尘、远景残旗、火星和黑色渐隐；没有让生成模型修改英雄层。
- 已检查桌面、超宽屏和手机裁切。桌面/超宽屏左侧保留大块暗区；手机以约 78% 横向焦点可同时保留脸、斧刃和抬臂动作。
- 100% 细节检查时，官方脸型、眼睛、发型、盔甲、武器和可见手部结构清楚，没有发现额外/缺失肢体或明显透明边缘。
- 网站版 1920×1080 WebP 约 145 KB，低于当前 10 MB 上传限制，不会带来可感知的首页加载压力。

关键文件（相对项目根目录）：

- output/highlights/axe-baigei-2026-09-17-03-art-v1-master.png：2560×1440 高质量合成母版，约 4.97 MB。
- output/highlights/axe-baigei-2026-09-17-03-art-v1.webp：1920×1080 网站上传版，约 145 KB。
- output/highlights/axe-baigei-2026-09-17-03-model-v3.png：官方模型透明渲染层。
- output/highlights/axe-baigei-2026-09-17-03-scene-v3.blend：当前可继续修改的 Blender 场景，贴图已打包。
- output/highlights/axe-battlefield-bg-v1.png：单独保存的暗红战场背景层。
- output/highlights/axe-baigei-2026-09-17-03-check-desktop.webp、check-ultrawide.webp、check-mobile.webp、check-detail.webp：裁切和细节检查图。
- tmp/axe-official/render_pose_v3.py：当前姿态、镜头、材质与灯光脚本。
- tmp/axe-official/compose_axe_v1.mjs：背景、模型、前景烟尘与火星合成脚本。
- tmp/axe-official/source/axe_econ.fbx：Valve 官方带骨骼模型；官方页面 https://www.dota2.com/workshop/requirements/axe 。

如果用户要求调整，优先从 scene-v3.blend 或 render_pose_v3.py 继续，并另存 v2/v4 等新版本。当前最值得根据反馈调整的项目是动作张力、斧头在左侧暗区中的占比，以及背景红光强度；不要整体 AI 重画斧王。
