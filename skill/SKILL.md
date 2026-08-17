---
name: service-deck
description: 本地服务控制台 Skill。当用户问某个项目"怎么启动/怎么跑起来"、要启动/停止/重启服务、问服务端口/进程/日志，或需要登记新项目的服务时使用。核心原则：所有服务操作一律走 service_* 工具和统一本地 registry，绝不凭记忆手写启动命令；需要人工启动时给出归一化的路径+命令+端口+日志位置。
---

# service-deck 服务控制台

配套 DSH 插件 **service-deck**（已持久化安装进 `~/.dsh/profiles/web` 的 bundle，DSH 每次启动自动加载，源码在 `~/DSH/dsh-launch-pad/packages/service-deck`）：侧边栏底部「服务」按钮 + 悬浮面板（启动/停止/重启按钮组、当前项目/全部标签、可展开日志、自动跟随会话）+ `service_*` agent 工具。本 skill 定义 agent 侧行为规范。

## 架构速览

- **registry（全局唯一真源）**：`~/.dsh/service-registry.json`，跨所有项目共享，负责防端口冲突
- **日志**：`~/.dsh/services/logs/<id>.log`（每个服务一个文件，append 落盘）
- **项目内配置（人可编辑，优先级最高）**：`<project>/.dsh-services.yml`
  ```yaml
  services:
    web:
      command: npm run dev
      cwd: .
      port: 5173        # 期望端口；启动时被占用则自动换空闲端口（portMode=auto）
      portMode: auto    # auto: 冲突自动分配并注入；fixed: 冲突报错
      persist: true     # DSH 重启后继续存活
      env:
        FOO: bar
  ```
- **面板**：侧边栏底部「服务」按钮打开；每行状态点 + 实际端口 + 启动/停止/重启 + 日志展开；顶部「当前项目 / 全部」标签
- **自动跟随**：面板读取界面当前选中的会话（useSessions 的 state.current）并上报 Host，点选即跟随，无需手动选工作区；agent/created 与 user/message 事件仅作面板未打开时的兜底
- **自动登记**：跟随到的新项目若还没有登记服务，插件自动探测并登记候选（面板提示"已自动登记: …"），不再需要人工点探测/登记

## 触发场景

- 用户问"这个项目怎么启动/怎么跑起来"、"启动一下 xx"、"停止/重启 xx 服务"
- 用户问服务端口、日志在哪、进程状态
- 新项目需要登记服务、或启动命令变了需要更新
- 用户抱怨端口冲突（面板/工具会自动仲裁，先查再答）

## 黄金规则

1. **绝不凭记忆手写启动命令**。先 `service_status` / `service_list` 查；没有登记 → `service_detect` 探测 → `service_register` 登记（多数项目已被自动登记，直接查即可）。
2. **需要人工启动时给全信息**：`cd <cwd>`、`<command>`、端口（用实际端口）、日志路径、pid。内容从 `service_status` 输出原样转述，不要自己猜。
3. **registry 是唯一真源**：项目启动命令变了 → `service_register` 更新（同 (projectPath, name) 自动 upsert），不要只在聊天里口头修正。
4. **不要用 bash 直接 nohup/pm2/& 启动 dev server**：绕过 registry 会导致端口仲裁失效、面板状态失真。一律 `service_start`。
5. 停止/重启后向用户说明端口已释放、pid 已清。
6. docker 服务由插件调 `docker compose up -d / stop`，端口不重写（冲突报错），不要手工 `docker compose up` 同项目。

## 工具速查

| 工具 | 参数 | 用途 |
|---|---|---|
| `service_list` | 无 | 全部登记服务 + 实时状态/实际端口/pid/路径；找 id 用 |
| `service_detect` | `projectPath`(绝对路径，可选，默认当前会话项目) | 扫描项目，输出归一化候选（命令/期望端口/模板） |
| `service_register` | `projectPath`, `name`, `command`, 可选 `cwd/port/portMode/persist/template/env` | 登记/更新，不启动 |
| `service_start` | `id` | 后台启动；返回实际端口与 pid；冲突自动换端口注入 |
| `service_stop` | `id` | SIGTERM 进程组 → 3s 超时 SIGKILL |
| `service_restart` | `id` | 停止后重启（重新做端口仲裁） |
| `service_status` | `id`(可选) | 单个或全部实时状态 |

## 探测优先级（service_detect）

1. `.dsh-services.yml`（权威，人可编辑）
2. `package.json` scripts：`dev` > `start` > `serve`，自动识别 npm/pnpm/yarn/bun；脚本含 vite/next/astro/nuxt/wds 时猜默认端口
3. `docker-compose.yml` / `compose.yaml`：解析第一个 `HOST:CONTAINER` 端口映射
4. `Makefile`：`dev` > `run` > `serve` > `start` target
5. `justfile`：同上
6. Python：`manage.py` → `python3 manage.py runserver` (8000)；`pyproject.toml` 含 fastapi/uvicorn → `uvicorn main:app --reload` (8000)，含 flask → `flask run` (5000)
7. Go：`go.mod` → `go run .`

## 端口仲裁规则

- 每个服务登记一个**期望端口**；每次启动前用 lsof 检查真实占用
- `portMode=auto`（默认）：期望端口被占 → 从该端口向上找最近空闲端口 → 按模板注入：`--port N` 改写、`PORT=N` 前缀改写、uvicorn/flask/next/runserver 的专用写法、其他一律 `PORT=N` 环境变量前缀
- `portMode=fixed`：被占 → 报错不启动（docker 默认此模式）
- 面板上绿色 `:实际端口` 即当前真实可访问端口

## 生命周期语义

- `persist=true`（默认）：python3 setsid 独立会话 detached 启动，日志 append 落盘，DSH 重启后服务继续存活
- `persist=false`：DSH/插件停止时自动杀掉
- **禁止双开**：已运行再 start 报错（先 stop 或 restart）
- 停止语义：三路目标（stored pid + 端口监听者 + 递归子进程）TERM → 轮询 3s → KILL

## 回答模板

用户问"这个项目怎么启动"：
1. `service_status` 查 id（没有 → `service_detect` → 登记）
2. 输出：路径 `cd <cwd>`、命令 `<command>`、端口（实际端口）、日志 `<logFile>`、状态
3. 主动提议："我可以直接帮你启动" → `service_start`

## 实现形态与已知限制

- 插件已持久化安装（profile bundle），DSH 重启后自动恢复；registry、日志、已启动服务均跨重启保留
- 插件源码：`~/DSH/dsh-launch-pad/packages/service-deck/`；改完源码 `dsh plugin --profile web add link:<路径>` 重装后重启 DSH 生效
- 动态插件备选载荷：`~/DSH/dsh-launch-pad/plugin/{host,client}.js`（用于无法装包的环境，随 DSH 重启消失）
- docker 端口不自动重写；冷门框架的端口注入退化为 `PORT` 环境变量，个别工具不认时改用 `--port` 写入 `.dsh-services.yml` 的 command
- 无浏览器面板时跟随退化为"最后一条用户消息"的会话
- 依赖 `python3`（setsid 包装）、`lsof`、`pgrep`（macOS/Linux 均有）
