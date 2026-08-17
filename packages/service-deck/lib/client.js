// service-deck — browser half (profile bundle plugin).
// Bundle format mirrors the shipped dsh-client-ui-* packages:
// window.__ModuleLoader__.load({ id, factory }) with the package name as id.
// - inject: ["slots", "timer"]
// - host RPC over the guarded HTTP endpoint POST /service-deck/rpc with the
//   per-process token injected by the host half (window.__DSH_SERVICE_DECK_TOKEN__)
// - 自动跟随：host 的 list 返回 current（当前活跃会话的 cwd），面板直接跟随，
//   无需手动选工作区；空工作区自动探测并登记由 host 完成。
window.__ModuleLoader__.load({
  id: 'dsh-service-deck',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    let react = require('react')

    const inject = ['slots', 'timer']

    // ---- host RPC over the guarded HTTP endpoint ----
    function callHost(method, args) {
      const token = typeof window !== 'undefined' && window.__DSH_SERVICE_DECK_TOKEN__
        ? window.__DSH_SERVICE_DECK_TOKEN__
        : ''
      return fetch('/service-deck/rpc', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-service-deck-token': token,
        },
        body: JSON.stringify({ method: method, args: args || {} }),
      }).then((res) => {
        if (!res.ok) throw new Error('HTTP ' + res.status)
        return res.json()
      }).then((data) => {
        if (!data || data.ok !== true) throw new Error((data && data.error) || 'request failed')
        return data
      })
    }

    // ---- package styles ----
    const style = document.createElement('style')
    style.textContent = `
.svc-trigger{display:inline-flex;align-items:center;gap:6px;cursor:pointer;background:transparent;border:none;color:var(--dsw-alias-label-secondary,#999);font:inherit;padding:6px 10px;border-radius:6px;white-space:nowrap;}
.svc-trigger:hover,.svc-trigger.is-open{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.15));color:var(--dsw-alias-label-primary,#eee);}
.svc-trigger-dot{width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 6px rgba(34,197,94,.8);flex:none;}
.svc-trigger-on .svc-trigger-dot{background:#eab308;box-shadow:0 0 6px rgba(234,179,8,.8);}
.svc-panel{position:fixed;right:16px;top:64px;width:356px;max-width:calc(100vw - 32px);max-height:76vh;display:flex;flex-direction:column;gap:8px;padding:10px;background:var(--dsw-alias-bg-overlay,rgba(23,25,30,.97));border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.16));border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,.5);pointer-events:auto;z-index:9999;font-size:12.5px;line-height:1.45;color:var(--dsw-alias-label-primary,#e7e9ee);font-family:inherit;}
.svc-head{display:flex;flex-direction:column;gap:6px;}
.svc-title-row{display:flex;align-items:center;gap:8px;}
.svc-title{font-weight:650;font-size:13.5px;flex:1;}
.svc-count{color:var(--dsw-alias-label-secondary,#9ca3af);font-size:11.5px;}
.svc-close{cursor:pointer;background:transparent;border:none;color:var(--dsw-alias-label-secondary,#9ca3af);font-size:13px;padding:2px 6px;border-radius:6px;}
.svc-close:hover{background:rgba(255,255,255,.1);color:var(--dsw-alias-label-primary,#e7e9ee);}
.svc-tabs{display:flex;gap:6px;align-items:center;}
.svc-tab,.svc-detect-btn{cursor:pointer;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.05));border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));color:var(--dsw-alias-label-secondary,#c9ced6);border-radius:999px;padding:3px 10px;font-size:11.5px;}
.svc-tab-on{background:rgba(96,165,250,.22);border-color:rgba(96,165,250,.55);color:var(--dsw-alias-label-primary,#dbeafe);}
.svc-detect-btn{margin-left:auto;}
.svc-detect-btn:disabled{opacity:.5;cursor:default;}
.svc-follow{color:var(--dsw-alias-label-secondary,#9ca3af);font-size:11.5px;margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px;}
.svc-note{background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.4);color:var(--dsw-alias-label-primary,#d1e7d6);border-radius:8px;padding:6px 8px;white-space:pre-wrap;word-break:break-word;}
.svc-error{background:rgba(239,68,68,.14);border:1px solid rgba(239,68,68,.45);color:var(--dsw-alias-state-error-primary,#fca5a5);border-radius:8px;padding:6px 8px;white-space:pre-wrap;word-break:break-word;}
.svc-detect{border:1px solid rgba(96,165,250,.35);background:rgba(96,165,250,.07);border-radius:10px;padding:8px;display:flex;flex-direction:column;gap:6px;max-height:220px;overflow:auto;}
.svc-detect-title{color:#93c5fd;font-size:11.5px;}
.svc-cand{display:flex;flex-direction:column;gap:3px;padding:5px 7px;background:rgba(0,0,0,.22);border-radius:8px;}
.svc-cand-main{display:flex;gap:6px;align-items:center;}
.svc-cand-name{font-weight:650;}
.svc-cand-port{color:#4ade80;font-size:11px;}
.svc-cand-src{color:var(--dsw-alias-label-secondary,#6b7280);font-size:10.5px;margin-left:auto;}
.svc-cand-cmd{color:var(--dsw-alias-label-secondary,#9ca3af);font-family:ui-monospace,Menlo,monospace;font-size:11px;word-break:break-all;}
.svc-btn-reg{align-self:flex-end;}
.svc-rows{display:flex;flex-direction:column;gap:7px;overflow:auto;}
.svc-row{border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.09));border-radius:10px;padding:7px 9px;display:flex;flex-direction:column;gap:7px;background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.02));}
.svc-row-head{display:flex;align-items:center;gap:8px;cursor:pointer;}
.svc-dot{width:8px;height:8px;border-radius:50%;flex:none;}
.svc-dot-on{background:#22c55e;box-shadow:0 0 6px rgba(34,197,94,.7);}
.svc-dot-off{background:var(--dsw-alias-label-secondary,#6b7280);}
.svc-row-meta{flex:1;min-width:0;}
.svc-row-name{font-weight:650;display:flex;gap:7px;align-items:baseline;}
.svc-port{color:#4ade80;font-size:11.5px;font-family:ui-monospace,Menlo,monospace;}
.svc-port-dim{color:var(--dsw-alias-label-secondary,#6b7280);}
.svc-row-sub{color:var(--dsw-alias-label-secondary,#9ca3af);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.svc-caret{color:var(--dsw-alias-label-secondary,#6b7280);flex:none;}
.svc-row-actions{display:flex;gap:6px;align-items:center;}
.svc-btn{cursor:pointer;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.18));background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#e7e9ee);border-radius:8px;padding:3px 9px;font-size:11.5px;}
.svc-btn:hover:not(:disabled){background:rgba(255,255,255,.14);}
.svc-btn:disabled{opacity:.5;cursor:default;}
.svc-btn-start{border-color:rgba(34,197,94,.6);color:#4ade80;}
.svc-btn-stop{border-color:rgba(239,68,68,.55);color:#f87171;}
.svc-btn-restart{border-color:rgba(234,179,8,.5);color:#facc15;}
.svc-btn-remove{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);}
.svc-btn-remove-confirm{border-color:rgba(239,68,68,.8);color:#f87171;}
.svc-busy{color:var(--dsw-alias-label-secondary,#9ca3af);font-size:11px;}
.svc-log{background:rgba(0,0,0,.38);border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:8px;padding:7px;max-height:190px;overflow:auto;white-space:pre-wrap;word-break:break-all;font-family:ui-monospace,Menlo,monospace;font-size:10.8px;color:#c9ced6;margin:0;}
.svc-empty{color:var(--dsw-alias-label-secondary,#6b7280);padding:12px 6px;text-align:center;font-size:11.5px;}
`
    document.head.appendChild(style)

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return

      // ---- shared open state between the footer entry and the panel ----
      const panelState = { open: false, listeners: new Set() }
      const setOpen = (open) => {
        if (panelState.open === open) return
        panelState.open = open
        for (const listener of panelState.listeners) listener(open)
      }
      const subscribe = (listener) => {
        panelState.listeners.add(listener)
        return () => panelState.listeners.delete(listener)
      }
      function usePanelOpen() {
        const [open, setOpenState] = react.useState(panelState.open)
        react.useEffect(() => subscribe(setOpenState), [])
        return [open, setOpen]
      }

      const tickState = { open: false, expanded: null }
      // 前端当前选中的会话 id：Trigger 在 sidebar.footer.action 里
      // 用 useSessions 标准钩子读取（archive-panel 同款用法），面板 tick 时
      // 把它发给 Host 作为跟随的最高优先级信号。
      const activeState = { id: null }

      function Trigger(props) {
        const [open] = usePanelOpen()
        const wide = !props || props.wide !== false
        if (props && typeof props.useSessions === 'function') {
          activeState.id = props.useSessions((state) => state.current) || null
        }
        return react.createElement('button', {
          className: 'svc-trigger' + (open ? ' svc-trigger-on is-open' : ''),
          title: '服务控制台 (service-deck)',
          onClick: () => setOpen(!open),
        }, react.createElement('span', { className: 'svc-trigger-dot' }), wide ? '服务' : null)
      }

      function Panel() {
        const [open] = usePanelOpen()
        const [tab, setTab] = react.useState('current')
        const [services, setServices] = react.useState([])
        const [current, setCurrent] = react.useState(null)
        const [error, setError] = react.useState('')
        const [note, setNote] = react.useState('')
        const [busy, setBusy] = react.useState(null)
        const [expanded, setExpanded] = react.useState(null)
        const [logs, setLogs] = react.useState({})
        const [detect, setDetect] = react.useState(null)
        const [detectBusy, setDetectBusy] = react.useState(false)
        const [confirmId, setConfirmId] = react.useState(null)

        tickState.open = open
        tickState.expanded = expanded

        react.useEffect(() => {
          const tick = async () => {
            if (!tickState.open) return
            try {
              const r = await callHost('list', { activeSessionId: activeState.id || undefined })
              setServices(r && r.services ? r.services : [])
              setCurrent((r && r.current) || null)
              if (r && r.autoRegistered && r.autoRegistered.length) {
                setNote('已自动登记: ' + r.autoRegistered.join(', '))
                ctx.timeout(() => setNote(''), 8000)
              }
              const id = tickState.expanded
              if (id) {
                const lr = await callHost('logs', { id: id, lines: 80 })
                setLogs((prev) => {
                  const next = Object.assign({}, prev)
                  next[id] = lr && lr.ok ? (lr.log || '') : ((lr && lr.error) || '')
                  return next
                })
              }
            } catch (e) {
              setError('host 通信失败: ' + ((e && e.message) || String(e)))
            }
          }
          tick()
          return ctx.interval(tick, 3000)
        }, [])

        const act = async (method, id) => {
          setBusy(id)
          setError('')
          try {
            const r = await callHost(method, { id: id })
            if (r && r.ok === false) setError(r.error || '操作失败')
          } catch (e) {
            setError((e && e.message) || String(e))
          }
          setBusy(null)
        }
        const runDetect = async () => {
          setDetectBusy(true)
          setError('')
          try {
            const r = await callHost('detect', {})
            setDetect(r || null)
          } catch (e) {
            setError((e && e.message) || String(e))
          }
          setDetectBusy(false)
        }
        const regCand = async (c) => {
          setBusy('cand:' + c.name)
          setError('')
          try {
            const r = await callHost('register', { projectPath: (current && current.path) || null, candidate: c })
            if (r && r.ok === false) setError(r.error || '登记失败')
            else setDetect(null)
          } catch (e) {
            setError((e && e.message) || String(e))
          }
          setBusy(null)
        }
        const rmSvc = (id) => {
          if (confirmId === id) { setConfirmId(null); act('remove', id) }
          else setConfirmId(id)
        }

        if (!open) return null

        const el = react.createElement
        const wsPath = current && current.path ? current.path : null
        const shown = (tab === 'all' || !wsPath) ? services : services.filter((s) => s.projectPath === wsPath)
        const running = services.filter((s) => s.running).length

        const tabBtn = (key, label) => el('button', {
          className: 'svc-tab' + (tab === key ? ' svc-tab-on' : ''),
          onClick: () => setTab(key),
        }, label)

        const actBtn = (label, fn, cls, disabled) => el('button', {
          className: 'svc-btn ' + (cls || ''),
          disabled: !!disabled,
          onClick: fn,
        }, label)

        return el('div', { className: 'svc-panel' },
          el('div', { className: 'svc-head' },
            el('div', { className: 'svc-title-row' },
              el('span', { className: 'svc-title' }, '服务控制台'),
              el('span', { className: 'svc-count' }, running + '/' + services.length + ' 运行'),
              el('button', { className: 'svc-close', title: '关闭', onClick: () => setOpen(false) }, '\u2715'),
            ),
            el('div', { className: 'svc-tabs' },
              tabBtn('current', '当前项目'),
              tabBtn('all', '全部'),
              el('span', { className: 'svc-follow', title: wsPath || '' }, wsPath ? '跟随: ' + (current.title || (wsPath.split('/').pop() || wsPath)) : ''),
              el('button', { className: 'svc-detect-btn', disabled: detectBusy, onClick: runDetect }, detectBusy ? '探测中\u2026' : '重新探测'),
            ),
          ),
          !wsPath && !services.length ? el('div', { className: 'svc-empty' }, '打开或使用一个会话后，面板会自动跟随其项目目录') : null,
          note ? el('div', { className: 'svc-note' }, note) : null,
          error ? el('div', { className: 'svc-error' }, error) : null,
          detect ? el('div', { className: 'svc-detect' },
            el('div', { className: 'svc-detect-title' }, wsPath ? ('探测结果 \u00b7 ' + (wsPath.split('/').pop() || wsPath)) : '探测结果'),
            detect.candidates && detect.candidates.length
              ? detect.candidates.map((c) => el('div', { key: c.name, className: 'svc-cand' },
                  el('div', { className: 'svc-cand-main' },
                    el('span', { className: 'svc-cand-name' }, c.name),
                    c.port ? el('span', { className: 'svc-cand-port' }, ':' + c.port) : null,
                    el('span', { className: 'svc-cand-src' }, c.source || c.template || ''),
                  ),
                  el('div', { className: 'svc-cand-cmd' }, c.command),
                  el('button', { className: 'svc-btn svc-btn-reg', disabled: busy === 'cand:' + c.name, onClick: () => regCand(c) }, '登记'),
                ))
              : el('div', { className: 'svc-empty' }, '未发现可登记的服务；可手写 .dsh-services.yml 或让 agent 用 service_register 登记'),
            el('button', { className: 'svc-btn', onClick: () => setDetect(null) }, '收起'),
          ) : null,
          el('div', { className: 'svc-rows' },
            shown.length === 0 ? el('div', { className: 'svc-empty' }, wsPath && tab === 'current' ? '当前项目还没有登记服务' : 'registry 为空') : null,
            shown.map((s) => {
              const on = !!s.running
              const isBusy = busy === s.id
              const isExp = expanded === s.id
              return el('div', { key: s.id, className: 'svc-row' },
                el('div', { className: 'svc-row-head', onClick: () => setExpanded(isExp ? null : s.id) },
                  el('span', { className: 'svc-dot ' + (on ? 'svc-dot-on' : 'svc-dot-off') }),
                  el('div', { className: 'svc-row-meta' },
                    el('div', { className: 'svc-row-name' }, s.name,
                      on && s.actualPort ? el('span', { className: 'svc-port' }, ':' + s.actualPort)
                        : (!on && s.port ? el('span', { className: 'svc-port svc-port-dim' }, ':' + s.port) : null),
                    ),
                    el('div', { className: 'svc-row-sub' }, s.project + ' \u00b7 ' + s.command + (s.template === 'docker' ? ' \u00b7 docker' : on && s.pid ? ' \u00b7 pid ' + s.pid : '')),
                  ),
                  el('span', { className: 'svc-caret' }, isExp ? '\u25be' : '\u25b8'),
                ),
                el('div', { className: 'svc-row-actions' },
                  !on ? actBtn('启动', () => act('start', s.id), 'svc-btn-start', isBusy) : null,
                  on ? actBtn('停止', () => act('stop', s.id), 'svc-btn-stop', isBusy) : null,
                  on ? actBtn('重启', () => act('restart', s.id), 'svc-btn-restart', isBusy) : null,
                  actBtn(confirmId === s.id ? '确认移除' : '移除', () => rmSvc(s.id), confirmId === s.id ? 'svc-btn-remove-confirm' : 'svc-btn-remove', isBusy),
                  isBusy ? el('span', { className: 'svc-busy' }, '\u2026') : null,
                ),
                isExp ? el('pre', { className: 'svc-log' }, logs[s.id] || '(\u52a0\u8f7d\u4e2d\u2026)') : null,
              )
            }),
          ),
        )
      }

      slots.inject('sidebar.footer.action', () => slots.register(
        { name: 'sidebar.footer.action', id: 'service-deck', order: 5, label: '服务控制台' },
        (props) => react.createElement(Trigger, props),
      ))
      slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'service-deck-panel', order: 20 },
        () => react.createElement(Panel),
      ))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
