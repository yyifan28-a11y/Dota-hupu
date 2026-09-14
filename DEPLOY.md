# 部署说明

推荐先用 Railway 部署这个项目，并给 SQLite 数据库配置持久化 Volume。

## 上线前准备

1. 确认代码已经上传到 GitHub。
2. 不要上传本地的 `dota.db`、`dota-s3.db`、日志和 `backups/`，这些已经写进 `.gitignore`。
3. 上线后如果要迁移本地数据，先在本地页面导出 JSON，再到线上页面进入管理员模式后导入。

## Railway 配置

1. 在 Railway 新建项目，选择从 GitHub 仓库部署。
2. 添加一个 Volume。
3. 将 Volume 挂载路径设置为：

```text
/data
```

4. 设置环境变量：

```text
DATABASE_PATH=/data/dota.db
ADMIN_PASSWORD=你的管理员密码
```

`DATABASE_PATH` 继续指向线上原有的 S2 数据库，因此更新代码时无需迁移或改名。新版服务会自动：

- 将 `DATABASE_PATH` / `SQLITE_PATH` 识别为 S2 数据库；
- 在同目录读取或创建 `dota-s3.db` 作为 S3 数据库；
- 让 S2 使用新版 UI 只读展示；
- 让 S3 保持可管理、可录入。

如需明确指定两个文件，也可以设置：

```text
S2_DATABASE_PATH=/data/dota.db
S3_DATABASE_PATH=/data/dota-s3.db
```

显式的 `S2_DATABASE_PATH`、`S3_DATABASE_PATH` 优先于默认推导。

5. 启动命令使用：

```text
npm start
```

Railway 通常会自动识别 `package.json`，不需要额外配置端口。服务会读取平台提供的 `PORT` 环境变量。

## 本地运行

```bash
npm start
```

默认本地 S2、S3 数据库分别是项目目录下的 `dota.db`、`dota-s3.db`。如需测试云端路径行为，可以这样运行：

```powershell
$env:DATABASE_PATH="E:\Coding\Codex Project\Dota-S3-Redesign\data\dota.db"; $env:ADMIN_PASSWORD="admin123"; npm start
```

## 注意

## 首页图片上传

管理员可在首页图管理中直接选择 PNG、JPG 或 WebP（最大 10 MB），保存草稿时上传。服务端验证图片并转为质量 90 的 WebP，最长边限制为 3840 像素，不放大小图。现有 assets 图片仍兼容。

上传目录默认是 S3 数据库所在目录下的 `uploads/highlights`。例如 `S3_DATABASE_PATH=/data/dota-s3.db` 时，图片保存在 `/data/uploads/highlights`，和 SQLite 共用 `/data` 持久化 Volume。也可以设置 `HIGHLIGHT_UPLOAD_DIR` 指向其他持久化目录。不要指向随部署替换的临时文件系统。

部署新版后需要安装依赖（`npm ci`）并重启服务。JSON 数据备份只包含图片引用，不包含上传的二进制图片；迁移、备份时需同时保存上传目录。归档不会删除图片，取消或替换上传也不会自动清理旧文件，避免破坏仍被引用的图片。

如果没有配置 `DATABASE_PATH=/data/dota.db` 和 Volume，云端重启或重新部署后数据可能丢失。
