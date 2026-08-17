// =============================================================================
// service-deck · Host 端（code.host 载荷）
// 用法：把本文件全文作为 cordis_define 的 code.host 传入即可（无需修改）。
// 若插件已在运行，用 kind:"existing" 追加新 Package 后 cordis_run update。
// =============================================================================
return {
  inject: ['shell', 'fs'],
  async apply(ctx) {
    const shell = ctx.shell
    const fs = ctx.fs

    /* ---------- shell helpers ---------- */
    const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'"
    async function sh(command, opts) {
      opts = opts || {}
      const spec = shell.resolve({
        command: command,
        workdir: opts.workdir,
        timeoutMs: opts.timeoutMs || 30000,
        stdoutMaxBytes: opts.stdoutMaxBytes || 262144,
      })
      const res = await shell.run(spec)
      return {
        code: res.exitCode,
        signal: res.signal,
        out: (res.stdout && res.stdout.text ? res.stdout.text : '').trim(),
        err: (res.stderr && res.stderr.text ? res.stderr.text : '').trim(),
      }
    }

    /* ---------- base dirs ---------- */
    let DSH_DIR = ''
    try {
      const r = await sh("printf '%s\\n%s' \"$HOME\" \"${DSH_HOME:-}\"", { timeoutMs: 10000 })
      const lines = r.out.split('\n')
      const home = (lines[0] || '').trim()
      const custom = (lines[1] || '').trim()
      DSH_DIR = custom.startsWith('/') ? custom : (home.startsWith('/') ? home + '/.dsh' : '')
    } catch (e) {
      console.error('service-deck: home lookup failed', String(e))
    }
    if (!DSH_DIR) {
      console.error('service-deck: cannot resolve DSH_DIR; plugin inert')
      return
    }
    const REGISTRY_PATH = DSH_DIR + '/service-registry.json'
    const LOGS_DIR = DSH_DIR + '/services/logs'
    try {
      await sh('mkdir -p ' + q(DSH_DIR) + ' ' + q(LOGS_DIR), { timeoutMs: 10000 })
    } catch (e) {
      console.error('service-deck: mkdir failed', String(e))
    }

    /* ---------- registry ---------- */
    let registry = { version: 1, services: [] }
    async function loadRegistry() {
      try {
        const target = await fs.resolve(REGISTRY_PATH)
        const text = await fs.readText(target)
        const parsed = JSON.parse(text)
        if (parsed && Array.isArray(parsed.services)) registry = parsed
      } catch (e) { /* absent or corrupt -> start fresh */ }
    }
    async function saveRegistry() {
      try {
        const target = await fs.resolve(REGISTRY_PATH)
        await fs.writeText(target, JSON.stringify(registry, null, 2))
      } catch (e) {
        console.error('service-deck: registry save failed', String(e))
      }
    }
    await loadRegistry()

    /* ---------- process / port primitives ---------- */
    async function isAlive(pid) {
      if (!pid) return false
      const r = await sh('kill -0 ' + Number(pid) + ' 2>/dev/null && echo yes || echo no', { timeoutMs: 8000 })
      return r.out === 'yes'
    }
    async function portListeners(port) {
      if (!port) return []
      const r = await sh('lsof -nP -iTCP:' + Number(port) + ' -sTCP:LISTEN -t 2>/dev/null', { timeoutMs: 8000 })
      return r.out ? r.out.split('\n').filter(Boolean).map(Number) : []
    }
    async function aliveFor(svc) {
      if (svc.pid && await isAlive(svc.pid)) return true
      const port = svc.actualPort || svc.port || null
      if (port) {
        const ls = await portListeners(port)
        if (ls.length) return true
      }
      return false
    }
    async function busyPortSet() {
      const set = new Set()
      const r = await sh('lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null', { timeoutMs: 15000, stdoutMaxBytes: 1048576 })
      if (!r.out) return set
      for (const line of r.out.split('\n')) {
        const m = line.match(/:(\d{1,5})\s*(?:\(LISTEN\))?\s*$/)
        if (m) set.add(Number(m[1]))
      }
      return set
    }
    function findFreePort(from, busy) {
      let p = Number(from) || 3000
      for (let i = 0; i < 200; i++) {
        if (!busy.has(p)) return p
        p += 1
      }
      return null
    }
    function injectPort(command, port) {
      const p = String(port)
      if (/--port\s+\d+/.test(command)) return command.replace(/--port\s+\d+/, '--port ' + p)
      if (/--port=\d+/.test(command)) return command.replace(/--port=\d+/, '--port=' + p)
      if (/^\s*PORT=\d+\s+/.test(command)) return command.replace(/PORT=\d+/, 'PORT=' + p)
      if (/(^|\s)uvicorn\b/.test(command) && !/--port/.test(command)) return command + ' --port ' + p
      if (/\bnext dev\b/.test(command) && !/\s-p\s/.test(command)) return command + ' -p ' + p
      if (/\bflask run\b/.test(command)) {
        if (/--port\s+\d+/.test(command)) return command.replace(/--port\s+\d+/, '--port ' + p)
        return command + ' --port ' + p
      }
      if (/\brunserver\b/.test(command)) {
        if (/runserver\s+\S*:?\d+/.test(command)) return command.replace(/(runserver\s+\S*:?)\d+/, '$1' + p)
        return command.replace(/runserver/, 'runserver 0.0.0.0:' + p)
      }
      return 'PORT=' + p + ' ' + command
    }
    function svcDir(svc) {
      const base = svc.projectPath || ''
      const cwd = svc.cwd || '.'
      if (cwd.startsWith('/')) return cwd
      return (base + '/' + cwd).replace(/\/+/g, '/')
    }
    function view(svc, running) {
      return {
        id: svc.id,
        name: svc.name,
        project: String(svc.projectPath || '').split('/').pop() || '',
        projectPath: svc.projectPath || '',
        command: svc.command || '',
        port: svc.port || null,
        actualPort: svc.actualPort || null,
        template: svc.template || 'custom',
        persist: svc.persist !== false,
        portMode: svc.portMode || 'auto',
        running: !!running,
        pid: svc.pid || null,
      }
    }
    function findService(id) {
      return registry.services.find((s) => s.id === id) || null
    }
    function makeId(projectPath, name) {
      const base = String(projectPath).split('/').pop().replace(/[^\w.-]+/g, '-') + ':' + String(name).replace(/[^\w.-]+/g, '-')
      let id = base
      let n = 2
      while (registry.services.some((s) => s.id === id)) { id = base + '-' + n; n += 1 }
      return id
    }
    function upsert(candidate, projectPath) {
      let svc = registry.services.find((s) => s.projectPath === projectPath && s.name === candidate.name)
      const fields = {
        name: String(candidate.name || ''),
        projectPath: projectPath,
        command: String(candidate.command || ''),
        cwd: candidate.cwd || '.',
        port: candidate.port ? Number(candidate.port) : null,
        portMode: candidate.portMode || 'auto',
        persist: candidate.persist !== false,
        template: candidate.template || 'custom',
        env: candidate.env && typeof candidate.env === 'object' ? candidate.env : {},
      }
      if (svc) {
        Object.assign(svc, fields)
      } else {
        svc = Object.assign({ id: makeId(projectPath, fields.name) }, fields, { pid: null, actualPort: null, startedAt: null })
        registry.services.push(svc)
      }
      return svc
    }

    /* ---------- docker helpers ---------- */
    async function dockerRunning(svc) {
      const r = await sh('docker compose ps --services --filter status=running 2>/dev/null', { workdir: svcDir(svc), timeoutMs: 20000 })
      return r.out.split('\n').filter(Boolean).length > 0
    }
    async function startDocker(svc) {
      if (await dockerRunning(svc)) return { ok: false, error: 'already running' }
      if (svc.port) {
        const busy = await busyPortSet()
        if (busy.has(svc.port)) return { ok: false, error: 'port ' + svc.port + ' is already in use; docker ports are not auto-rewritten (portMode=fixed)' }
      }
      const r = await sh('docker compose up -d', { workdir: svcDir(svc), timeoutMs: 120000, stdoutMaxBytes: 262144 })
      if (r.code !== 0) return { ok: false, error: String(r.err || r.out || 'compose up failed').slice(0, 2000) }
      svc.actualPort = svc.port || null
      svc.startedAt = Date.now()
      await saveRegistry()
      return { ok: true, started: true, port: svc.port || null }
    }
    async function stopDocker(svc) {
      const r = await sh('docker compose stop 2>&1', { workdir: svcDir(svc), timeoutMs: 120000, stdoutMaxBytes: 262144 })
      svc.pid = null; svc.actualPort = null; svc.startedAt = null
      await saveRegistry()
      return { ok: true, stopped: true, note: String(r.out || '').slice(0, 500) }
    }

    /* ---------- lifecycle ---------- */
    const managedPids = new Set()
    async function startService(svc) {
      if (svc.template === 'docker') return startDocker(svc)
      if (await aliveFor(svc)) return { ok: false, error: 'already running' }
      let actualPort = svc.port || null
      let injected = false
      if (actualPort) {
        const busy = await busyPortSet()
        if (busy.has(actualPort)) {
          if (svc.portMode === 'fixed') return { ok: false, error: 'port ' + actualPort + ' is already in use (portMode=fixed); stop the other service or change the port' }
          const free = findFreePort(actualPort, busy)
          if (free === null) return { ok: false, error: 'no free port found near ' + actualPort }
          actualPort = free
          injected = true
        }
      }
      let command = svc.command
      if (injected) command = injectPort(command, actualPort)
      let envPrefix = ''
      const envObj = svc.env || {}
      for (const k in envObj) envPrefix += k + '=' + q(String(envObj[k])) + ' '
      const safeId = String(svc.id).replace(/[^\w.-]+/g, '_')
      const logFile = LOGS_DIR + '/' + safeId + '.log'
      const py = "python3 -c 'import os,sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])'"
      const inner = envPrefix + command
      const cmdline = 'cd ' + q(svcDir(svc)) + ' && nohup ' + py + ' sh -c ' + q(inner) + ' >> ' + q(logFile) + ' 2>&1 < /dev/null & echo $!'
      const r = await sh(cmdline, { timeoutMs: 20000 })
      const pid = parseInt(r.out, 10)
      if (!pid) return { ok: false, error: 'spawn failed: ' + String(r.err || r.out || 'no pid').slice(0, 2000) }
      svc.pid = pid
      svc.actualPort = actualPort
      svc.startedAt = Date.now()
      if (svc.persist === false) managedPids.add(pid)
      await saveRegistry()
      return { ok: true, started: true, pid: pid, port: actualPort, injected: injected, logFile: logFile }
    }
    async function stopService(svc) {
      if (svc.template === 'docker') return stopDocker(svc)
      const pid = svc.pid
      if (!pid) return { ok: true, note: 'not running' }
      const port = svc.actualPort || svc.port || null
      const targets = new Set()
      targets.add(Number(pid))
      if (port) {
        for (const t of await portListeners(port)) targets.add(t)
      }
      let frontier = [Number(pid)]
      for (let depth = 0; depth < 3; depth++) {
        const kids = []
        for (const f of frontier) {
          const r = await sh('pgrep -P ' + f + ' 2>/dev/null', { timeoutMs: 8000 })
          for (const k of r.out.split('\n').filter(Boolean)) {
            const n = Number(k)
            if (!targets.has(n)) { targets.add(n); kids.push(n) }
          }
        }
        if (kids.length === 0) break
        frontier = kids
      }
      const sig = async (s) => {
        for (const t of targets) await sh('kill -' + s + ' -' + t + ' 2>/dev/null; kill -' + s + ' ' + t + ' 2>/dev/null || true', { timeoutMs: 8000 })
      }
      await sig('TERM')
      const aliveCmd = port
        ? 'kill -0 ' + pid + ' 2>/dev/null || lsof -nP -iTCP:' + Number(port) + ' -sTCP:LISTEN -t 2>/dev/null | grep -q .'
        : 'kill -0 ' + pid + ' 2>/dev/null'
      await sh('for i in $(seq 1 15); do ' + aliveCmd + ' || exit 0; sleep 0.2; done; kill -KILL -' + pid + ' 2>/dev/null || true; kill -KILL ' + pid + ' 2>/dev/null || true' + (port ? '; LP=$(lsof -nP -iTCP:' + Number(port) + ' -sTCP:LISTEN -t 2>/dev/null); [ -z "$LP" ] || kill -KILL $LP 2>/dev/null || true' : ''), { timeoutMs: 12000 })
      svc.pid = null; svc.actualPort = null; svc.startedAt = null
      await saveRegistry()
      return { ok: true, stopped: true, pid: pid }
    }
    async function listServices() {
      const views = []
      let changed = false
      for (const svc of registry.services) {
        let running = false
        if (svc.template === 'docker') {
          running = await dockerRunning(svc)
        } else {
          running = await aliveFor(svc)
          if (!running && (svc.pid || svc.actualPort)) { svc.pid = null; svc.actualPort = null; svc.startedAt = null; changed = true }
        }
        views.push(view(svc, running))
      }
      if (changed) await saveRegistry()
      return views
    }
    async function readLogs(id, lines) {
      const svc = registry.services.find((s) => s.id === id)
      if (!svc) return { ok: false, error: 'not found: ' + id }
      const safeId = String(svc.id).replace(/[^\w.-]+/g, '_')
      const file = LOGS_DIR + '/' + safeId + '.log'
      const n = Math.max(1, Math.min(Number(lines) || 60, 300))
      const r = await sh('tail -n ' + n + ' ' + q(file) + ' 2>/dev/null', { timeoutMs: 10000, stdoutMaxBytes: 131072 })
      return { ok: true, log: r.out || '', file: file }
    }
    async function listWorkspaces() {
      const wr = ctx.get('workspaceRegistry')
      if (!wr) return []
      try {
        const list = await wr.list()
        return list
          .map((w) => ({ path: String(w.path || ''), title: String(w.title || '') }))
          .filter((w) => w.path)
          .sort((a, b) => String(b.path).localeCompare(String(a.path)))
      } catch (e) {
        console.error('service-deck: workspace list failed', String(e))
        return []
      }
    }

    /* ---------- detection ---------- */
    async function readFile(p) {
      try {
        const t = await fs.resolve(p)
        return await fs.readText(t)
      } catch (e) { return null }
    }
    function parseJsonSafe(text) {
      try { return JSON.parse(text) } catch (e) { return null }
    }
    function stripQuotes(s) {
      s = (s || '').trim()
      if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1)
      return s
    }
    function guessPort(script) {
      if (!script) return null
      if (/vite/i.test(script)) return 5173
      if (/\bnext\b/i.test(script)) return 3000
      if (/astro/i.test(script)) return 4321
      if (/nuxt/i.test(script)) return 3000
      if (/webpack-dev-server|\bwds\b/i.test(script)) return 8080
      const m = script.match(/--port[= ](\d{2,5})/)
      if (m) return parseInt(m[1], 10)
      return null
    }
    function parseDshServicesYml(text) {
      const out = { services: [] }
      if (!text) return out
      let cur = null
      let inEnv = false
      for (const raw of text.split('\n')) {
        const line = raw.replace(/#.*$/, '')
        if (!line.trim()) continue
        const indent = (line.match(/^\s*/) || [''])[0].length
        const m = line.match(/^\s*([A-Za-z0-9_.-]+)\s*:\s*(.*)$/)
        if (!m) continue
        const key = m[1]
        const val = stripQuotes(m[2])
        if (indent === 0) { cur = null; inEnv = false; continue }
        if (!cur) {
          cur = val ? { name: key, command: val } : { name: key }
          inEnv = false
          out.services.push(cur)
          continue
        }
        if (key === 'env' && !val) { if (!cur.env) cur.env = {}; inEnv = true; continue }
        if (inEnv && indent >= 6) { cur.env[key] = val; continue }
        inEnv = false
        if (key === 'command') cur.command = val
        else if (key === 'cwd') cur.cwd = val
        else if (key === 'port') { const n = parseInt(val, 10); cur.port = isNaN(n) ? null : n }
        else if (key === 'portMode' || key === 'port_mode') cur.portMode = val
        else if (key === 'persist') cur.persist = !/^(false|no|0)$/i.test(val)
        else if (key === 'template') cur.template = val
      }
      return out
    }
    async function lsNames(dir) {
      const r = await sh('ls -A', { workdir: dir, timeoutMs: 10000 })
      if (r.code !== 0 && !r.out) return null
      return r.out ? r.out.split('\n').filter(Boolean) : []
    }
    async function detectNpm(projectPath, names) {
      if (!names.includes('package.json')) return null
      const pkg = parseJsonSafe(await readFile(projectPath + '/package.json'))
      if (!pkg || !pkg.scripts || typeof pkg.scripts !== 'object') return null
      const key = ['dev', 'start', 'serve'].find((k) => typeof pkg.scripts[k] === 'string')
      if (!key) return null
      let pm = 'npm'
      const pmg = String(pkg.packageManager || '')
      if (/^pnpm@/.test(pmg)) pm = 'pnpm'
      else if (/^yarn@/.test(pmg)) pm = 'yarn'
      else if (/^bun@/.test(pmg)) pm = 'bun'
      else if (names.includes('pnpm-lock.yaml')) pm = 'pnpm'
      else if (names.includes('yarn.lock')) pm = 'yarn'
      else if (names.includes('bun.lockb') || names.includes('bun.lock')) pm = 'bun'
      const script = String(pkg.scripts[key])
      return { name: key, command: pm + ' run ' + key, port: guessPort(script), template: 'npm', persist: true, portMode: 'auto', source: 'package.json' }
    }
    async function detectDocker(projectPath, names) {
      const f = names.find((n) => ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'].includes(n))
      if (!f) return null
      const text = await readFile(projectPath + '/' + f)
      let port = null
      if (text) {
        const m = text.match(/^\s*-\s*"?(\d{2,5})\s*:\s*\d{2,5}"?\s*$/m)
        if (m) port = Number(m[1])
      }
      return { name: 'compose', command: 'docker compose up', port: port, template: 'docker', persist: true, portMode: 'fixed', source: f }
    }
    function parseTargets(text) {
      const targets = {}
      let cur = null
      if (!text) return targets
      for (const line of text.split('\n')) {
        const m = line.match(/^([A-Za-z0-9_.-]+)\s*:/)
        if (m) { cur = m[1]; targets[cur] = '' }
        else if (cur && line.indexOf('\t') === 0) targets[cur] += '\n' + line
      }
      return targets
    }
    async function detectMake(projectPath, names) {
      const f = names.includes('Makefile') ? 'Makefile' : (names.includes('makefile') ? 'makefile' : null)
      if (!f) return null
      const targets = parseTargets(await readFile(projectPath + '/' + f))
      const key = ['dev', 'run', 'serve', 'start'].find((k) => targets[k])
      if (!key) return null
      return { name: key, command: 'make ' + key, port: guessPort(targets[key] || ''), template: 'make', persist: true, portMode: 'auto', source: f }
    }
    async function detectJust(projectPath, names) {
      const f = names.includes('justfile') ? 'justfile' : (names.includes('.justfile') ? '.justfile' : null)
      if (!f) return null
      const targets = parseTargets(await readFile(projectPath + '/' + f))
      const key = ['dev', 'run', 'serve', 'start'].find((k) => targets[k])
      if (!key) return null
      return { name: key, command: 'just ' + key, port: guessPort(targets[key] || ''), template: 'just', persist: true, portMode: 'auto', source: f }
    }
    async function detectPython(projectPath, names) {
      if (names.includes('manage.py')) {
        return { name: 'django', command: 'python3 manage.py runserver', port: 8000, template: 'django', persist: true, portMode: 'auto', source: 'manage.py' }
      }
      if (names.includes('pyproject.toml')) {
        const text = await readFile(projectPath + '/pyproject.toml')
        if (text && /\b(fastapi|uvicorn)\b/.test(text)) {
          const app = names.includes('app.py') ? 'app:app' : 'main:app'
          return { name: 'api', command: 'uvicorn ' + app + ' --reload', port: 8000, template: 'uvicorn', persist: true, portMode: 'auto', source: 'pyproject.toml' }
        }
        if (text && /\bflask\b/.test(text)) {
          return { name: 'flask', command: 'flask run', port: 5000, template: 'flask', persist: true, portMode: 'auto', source: 'pyproject.toml' }
        }
      }
      return null
    }
    async function detectGo(projectPath, names) {
      if (!names.includes('go.mod')) return null
      return { name: 'go', command: 'go run .', port: null, template: 'go', persist: true, portMode: 'auto', source: 'go.mod' }
    }
    async function detectProject(projectPath) {
      if (!projectPath) return { ok: false, error: 'projectPath is required' }
      const names = await lsNames(projectPath)
      if (names === null) return { ok: false, error: 'cannot list directory: ' + projectPath }
      const cands = []
      const seen = {}
      const add = (c) => {
        if (c && c.command && !seen[c.name]) { seen[c.name] = true; cands.push(c) }
      }
      const cfgName = names.includes('.dsh-services.yml') ? '.dsh-services.yml' : (names.includes('.dsh-services.yaml') ? '.dsh-services.yaml' : null)
      if (cfgName) {
        const parsed = parseDshServicesYml(await readFile(projectPath + '/' + cfgName))
        for (const cs of parsed.services || []) {
          if (cs && cs.name && cs.command) {
            add({ name: cs.name, command: cs.command, cwd: cs.cwd || '.', port: cs.port || null, portMode: cs.portMode || 'auto', persist: cs.persist !== false, template: cs.template || 'custom', env: cs.env || {}, source: cfgName })
          }
        }
      }
      add(await detectNpm(projectPath, names))
      add(await detectDocker(projectPath, names))
      add(await detectMake(projectPath, names))
      add(await detectJust(projectPath, names))
      add(await detectPython(projectPath, names))
      add(await detectGo(projectPath, names))
      const registeredIds = registry.services.filter((s) => s.projectPath === projectPath).map((s) => s.id)
      return { ok: true, projectPath: projectPath, candidates: cands, registeredIds: registeredIds }
    }

    /* ---------- client RPC ---------- */
    const handleDisposers = []
    handleDisposers.push(harness.handle('list', async () => ({ ok: true, services: await listServices() })))
    handleDisposers.push(harness.handle('workspaces', async () => ({ ok: true, workspaces: await listWorkspaces() })))
    handleDisposers.push(harness.handle('detect', async (args) => detectProject(String((args && args.projectPath) || ''))))
    handleDisposers.push(harness.handle('register', async (args) => {
      const a = args || {}
      const cand = a.candidate || a
      const projectPath = String(a.projectPath || (cand && cand.projectPath) || '')
      if (!projectPath || !cand || !cand.name || !cand.command) return { ok: false, error: 'projectPath/name/command required' }
      const svc = upsert(Object.assign({}, cand, { projectPath: projectPath }), projectPath)
      await saveRegistry()
      return { ok: true, registered: view(svc, false) }
    }))
    handleDisposers.push(harness.handle('start', async (args) => {
      const svc = findService(args && args.id)
      if (!svc) return { ok: false, error: 'service not found: ' + String((args && args.id) || '') }
      const r = await startService(svc)
      return r.ok ? Object.assign({}, r, { service: view(svc, true) }) : r
    }))
    handleDisposers.push(harness.handle('stop', async (args) => {
      const svc = findService(args && args.id)
      if (!svc) return { ok: false, error: 'service not found: ' + String((args && args.id) || '') }
      const r = await stopService(svc)
      return r.ok ? Object.assign({}, r, { service: view(svc, false) }) : r
    }))
    handleDisposers.push(harness.handle('restart', async (args) => {
      const svc = findService(args && args.id)
      if (!svc) return { ok: false, error: 'service not found: ' + String((args && args.id) || '') }
      const s = await stopService(svc)
      if (s.ok === false) return s
      const r = await startService(svc)
      return r.ok ? Object.assign({}, r, { restarted: true, service: view(svc, true) }) : r
    }))
    handleDisposers.push(harness.handle('logs', async (args) => readLogs(args && args.id, args && args.lines)))
    handleDisposers.push(harness.handle('remove', async (args) => {
      const i = registry.services.findIndex((s) => s.id === (args && args.id))
      if (i < 0) return { ok: false, error: 'service not found' }
      const svc = registry.services[i]
      if (await aliveFor(svc)) return { ok: false, error: 'service is running; stop it first' }
      registry.services.splice(i, 1)
      await saveRegistry()
      return { ok: true, removed: true }
    }))

    /* ---------- model tools ---------- */
    const renderJson = (args, value) => [{ type: 'text', text: '```json\n' + JSON.stringify(value, null, 2) + '\n```' }]
    const toolDisposers = []
    function regTool(def) {
      const t = harness.defineTool(def)
      toolDisposers.push(harness.registerTool(ctx, t))
    }
    regTool({
      name: 'service_list',
      description: 'List all registered local services (dev servers, backends, docker compose stacks) from the shared service registry (~/.dsh/service-registry.json), with live running status, actual ports, pids and project paths. Use this to find a service id before service_start/stop/restart, or to answer the user where and how each project service runs.',
      parameters: {},
      output: { schema: { type: 'json' }, render: renderJson },
      async execute() {
        return { ok: true, services: await listServices(), registry: REGISTRY_PATH }
      },
    })
    regTool({
      name: 'service_detect',
      description: 'Scan a project directory and normalize how to run its services: reads .dsh-services.yml (authoritative, human-editable) plus package.json scripts (dev/start/serve with package-manager detection), docker-compose.yml, Makefile, justfile, manage.py/pyproject.toml (django/fastapi/flask), and go.mod. Returns candidate services with normalized commands and expected ports, ready for service_register.',
      parameters: {
        projectPath: { type: 'string', description: 'Absolute path of the project directory to scan', required: true },
      },
      output: { schema: { type: 'json' }, render: renderJson },
      async execute(args) {
        return detectProject(String((args && args.projectPath) || ''))
      },
    })
    regTool({
      name: 'service_register',
      description: 'Register or update a service in the shared local registry (~/.dsh/service-registry.json). The same (projectPath, name) pair updates in place. Pass a candidate from service_detect or describe the service manually. Does NOT start the service.',
      parameters: {
        projectPath: { type: 'string', description: 'Absolute path of the project directory', required: true },
        name: { type: 'string', description: 'Short service name, unique per project', required: true },
        command: { type: 'string', description: 'Normalized start command, e.g. "npm run dev" or "uvicorn main:app"', required: true },
        cwd: { type: 'string', description: 'Subdirectory relative to projectPath to run the command in (default ".")' },
        port: { type: 'integer', description: 'Expected port. When occupied at start time an adjacent free port is allocated and injected (unless portMode=fixed)' },
        portMode: { type: 'string', description: '"auto" (default): allocate a free port and inject on conflict; "fixed": fail if the port is taken' },
        persist: { type: 'boolean', description: 'Keep running after DSH restarts (default true)' },
        template: { type: 'string', description: 'Optional hint: npm|uvicorn|django|flask|docker|make|just|go|custom' },
        env: { type: 'json', description: 'Extra environment variables for the process' },
      },
      output: { schema: { type: 'json' }, render: renderJson },
      async execute(args) {
        const a = args || {}
        if (!a.projectPath || !a.name || !a.command) return { ok: false, error: 'projectPath, name, command are required' }
        const svc = upsert({ name: a.name, command: a.command, cwd: a.cwd, port: a.port, portMode: a.portMode, persist: a.persist, template: a.template, env: a.env }, String(a.projectPath))
        await saveRegistry()
        return { ok: true, registered: view(svc, false), registry: REGISTRY_PATH }
      },
    })
    regTool({
      name: 'service_start',
      description: 'Start one registered service as a detached background process (logs at ~/.dsh/services/logs/<id>.log, survive DSH restarts unless persist=false). Resolves port conflicts: if the registered port is occupied and portMode=auto, allocates the nearest free port and injects it into the command. Returns the actual port and pid. Prefer this tool over manually running the start command so the registry stays accurate.',
      parameters: {
        id: { type: 'string', description: 'Service id from service_list (e.g. "myapp:web")', required: true },
      },
      output: { schema: { type: 'json' }, render: renderJson },
      async execute(args) {
        const svc = findService(args && args.id)
        if (!svc) return { ok: false, error: 'service not found: ' + String((args && args.id) || '') + ' — run service_list first' }
        const r = await startService(svc)
        return r.ok ? Object.assign({}, r, { service: view(svc, true) }) : r
      },
    })
    regTool({
      name: 'service_stop',
      description: 'Stop one registered service: SIGTERM to the whole process group, escalating to SIGKILL after ~3s. Clears the pid in the registry.',
      parameters: {
        id: { type: 'string', description: 'Service id from service_list', required: true },
      },
      output: { schema: { type: 'json' }, render: renderJson },
      async execute(args) {
        const svc = findService(args && args.id)
        if (!svc) return { ok: false, error: 'service not found: ' + String((args && args.id) || '') + ' — run service_list first' }
        const r = await stopService(svc)
        return r.ok ? Object.assign({}, r, { service: view(svc, false) }) : r
      },
    })
    regTool({
      name: 'service_restart',
      description: 'Restart one registered service (stop then start; port conflict re-resolution applies on start).',
      parameters: {
        id: { type: 'string', description: 'Service id from service_list', required: true },
      },
      output: { schema: { type: 'json' }, render: renderJson },
      async execute(args) {
        const svc = findService(args && args.id)
        if (!svc) return { ok: false, error: 'service not found: ' + String((args && args.id) || '') + ' — run service_list first' }
        const s = await stopService(svc)
        if (s.ok === false) return s
        const r = await startService(svc)
        return r.ok ? Object.assign({}, r, { restarted: true, service: view(svc, true) }) : r
      },
    })
    regTool({
      name: 'service_status',
      description: 'Report live status of one service (by id) or all services: running/stopped, pid, registered vs actual port, project path, and the normalized start command. Use it to answer the user about how a service is started or where its port/log is.',
      parameters: {
        id: { type: 'string', description: 'Optional service id; omit to report all services' },
      },
      output: { schema: { type: 'json' }, render: renderJson },
      async execute(args) {
        const id = args && args.id
        if (id) {
          const svc = findService(id)
          if (!svc) return { ok: false, error: 'service not found: ' + String(id) + ' — run service_list first' }
          let running = false
          if (svc.template === 'docker') running = await dockerRunning(svc)
          else running = await aliveFor(svc)
          return { ok: true, service: view(svc, running) }
        }
        return { ok: true, services: await listServices() }
      },
    })

    /* ---------- dispose ---------- */
    ctx.effect(() => () => {
      for (const d of handleDisposers) { try { d() } catch (e) {} }
      for (const d of toolDisposers) { try { d() } catch (e) {} }
      for (const pid of managedPids) {
        sh('kill -TERM -' + pid + ' 2>/dev/null || true; kill -TERM ' + pid + ' 2>/dev/null || true; sleep 0.5; kill -KILL -' + pid + ' 2>/dev/null || true; kill -KILL ' + pid + ' 2>/dev/null || true', { timeoutMs: 4000 }).catch(() => {})
      }
    })
  },
}
