# service-deck — DSH 本地服务控制台

统一的本地服务管理方案：**任何项目类型的启动命令归一化 + 全局 registry 防端口冲突 + DSH 界面一键启动/停止/重启 + agent 工具双通道 + 自动跟随会话自动登记**。

解决痛点：每个项目启动命令不一样、agent 靠猜命令给出错误信息、多个服务互相端口冲突、人工启动要记路径和命令、每次切换项目都要手动探测登记。

## 现状

| 组成 | 形态 | 状态 |
|---|---|---|
| 插件（Host + Client） | **持久化 profile bundle**：`~/.dsh/profiles/web` 的 `dsh.profile.bundles` 里有 `service-deck`，link 到本仓库 `packages/service-deck/` | ✅ DSH 每次启动自动加载 |
| SKILL.md | `~/.agents/skills/service-deck/SKILL.md` | ✅ 已安装，本仓库 `skill/` 有副本 |
| registry / 日志 | `~/.dsh/service-registry.json`、`~/.dsh/services/logs/` | 持久，跨重启保留 |

## 目录结构

```
.
├── README.md                    ← 本文件
├── packages/service-deck/       ← ★ 持久化插件包（被 profile link 安装）
│   ├── package.json             ←   dsh.bundle.patch + dsh.client 配置
│   ├── cordis.patch.yml         ←   bundle 行声明（- insert: id/name）
│   └── lib/
│       ├── index.js             ←   Host：registry/进程/端口仲裁/探测/自动跟随/HTTP RPC/tools
│       └── client.js            ←   Client：侧边栏按钮 + 悬浮面板（ModuleLoader factory + fetch RPC）
├── plugin/                      ← 动态插件备选载荷（无 profile 环境时用 cordis_define 粘贴）
│   ├── host.js
│   └── client.js
├── skill/SKILL.md               ← agent 行为规范（与已安装副本一致）
└── .dsh-services.yml.example    ← 项目内配置示例
```

## 安装 / 更新（持久化）

```bash
# 安装（已执行）
dsh plugin --profile web add link:/Users/zhichao/DSH/dsh-launch-pad/packages/service-deck

# 源码改动后重装（link 安装改源码即可，无需重装；改 package.json 结构才需重跑）
# 然后重启 DSH 生效
```

`dsh plugin add` 会自动把包名写入 `~/.dsh/profiles/web/package.json` 的 dependencies 和 `dsh.profile.bundles`。验证装载：`dsh --profile web --dump-config | grep -A2 service-deck`。

## 功能

- **命令归一化探测**：`.dsh-services.yml`（权威）> package.json（dev>start>serve，自动识别 npm/pnpm/yarn/bun）> docker-compose.yml > Makefile > justfile > manage.py/pyproject.toml（django/fastapi/flask）> go.mod
- **全局 registry**：`~/.dsh/service-registry.json`，跨所有项目共享，同 (projectPath, name) upsert
- **端口仲裁**：启动前 lsof 检查真实占用；`portMode=auto` 冲突时自动分配最近空闲端口并按模板注入（`--port N` / `PORT=N` / uvicorn / next / flask / django 专用写法）；`portMode=fixed` 冲突报错
- **生命周期**：python3 setsid 独立会话 detached 启动，日志 append 落盘，DSH 重启后存活（persist=false 则随 DSH 停止）；停止 = 三路目标（stored pid + 端口监听者 + 递归子进程）TERM → 3s 超时 SIGKILL；禁止双开
- **双通道操作**：UI 面板（当前项目/全部标签、状态点、实际端口、启停重启按钮、可展开日志）+ 7 个 agent 工具（`service_list/detect/register/start/stop/restart/status`）
- **自动跟随会话**：面板读取浏览器里当前选中的会话（`useSessions` 钩子的 `state.current`），每 3 秒上报 Host 解析为项目目录——**点选即跟随，无需打字**，且不受后台会话事件洪流干扰；`agent/created` 与 `user/message` 事件仅作面板未打开时的兜底
- **自动登记**：跟随到的新项目若无登记服务，Host 自动探测并登记候选（60s 节流防抖），面板提示"已自动登记: …"
- **日志**：`~/.dsh/services/logs/<id>.log`，面板展开可见滚动尾部

## Registry 格式

