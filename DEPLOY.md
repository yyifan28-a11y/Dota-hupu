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

如果没有配置 `DATABASE_PATH=/data/dota.db` 和 Volume，云端重启或重新部署后数据可能丢失。
