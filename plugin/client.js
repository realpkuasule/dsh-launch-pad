// =============================================================================
// service-deck · Client 端（code.client 载荷）
// 用法：把本文件全文作为 cordis_define 的 code.client 传入即可（无需修改）。
// 需要用户授权后才能在当前页面渲染（面板在侧边栏底部「服务」按钮 + 悬浮面板）。
// =============================================================================
return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    styles.insert(`
.svc-trigger{display:inline-flex;align-items:center;gap:6px;cursor:pointer;background:transparent;border:none;color:inherit;font:inherit;padding:5px 7px;border-radius:8px;}
.svc-trigger:hover{background:rgba(128,128,128,.16);}
.svc-trigger-dot{width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 6px rgba(34,197,94,.8);flex:none;}
.svc-trigger-on .svc-trigger-dot{background:#eab308;box-shadow:0 0 6px rgba(234,179,8,.8);}
.svc-panel{position:fixed;right:16px;top:64px;width:356px;max-width:calc(100vw - 32px);max-height:76vh;display:flex;flex-direction:column;gap:8px;padding:10px;background:rgba(23,25,30,.97);border:1px solid rgba(255,255,255,.16);border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,.5);pointer-events:auto;z-index:9999;font-size:12.5px;line-height:1.45;color:#e7e9ee;font-family:inherit;}
.svc-head{display:flex;flex-direction:column;gap:6px;}
.svc-title-row{display:flex;align-items:center;gap:8px;}
.svc-title{font-weight:650;font-size:13.5px;flex:1;}
.svc-count{color:#9ca3af;font-size:11.5px;}
.svc-close{cursor:pointer;background:transparent;border:none;color:#9ca3af;font-size:13px;padding:2px 6px;border-radius:6px;}
.svc-close:hover{background:rgba(255,255,255,.1);color:#e7e9ee;}
.svc-tabs{display:flex;gap:6px;align-items:center;}
.svc-tab,.svc-detect-btn{cursor:pointer;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);color:#c9ced6;border-radius:999px;padding:3px 10px;font-size:11.5px;}
.svc-tab-on{background:rgba(96,165,250,.22);border-color:rgba(96,165,250,.55);color:#dbeafe;}
.svc-detect-btn{margin-left:auto;}
.svc-detect-btn:disabled{opacity:.5;cursor:default;}
.svc-ws-select{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.16);color:#e7e9ee;border-radius:8px;padding:3px 6px;font-size:11.5px;max-width:170px;}
.svc-error{background:rgba(239,68,68,.14);border:1px solid rgba(239,68,68,.45);color:#fca5a5;border-radius:8px;padding:6px 8px;white-space:pre-wrap;word-break:break-word;}
.svc-detect{border:1px solid rgba(96,165,250,.35);background:rgba(96,165,250,.07);border-radius:10px;padding:8px;display:flex;flex-direction:column;gap:6px;max-height:220px;overflow:auto;}
.svc-detect-title{color:#93c5fd;font-size:11.5px;}
.svc-cand{display:flex;flex-direction:column;gap:3px;padding:5px 7px;background:rgba(0,0,0,.22);border-radius:8px;}
.svc-cand-main{display:flex;gap:6px;align-items:center;}
.svc-cand-name{font-weight:650;}
.svc-cand-port{color:#4ade80;font-size:11px;}
.svc-cand-src{color:#6b7280;font-size:10.5px;margin-left:auto;}
.svc-cand-cmd{color:#9ca3af;font-family:ui-monospace,Menlo,monospace;font-size:11px;word-break:break-all;}
.svc-btn-reg{align-self:flex-end;}
.svc-rows{display:flex;flex-direction:column;gap:7px;overflow:auto;}
.svc-row{border:1px solid rgba(255,255,255,.09);border-radius:10px;padding:7px 9px;display:flex;flex-direction:column;gap:7px;background:rgba(255,255,255,.02);}
.svc-row-head{display:flex;align-items:center;gap:8px;cursor:pointer;}
.svc-dot{width:8px;height:8px;border-radius:50%;flex:none;}
.svc-dot-on{background:#22c55e;box-shadow:0 0 6px rgba(34,197,94,.7);}
.svc-dot-off{background:#6b7280;}
.svc-row-meta{flex:1;min-width:0;}
.svc-row-name{font-weight:650;display:flex;gap:7px;align-items:baseline;}
.svc-port{color:#4ade80;font-size:11.5px;font-family:ui-monospace,Menlo,monospace;}
.svc-port-dim{color:#6b7280;}
.svc-row-sub{color:#9ca3af;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.svc-caret{color:#6b7280;flex:none;}
.svc-row-actions{display:flex;gap:6px;align-items:center;}
.svc-btn{cursor:pointer;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#e7e9ee;border-radius:8px;padding:3px 9px;font-size:11.5px;}
.svc-btn:hover:not(:disabled){background:rgba(255,255,255,.14);}
.svc-btn:disabled{opacity:.5;cursor:default;}
.svc-btn-start{border-color:rgba(34,197,94,.6);color:#4ade80;}
.svc-btn-stop{border-color:rgba(239,68,68,.55);color:#f87171;}
.svc-btn-restart{border-color:rgba(234,179,8,.5);color:#facc15;}
.svc-btn-remove{border-color:transparent;background:transparent;color:#6b7280;}
.svc-btn-remove-confirm{border-color:rgba(239,68,68,.8);color:#f87171;}
.svc-busy{color:#9ca3af;font-size:11px;}
.svc-log{background:rgba(0,0,0,.38);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:7px;max-height:190px;overflow:auto;white-space:pre-wrap;word-break:break-all;font-family:ui-monospace,Menlo,monospace;font-size:10.8px;color:#c9ced6;margin:0;}
.svc-empty{color:#6b7280;padding:12px 6px;text-align:center;font-size:11.5px;}
`)

    let open = false
    const subs = new Set()
    function setOpen(v) {
      open = v
      for (const f of subs) f()
    }
    function usePanelOpen() {
      const [o, setO] = React.useState(open)
      React.useEffect(() => {
        const f = () => setO(open)
        subs.add(f)
        return () => { subs.delete(f) }
      }, [])
      return [o, setOpen]
    }

    const tickState = { open: false, expanded: null }

    function Trigger(props) {
      const [o] = usePanelOpen()
      const wide = !props || props.wide !== false
      return React.createElement('button', {
        className: 'svc-trigger' + (o ? ' svc-trigger-on' : ''),
        title: '服务控制台 (service-deck)',
        onClick: () => setOpen(!o),
      }, React.createElement('span', { className: 'svc-trigger-dot' }), wide ? '服务' : null)
    }

    function Panel(props) {
      const [o] = usePanelOpen()
      const [tab, setTab] = React.useState('current')
      const [services, setServices] = React.useState([])
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState(null)
      const [expanded, setExpanded] = React.useState(null)
      const [logs, setLogs] = React.useState({})
      const [detect, setDetect] = React.useState(null)
      const [detectBusy, setDetectBusy] = React.useState(false)
      const [confirmId, setConfirmId] = React.useState(null)
      const [workspaces, setWorkspaces] = React.useState([])
      const [wsPath, setWsPath] = React.useState(null)

      tickState.open = o
      tickState.expanded = expanded

      React.useEffect(() => {
        const tick = async () => {
          if (!tickState.open) return
          try {
            const r = await host.call('list', {})
            setServices(r && r.services ? r.services : [])
            const id = tickState.expanded
            if (id) {
              const lr = await host.call('logs', { id: id, lines: 80 })
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

      React.useEffect(() => {
        let dead = false
        const loadWs = async () => {
          try {
            const r = await host.call('workspaces', {})
            if (dead) return
            const list = r && r.workspaces ? r.workspaces : []
            setWorkspaces(list)
            setWsPath((prev) => prev || (list.length ? list[0].path : null))
          } catch (e) {
            if (!dead) setError((e && e.message) || String(e))
          }
        }
        loadWs()
        return () => { dead = true }
      }, [])

      const act = async (method, id) => {
        setBusy(id)
        setError('')
        try {
          const r = await host.call(method, { id: id })
          if (r && r.ok === false) setError(r.error || '操作失败')
        } catch (e) {
          setError((e && e.message) || String(e))
        }
        setBusy(null)
      }
      const runDetect = async () => {
        if (!wsPath) { setError('请先在下拉框选择一个工作区（或先在 DSH 中打开一个项目）'); return }
        setDetectBusy(true)
        setError('')
        try {
          const r = await host.call('detect', { projectPath: wsPath })
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
          const r = await host.call('register', { projectPath: wsPath, candidate: c })
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

      if (!o) return null

      const el = React.createElement
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
            tabBtn('current', '当前工作区'),
            tabBtn('all', '全部'),
            workspaces.length ? el('select', {
              className: 'svc-ws-select',
              value: wsPath || '',
              onChange: (ev) => setWsPath(ev.target.value),
            }, workspaces.map((w) => el('option', { key: w.path, value: w.path }, w.title || (w.path.split('/').pop() || w.path)))) : null,
            el('button', { className: 'svc-detect-btn', disabled: detectBusy, onClick: runDetect }, detectBusy ? '探测中\u2026' : '登记当前项目'),
          ),
        ),
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
          shown.length === 0 ? el('div', { className: 'svc-empty' }, wsPath && tab === 'current' ? '当前工作区还没有登记服务' : 'registry 为空') : null,
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
      (props) => React.createElement(Trigger, props),
    ))
    slots.inject('shell.overlay', () => slots.register(
      { name: 'shell.overlay', id: 'service-deck-panel', order: 20 },
      (props) => React.createElement(Panel, props),
    ))
  },
}