```json
{
  "version": 1,
  "services": [
    {
      "id": "myapp:web",          // basename(projectPath):name，冲突自动加 -2
      "name": "web",
      "projectPath": "/abs/path",
      "command": "npm run dev",
      "cwd": ".",
      "port": 5173,               // 期望端口
      "portMode": "auto",         // auto | fixed
      "persist": true,
      "template": "npm",          // npm|uvicorn|django|flask|docker|make|just|go|custom
      "env": {},
      "pid": 12345,               // 运行时字段
      "actualPort": 5173,
      "startedAt": 1720000000000
    }
  ]
}
```

## 项目内配置 .dsh-services.yml

```yaml
services:
  web:
    command: npm run dev
    cwd: .
    port: 5173
    portMode: auto
    persist: true
    template: npm
    env:
      FOO: bar
```

## 通信架构（持久化插件版）

- **Client → Host**：`POST /service-deck/rpc`，header 带 per-process 随机 token（Host 通过 `webServer.tapIndex` 注入 `window.__DSH_SERVICE_DECK_TOKEN__`，与 dsh-archive-panel 同款 loopback 守卫）
- **Client 挂载**：`window.__ModuleLoader__.load({ id: 'service-deck', factory })` 工厂格式，`require('react')`，注入 `['slots','timer']`
- **Host 工具**：`ctx.tools.register`，parameters 为原始 JSON Schema 子集（`type/properties/required/additionalProperties/items/enum/const + description/title/default/examples` 注释键；**`type:'json'` 在原始 schema 中非法**，宽松输出用空对象 `{}`）
- **自动跟随信号**：客户端 `useSessions((state) => state.current)` 选中的会话 id（最高优先级，随每次 list 轮询上报）；兜底为 `agent/created` 与 `user/message` 事件（面板未打开时）

## 开发中踩过并已修复的坑（重要经验）

1. **spawn 挂起**：后台进程继承 shell 执行器的 stdin 管道导致 `shell.run` 永不返回 → spawn 配方必须加 `< /dev/null`（实测返回 0.002s）
2. **组杀漏进程**：macOS 下 `nohup cmd &` 的 `$!`（外层 bash 子壳）与实际服务进程分属不同进程组，`kill -TERM -$!` 杀不净 → 停止改为「stored pid + 端口监听者 + 递归 pgrep -P 子进程」三路目标
3. **shell.overlay 里 useWorkspaces 钩子崩溃**：SnapshotSelectorHook 必须传 selector（`useWorkspaces((s) => ...)`）；shell.overlay 无 hook 上下文 → 钩子改在 sidebar.footer.action 的 Trigger 里调用，经模块级状态共享给面板
4. **动态插件沙箱与真实插件的差异**：`harness.handle/defineTool` 是沙箱专用；真实插件用 `ctx.webServer.register` + token 路由和 `ctx.tools.register`（原始 JSON Schema，`type:'json'` 非法，宽松 schema 用 `{}`）
5. **`shell.run` 的 stdout/stderr** 是 `{text, truncated}` 结构，取 `.text`
6. **事件驱动的跟随会被后台会话劫持**：`session/event` 的 `assistant/chunk` 洪流 + 后台会话注入的 `user/message` 会让"最后事件赢"永远落在噪声会话上 → 改为客户端上报 UI 选中的会话 id（`state.current`），事件只作兜底；`session/event` 事件参数里混有 Scoped 包装体，读 `.header` 会扑空，需按 id 查 `sessions` 存储取真实 Session

## 已知限制

- 跟随以界面选中的会话为准；无浏览器面板时退化到"最后一条用户消息"的会话
- docker 端口不自动重写（冲突报错）；`${变量}` 形式的 compose 端口解析为 null
- 没有标准 dev/start/serve 脚本的项目（如 monorepo 的 `pnpm --filter apps/web dev`）需手写 `.dsh-services.yml` 或让 agent 用 `service_register` 登记
- 冷门框架端口注入退化为 `PORT` 环境变量，个别工具不认时需把 `--port` 写进 command
- 依赖 `python3`（setsid 包装）、`lsof`、`pgrep`（macOS/Linux 均有）；Windows 未适配

## Roadmap

1. ~~持久化安装（profile bundle）~~ ✅
2. ~~自动跟随会话~~ ✅
3. ~~面板跟随界面选中的会话（state.current 客户端信号）~~ ✅
4. monorepo（pnpm workspaces）探测
5. Windows 支持
6. 发布到 dsh-market（需脱离 private/本地路径依赖）
