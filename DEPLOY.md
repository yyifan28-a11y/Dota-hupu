# 部署说明

推荐先用 Railway 部署这个项目，并给 SQLite 数据库配置持久化 Volume。

## 上线前准备

1. 确认代码已经上传到 GitHub。
2. 不要上传本地的 `dota.db`、日志和 `backups/`，这些已经写进 `.gitignore`。
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

5. 启动命令使用：

```text
npm start
```

Railway 通常会自动识别 `package.json`，不需要额外配置端口。服务会读取平台提供的 `PORT` 环境变量。

## 本地运行

```bash
npm start
```

默认本地数据库路径是项目目录下的 `dota.db`。如需测试云端路径行为，可以这样运行：

```powershell
$env:DATABASE_PATH="E:\Coding\Codex Project\Dota\data\dota.db"; $env:ADMIN_PASSWORD="admin123"; npm start
```

## 注意

如果没有配置 `DATABASE_PATH=/data/dota.db` 和 Volume，云端重启或重新部署后数据可能丢失。
