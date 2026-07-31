export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>OpsPulse | Operations</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #090d10;
      --panel: #11171b;
      --panel-raised: #151d22;
      --line: #253138;
      --muted: #8b9ba4;
      --text: #edf3f5;
      --mint: #53e3ac;
      --amber: #ffc65c;
      --red: #ff6b6b;
      --blue: #63a9ff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-width: 320px;
      background:
        radial-gradient(circle at 80% -10%, rgba(83, 227, 172, .1), transparent 32rem),
        linear-gradient(180deg, #0b1114 0, var(--bg) 32rem);
      color: var(--text);
      font: 15px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    button, input, select, textarea { font: inherit; }
    .shell { width: min(1440px, 100%); margin: 0 auto; padding: 30px clamp(18px, 4vw, 56px) 60px; }
    header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 30px; }
    .brand { display: flex; align-items: center; gap: 11px; margin-bottom: 13px; color: var(--mint); font: 700 13px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .16em; text-transform: uppercase; }
    .pulse { width: 10px; height: 10px; border-radius: 50%; background: var(--mint); box-shadow: 0 0 0 5px rgba(83, 227, 172, .12), 0 0 22px var(--mint); }
    h1 { margin: 0; max-width: 760px; font-size: clamp(34px, 5vw, 64px); line-height: .98; letter-spacing: -.055em; }
    .lede { margin: 16px 0 0; color: var(--muted); font-size: 16px; }
    .actions { display: flex; align-items: center; gap: 14px; padding-top: 5px; }
    #updated-at { color: var(--muted); font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; }
    button { border: 1px solid #385047; border-radius: 8px; padding: 9px 14px; background: #14221d; color: var(--mint); cursor: pointer; }
    button:hover { background: #193027; }
    button:disabled { cursor: wait; opacity: .55; }
    .primary { background: var(--mint); color: #07110d; border-color: var(--mint); font-weight: 750; }
    .primary:hover { background: #79ebc1; }
    .secondary { background: transparent; color: var(--text); border-color: var(--line); }
    .danger { background: rgba(255, 107, 107, .08); color: var(--red); border-color: rgba(255, 107, 107, .45); }
    .small { padding: 6px 10px; font-size: 12px; }
    .summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 28px; }
    .metric { position: relative; overflow: hidden; min-height: 116px; border: 1px solid var(--line); border-radius: 12px; padding: 18px; background: rgba(17, 23, 27, .86); }
    .metric::after { content: ""; position: absolute; inset: auto -22px -42px auto; width: 92px; height: 92px; border-radius: 50%; background: var(--metric-color, var(--blue)); filter: blur(34px); opacity: .13; }
    .metric-label { color: var(--muted); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }
    .metric-value { margin-top: 12px; font: 700 34px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
    .grid { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(300px, .8fr); gap: 18px; }
    .panel { min-width: 0; border: 1px solid var(--line); border-radius: 14px; background: rgba(17, 23, 27, .92); overflow: hidden; }
    .panel-wide { grid-column: 1 / -1; }
    .panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 18px; padding: 18px 20px; border-bottom: 1px solid var(--line); }
    h2 { margin: 0; font-size: 16px; letter-spacing: -.01em; }
    .panel-note { color: var(--muted); font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; letter-spacing: .09em; }
    .list { min-height: 152px; }
    .row { display: grid; align-items: center; gap: 16px; padding: 16px 20px; border-bottom: 1px solid rgba(37, 49, 56, .7); }
    .row:last-child { border-bottom: 0; }
    .monitor-row { grid-template-columns: minmax(170px, 1fr) 110px minmax(150px, .7fr) 120px auto; }
    .check-row { grid-template-columns: minmax(160px, 1fr) 100px 110px 110px minmax(150px, .8fr); }
    .incident-row { display: block; }
    .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 650; }
    .sub { margin-top: 3px; overflow: hidden; color: var(--muted); font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; text-overflow: ellipsis; white-space: nowrap; }
    .badge { display: inline-flex; width: fit-content; align-items: center; gap: 7px; border: 1px solid currentColor; border-radius: 999px; padding: 4px 9px; font: 700 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .04em; text-transform: uppercase; }
    .badge::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    .up, .success, .delivered { color: var(--mint); }
    .down, .failure, .timeout, .failed { color: var(--red); }
    .degraded, .paused, .cancelled, .retrying { color: var(--amber); }
    .pending, .queued { color: var(--blue); }
    .incident-card { padding: 18px 20px; border-bottom: 1px solid rgba(37, 49, 56, .7); }
    .incident-card:last-child { border-bottom: 0; }
    .incident-top { display: flex; justify-content: space-between; gap: 12px; }
    .cause { margin-top: 12px; color: #d7e0e4; }
    .empty, .error, .loading { display: grid; min-height: 152px; place-items: center; padding: 30px; color: var(--muted); text-align: center; }
    .error { color: #ff9999; }
    dialog { width: min(720px, calc(100% - 28px)); max-height: calc(100vh - 28px); padding: 0; border: 1px solid var(--line); border-radius: 16px; background: var(--panel); color: var(--text); box-shadow: 0 28px 90px rgba(0, 0, 0, .55); }
    dialog::backdrop { background: rgba(3, 7, 9, .76); backdrop-filter: blur(4px); }
    .dialog-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding: 22px 24px; border-bottom: 1px solid var(--line); }
    .dialog-head h2 { font-size: 21px; }
    .dialog-body { padding: 22px 24px 26px; overflow-y: auto; }
    .dialog-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; margin-top: 22px; }
    .form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .field { display: grid; gap: 7px; }
    .field-wide { grid-column: 1 / -1; }
    label { color: var(--muted); font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
    input, select, textarea { width: 100%; border: 1px solid var(--line); border-radius: 8px; padding: 10px 11px; background: #0c1215; color: var(--text); }
    textarea { min-height: 88px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    input:focus, select:focus, textarea:focus, button:focus-visible { outline: 2px solid var(--mint); outline-offset: 2px; }
    .check-field { display: flex; align-items: center; gap: 9px; align-self: end; min-height: 42px; }
    .check-field input { width: auto; }
    .form-error { min-height: 22px; margin: 14px 0 0; color: #ff9999; font-size: 13px; }
    .detail-summary { display: grid; grid-template-columns: 1fr auto; gap: 16px; align-items: start; margin-bottom: 20px; }
    .detail-url { overflow-wrap: anywhere; color: var(--muted); font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; }
    .detail-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 16px; }
    .fact { border: 1px solid var(--line); border-radius: 9px; padding: 11px; background: #0d1316; }
    .fact span { display: block; color: var(--muted); font-size: 11px; text-transform: uppercase; }
    .fact strong { display: block; margin-top: 4px; }
    .detail-section { margin-top: 24px; }
    .detail-section h3 { margin: 0 0 10px; font-size: 14px; }
    .compact-list { border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
    .compact-row { display: grid; grid-template-columns: 1fr auto; gap: 12px; padding: 11px 13px; border-bottom: 1px solid var(--line); }
    .compact-row:last-child { border-bottom: 0; }
    .compact-empty { padding: 18px; color: var(--muted); text-align: center; }
    @media (max-width: 900px) {
      .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .grid { grid-template-columns: 1fr; }
      .panel-wide { grid-column: auto; }
      .monitor-row, .check-row { grid-template-columns: minmax(150px, 1fr) 105px; }
      .mobile-hide { display: none; }
    }
    @media (max-width: 620px) {
      .shell { padding-top: 22px; }
      header { display: block; }
      .actions { justify-content: space-between; margin-top: 22px; }
      .summary { gap: 9px; }
      .metric { min-height: 98px; padding: 15px; }
      .metric-value { font-size: 28px; }
      .row { padding: 14px 16px; }
      .panel-head { padding: 16px; }
      .form-grid, .detail-facts { grid-template-columns: 1fr; }
      .field-wide { grid-column: auto; }
      .dialog-head, .dialog-body { padding-left: 18px; padding-right: 18px; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <div>
        <div class="brand"><span class="pulse"></span>OpsPulse</div>
        <h1>Operational truth, at a glance.</h1>
        <p class="lede">Live monitor state, check outcomes, and active incidents from this OpsPulse instance.</p>
      </div>
      <div class="actions">
        <span id="updated-at" role="status" aria-live="polite">Waiting for data</span>
        <button id="new-monitor" class="primary" type="button">New monitor</button>
        <button id="refresh" type="button">Refresh</button>
      </div>
    </header>

    <section class="summary" aria-label="Operations summary">
      <article class="metric" style="--metric-color: var(--blue)"><div class="metric-label">Monitors</div><div class="metric-value" id="monitor-count">-</div></article>
      <article class="metric" style="--metric-color: var(--mint)"><div class="metric-label">Up</div><div class="metric-value" id="up-count">-</div></article>
      <article class="metric" style="--metric-color: var(--red)"><div class="metric-label">Down</div><div class="metric-value" id="down-count">-</div></article>
      <article class="metric" style="--metric-color: var(--amber)"><div class="metric-label">Open incidents</div><div class="metric-value" id="incident-count">-</div></article>
    </section>

    <div class="grid">
      <section class="panel" aria-labelledby="monitors-title">
        <div class="panel-head"><h2 id="monitors-title">Monitors</h2><span class="panel-note">Current state</span></div>
        <div class="list" id="monitors"><div class="loading">Loading monitors...</div></div>
      </section>
      <section class="panel" aria-labelledby="incidents-title">
        <div class="panel-head"><h2 id="incidents-title">Open incidents</h2><span class="panel-note">Needs attention</span></div>
        <div class="list" id="open-incidents"><div class="loading">Loading incidents...</div></div>
      </section>
      <section class="panel panel-wide" aria-labelledby="checks-title">
        <div class="panel-head"><h2 id="checks-title">Recent checks</h2><span class="panel-note">Latest 12 across monitors</span></div>
        <div class="list" id="recent-checks"><div class="loading">Loading checks...</div></div>
      </section>
      <section class="panel panel-wide" aria-labelledby="deliveries-title">
        <div class="panel-head"><h2 id="deliveries-title">Notification deliveries</h2><span class="panel-note">Latest 12 webhook attempts</span></div>
        <div class="list" id="recent-deliveries"><div class="loading">Loading deliveries...</div></div>
      </section>
    </div>
  </main>

  <dialog id="monitor-form-dialog" aria-labelledby="monitor-form-title">
    <div class="dialog-head">
      <div><div class="brand">HTTP or heartbeat monitor</div><h2 id="monitor-form-title">Create a monitor</h2></div>
      <button class="secondary small" type="button" data-close="monitor-form-dialog">Close</button>
    </div>
    <form id="monitor-form" class="dialog-body">
      <div class="form-grid">
        <div class="field"><label for="monitor-kind">Type</label><select id="monitor-kind" name="kind"><option value="http">HTTP</option><option value="heartbeat">Heartbeat</option></select></div>
        <div class="field"><label for="monitor-name">Name</label><input id="monitor-name" name="name" maxlength="100" required placeholder="Production API"></div>
        <div class="field field-wide http-field"><label for="monitor-url">URL</label><input id="monitor-url" name="url" type="url" maxlength="2048" required placeholder="https://api.example.com/health"></div>
        <div class="field http-field"><label for="monitor-method">Method</label><select id="monitor-method" name="method"><option>GET</option><option>HEAD</option></select></div>
        <div class="field"><label for="monitor-interval">Interval seconds</label><input id="monitor-interval" name="intervalSeconds" type="number" min="30" max="86400" value="60" required></div>
        <div class="field heartbeat-field" hidden><label for="monitor-grace">Grace seconds</label><input id="monitor-grace" name="gracePeriodSeconds" type="number" min="0" max="86400" value="60"></div>
        <div class="field http-field"><label for="monitor-timeout">Timeout seconds</label><input id="monitor-timeout" name="timeoutSeconds" type="number" min="1" max="30" value="5" required></div>
        <div class="field"><label for="monitor-status-min">Minimum accepted status</label><input id="monitor-status-min" name="statusMin" type="number" min="100" max="599" value="200" required></div>
        <div class="field"><label for="monitor-status-max">Maximum accepted status</label><input id="monitor-status-max" name="statusMax" type="number" min="100" max="599" value="399" required></div>
        <div class="field"><label for="monitor-failures">Failure threshold</label><input id="monitor-failures" name="failureThreshold" type="number" min="1" max="10" value="2" required></div>
        <div class="field"><label for="monitor-recoveries">Recovery threshold</label><input id="monitor-recoveries" name="recoveryThreshold" type="number" min="1" max="10" value="1" required></div>
        <div class="field field-wide http-field"><label for="monitor-headers">Request headers (JSON)</label><textarea id="monitor-headers" name="headers" spellcheck="false">[]</textarea></div>
        <label class="check-field field-wide" for="monitor-published"><input id="monitor-published" name="published" type="checkbox"> Publish on the status page</label>
      </div>
      <p id="monitor-form-error" class="form-error" role="status" aria-live="polite"></p>
      <div class="dialog-actions"><button class="secondary" type="button" data-close="monitor-form-dialog">Cancel</button><button class="primary" type="submit">Create monitor</button></div>
    </form>
  </dialog>

  <dialog id="monitor-detail" aria-labelledby="detail-title">
    <div class="dialog-head">
      <div><div class="brand">Monitor detail</div><h2 id="detail-title">Loading...</h2></div>
      <button class="secondary small" type="button" data-close="monitor-detail">Close</button>
    </div>
    <div class="dialog-body">
      <div id="detail-content"><div class="loading">Loading monitor history...</div></div>
      <p id="detail-error" class="form-error" role="status" aria-live="polite"></p>
    </div>
  </dialog>
  <script>
    const byId = (id) => document.getElementById(id);
    const make = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const formatTime = (value) => new Intl.DateTimeFormat(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(new Date(value));
    const relativeTime = (value) => {
      const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
      if (seconds < 60) return seconds + 's ago';
      if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
      if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
      return Math.floor(seconds / 86400) + 'd ago';
    };
    const fetchJson = async (url, init = {}) => {
      const response = await fetch(url, {
        ...init,
        headers: { accept: 'application/json', ...(init.headers || {}) }
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body && body.error ? body.error.message : 'Request failed with status ' + response.status);
      }
      return response.json();
    };
    const fetchAllPages = async (url) => {
      const items = [];
      let cursor;
      do {
        const page = await fetchJson(url + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
        items.push(...page.items);
        cursor = page.page.hasMore ? page.page.nextCursor : undefined;
      } while (cursor);
      return items;
    };
    const setMessage = (id, message, kind) => {
      const target = byId(id);
      target.replaceChildren(make('div', kind, message));
    };
    const badge = (value) => make('span', 'badge ' + value, value);

    function renderMonitors(monitors) {
      const target = byId('monitors');
      if (monitors.length === 0) return setMessage('monitors', 'No monitors yet. Create one through POST /v1/monitors.', 'empty');
      target.replaceChildren(...monitors.map((monitor) => {
        const row = make('article', 'row monitor-row');
        const identity = make('div');
        identity.append(make('div', 'name', monitor.name), make('div', 'sub', monitor.kind === 'heartbeat' ? 'Heartbeat · next ' + (monitor.nextHeartbeatDeadline ? relativeTime(monitor.nextHeartbeatDeadline) : 'not scheduled') : monitor.url));
        const cadence = make('div', 'mobile-hide');
        cadence.append(make('div', 'name', monitor.intervalSeconds + 's'), make('div', 'sub', 'check interval'));
        const checked = make('div', 'mobile-hide');
        checked.append(
          make('div', 'name', monitor.lastEvaluatedCheckAt ? relativeTime(monitor.lastEvaluatedCheckAt) : 'Never'),
          make('div', 'sub', 'last evaluated')
        );
        const view = make('button', 'secondary small', 'View');
        view.type = 'button';
        view.setAttribute('aria-label', 'View ' + monitor.name);
        view.addEventListener('click', () => openMonitor(monitor.id));
        row.append(identity, monitor.lifecycle === 'paused' ? badge('paused') : badge(monitor.state), cadence, checked, view);
        return row;
      }));
    }

    function renderIncidents(incidents) {
      const target = byId('open-incidents');
      if (incidents.length === 0) return setMessage('open-incidents', 'No open incidents. All clear.', 'empty');
      target.replaceChildren(...incidents.map((incident) => {
        const card = make('article', 'incident-card');
        const top = make('div', 'incident-top');
        const identity = make('div');
        identity.append(make('div', 'name', incident.monitorName), make('div', 'sub', 'Opened ' + relativeTime(incident.startedAt)));
        top.append(identity, badge('down'));
        card.append(top, make('div', 'cause', incident.latestCause.safeSummary));
        return card;
      }));
    }

    function renderChecks(checks, monitorNames) {
      const target = byId('recent-checks');
      if (checks.length === 0) return setMessage('recent-checks', 'No checks have run yet.', 'empty');
      target.replaceChildren(...checks.map((item) => {
        const run = item.run;
        const state = run
          ? run.result
          : item.request.status === 'cancelled-internal' ? 'cancelled' : 'pending';
        const row = make('article', 'row check-row');
        const identity = make('div');
        identity.append(
          make('div', 'name', monitorNames.get(item.request.monitorId) || 'Unknown monitor'),
          make('div', 'sub', 'Sequence ' + item.request.sequence)
        );
        const latency = make('div', 'mobile-hide');
        latency.append(make('div', 'name', run && run.latencyMs !== null ? run.latencyMs + ' ms' : '-'), make('div', 'sub', 'latency'));
        const status = make('div', 'mobile-hide');
        status.append(make('div', 'name', run && run.httpStatus !== null ? String(run.httpStatus) : '-'), make('div', 'sub', 'HTTP status'));
        const occurred = make('div', 'mobile-hide');
        occurred.append(make('div', 'name', relativeTime(item.request.scheduledAt)), make('div', 'sub', formatTime(item.request.scheduledAt)));
        row.append(identity, badge(state), latency, status, occurred);
        return row;
      }));
    }

    function renderDeliveries(deliveries) {
      const target = byId('recent-deliveries');
      if (deliveries.length === 0) return setMessage('recent-deliveries', 'No webhook deliveries queued yet.', 'empty');
      target.replaceChildren(...deliveries.map((delivery) => {
        const row = make('article', 'row check-row');
        const identity = make('div');
        identity.append(
          make('div', 'name', 'Channel ' + delivery.channelId.slice(0, 8)),
          make('div', 'sub', 'Event ' + delivery.incidentEventId.slice(0, 8))
        );
        const attempts = make('div', 'mobile-hide');
        attempts.append(make('div', 'name', String(delivery.attemptCount)), make('div', 'sub', 'attempts'));
        const last = make('div', 'mobile-hide');
        last.append(make('div', 'name', delivery.lastResponseStatus === null ? '-' : String(delivery.lastResponseStatus)), make('div', 'sub', 'last status'));
        const next = make('div', 'mobile-hide');
        next.append(make('div', 'name', delivery.nextAttemptAt ? relativeTime(delivery.nextAttemptAt) : '-'), make('div', 'sub', 'next attempt'));
        row.append(identity, badge(delivery.status), attempts, last, next);
        return row;
      }));
    }

    const compactEmpty = (message) => make('div', 'compact-empty', message);

    function renderMonitorDetail(monitor, checks, incidents) {
      byId('detail-title').textContent = monitor.name;
      const content = byId('detail-content');
      const summary = make('div', 'detail-summary');
      const identity = make('div');
      identity.append(make('div', 'detail-url', monitor.kind === 'heartbeat' ? 'Heartbeat monitor · deadline ' + (monitor.nextHeartbeatDeadline ? formatTime(monitor.nextHeartbeatDeadline) : 'not scheduled') : monitor.url));
      const facts = make('div', 'detail-facts');
      for (const [label, value] of [
        ['Lifecycle', monitor.lifecycle],
        ['Interval', monitor.intervalSeconds + ' seconds'],
        [monitor.kind === 'heartbeat' ? 'Last heartbeat' : 'Last evaluated', monitor.kind === 'heartbeat' ? (monitor.lastHeartbeatAt ? relativeTime(monitor.lastHeartbeatAt) : 'Never') : (monitor.lastEvaluatedCheckAt ? relativeTime(monitor.lastEvaluatedCheckAt) : 'Never')],
        ...(monitor.kind === 'heartbeat' ? [['Grace', monitor.gracePeriodSeconds + ' seconds']] : [])
      ]) {
        const fact = make('div', 'fact');
        fact.append(make('span', '', label), make('strong', '', value));
        facts.append(fact);
      }
      identity.append(facts);
      summary.append(identity, monitor.lifecycle === 'paused' ? badge('paused') : badge(monitor.state));

      const actions = make('div', 'dialog-actions');
      if (monitor.kind === 'http') {
        const edit = make('button', 'secondary', 'Edit monitor');
        edit.addEventListener('click', () => openMonitorForm(monitor));
        actions.append(edit);
      } else {
        const rotate = make('button', 'secondary', 'Rotate token');
        rotate.addEventListener('click', () => rotateHeartbeatToken());
        actions.append(rotate);
      }
      if (monitor.lifecycle === 'active') {
        const pause = make('button', 'secondary', 'Pause monitor');
        pause.addEventListener('click', () => runLifecycleCommand('pause'));
        actions.append(pause);
      } else if (monitor.lifecycle === 'paused') {
        const resume = make('button', 'primary', 'Resume monitor');
        resume.addEventListener('click', () => runLifecycleCommand('resume'));
        actions.append(resume);
      }
      const archive = make('button', 'danger', 'Archive monitor');
      archive.addEventListener('click', () => runLifecycleCommand('archive'));
      actions.append(archive);

      const checkSection = make('section', 'detail-section');
      checkSection.append(make('h3', '', 'Check history · latest 100'));
      const checkList = make('div', 'compact-list');
      if (checks.length === 0) checkList.append(compactEmpty('No checks have run yet.'));
      else checkList.append(...checks.map((item) => {
        const state = item.run ? item.run.result : item.request.status === 'cancelled-internal' ? 'cancelled' : 'pending';
        const detail = item.run && item.run.latencyMs !== null ? item.run.latencyMs + ' ms' : relativeTime(item.request.scheduledAt);
        const row = make('div', 'compact-row');
        row.append(make('span', '', 'Sequence ' + item.request.sequence + ' · ' + state), make('span', 'sub', detail));
        return row;
      }));
      checkSection.append(checkList);

      const incidentSection = make('section', 'detail-section');
      incidentSection.append(make('h3', '', 'Incident history · latest 100'));
      const incidentList = make('div', 'compact-list');
      if (incidents.length === 0) incidentList.append(compactEmpty('No incidents recorded.'));
      else incidentList.append(...incidents.map((incident) => {
        const row = make('div', 'compact-row');
        row.append(make('span', '', incident.latestCause.safeSummary), make('span', 'sub', incident.status + ' · ' + relativeTime(incident.startedAt)));
        return row;
      }));
      incidentSection.append(incidentList);
      content.replaceChildren(summary, actions, checkSection, incidentSection);
    }

    let selectedMonitorId;
    async function openMonitor(id) {
      selectedMonitorId = id;
      const dialog = byId('monitor-detail');
      byId('detail-title').textContent = 'Loading...';
      byId('detail-error').textContent = '';
      byId('detail-content').replaceChildren(make('div', 'loading', 'Loading monitor history...'));
      if (!dialog.open) dialog.showModal();
      const monitorPath = ['/v1/monitors', encodeURIComponent(id)].join('/');
      try {
        const [response, checkPage, incidentPage] = await Promise.all([
          fetchJson(monitorPath),
          fetchJson(monitorPath + '/checks?limit=100'),
          fetchJson('/v1/incidents?monitorId=' + encodeURIComponent(id) + '&limit=100')
        ]);
        renderMonitorDetail(response.monitor, checkPage.items, incidentPage.items);
      } catch (error) {
        byId('detail-error').textContent = error instanceof Error ? error.message : 'Unable to load monitor';
      }
    }

    async function rotateHeartbeatToken() {
      if (!selectedMonitorId) return;
      const monitorPath = ['/v1/monitors', encodeURIComponent(selectedMonitorId)].join('/');
      byId('detail-error').textContent = '';
      try {
        const token = await fetchJson(monitorPath + '/heartbeat-token', { method: 'POST' });
        window.prompt('Copy heartbeat ping curl', 'curl -X POST ' + location.origin + token.pingPath + ' -H "Idempotency-Key: nightly-job-$(date +%F)"');
        await openMonitor(selectedMonitorId);
      } catch (error) {
        byId('detail-error').textContent = error instanceof Error ? error.message : 'Token rotation failed';
      }
    }

    async function runLifecycleCommand(command) {
      if (!selectedMonitorId) return;
      if (command === 'archive' && !window.confirm('Archive this monitor? Its history will be retained.')) return;
      const monitorPath = ['/v1/monitors', encodeURIComponent(selectedMonitorId)].join('/');
      byId('detail-error').textContent = '';
      try {
        await fetchJson(monitorPath + '/' + command, { method: 'POST' });
        await loadDashboard();
        if (command === 'archive') byId('monitor-detail').close();
        else await openMonitor(selectedMonitorId);
      } catch (error) {
        byId('detail-error').textContent = error instanceof Error ? error.message : 'Lifecycle command failed';
      }
    }

    let loading = false;
    async function loadDashboard() {
      if (loading) return;
      loading = true;
      const button = byId('refresh');
      button.disabled = true;
      try {
        const [allMonitors, incidents, checkPage, deliveryPage] = await Promise.all([
          fetchAllPages('/v1/monitors?limit=50'),
          fetchAllPages('/v1/incidents?status=open&limit=50'),
          fetchJson('/v1/checks?limit=12'),
          fetchJson('/v1/deliveries?limit=12')
        ]);
        const monitors = allMonitors.filter((monitor) => monitor.lifecycle !== 'archived');
        renderMonitors(monitors);
        renderIncidents(incidents);
        byId('monitor-count').textContent = String(monitors.length);
        byId('up-count').textContent = String(monitors.filter((item) => item.lifecycle === 'active' && item.state === 'up').length);
        byId('down-count').textContent = String(monitors.filter((item) => item.lifecycle === 'active' && item.state === 'down').length);
        byId('incident-count').textContent = String(incidents.length);

        renderChecks(checkPage.items, new Map(monitors.map((monitor) => [monitor.id, monitor.name])));
        renderDeliveries(deliveryPage.items);
        byId('updated-at').textContent = 'Updated ' + new Date().toLocaleTimeString();
      } catch (error) {
        setMessage('monitors', 'Unable to load monitor data.', 'error');
        setMessage('open-incidents', 'Unable to load incident data.', 'error');
        setMessage('recent-checks', 'Unable to load check data.', 'error');
        setMessage('recent-deliveries', 'Unable to load delivery data.', 'error');
        byId('updated-at').textContent = 'Refresh failed';
      } finally {
        button.disabled = false;
        loading = false;
      }
    }

    let editingMonitorId;
    function openMonitorForm(monitor) {
      const form = byId('monitor-form');
      form.reset();
      editingMonitorId = monitor && monitor.id;
      form.elements.kind.value = monitor && monitor.kind ? monitor.kind : 'http';
      updateMonitorKindFields();
      byId('monitor-form-error').textContent = '';
      byId('monitor-form-title').textContent = monitor ? 'Edit monitor' : 'Create a monitor';
      form.querySelector('[type="submit"]').textContent = monitor ? 'Save changes' : 'Create monitor';
      if (monitor) {
        form.elements.name.value = monitor.name;
        form.elements.url.value = monitor.url;
        form.elements.method.value = monitor.method;
        form.elements.intervalSeconds.value = String(monitor.intervalSeconds);
        form.elements.timeoutSeconds.value = String(monitor.timeoutSeconds);
        form.elements.statusMin.value = String(monitor.acceptedStatus.min);
        form.elements.statusMax.value = String(monitor.acceptedStatus.max);
        form.elements.failureThreshold.value = String(monitor.failureThreshold);
        form.elements.recoveryThreshold.value = String(monitor.recoveryThreshold);
        form.elements.headers.value = JSON.stringify(monitor.headers, null, 2);
        form.elements.published.checked = monitor.published;
        byId('monitor-detail').close();
      }
      byId('monitor-form-dialog').showModal();
    }

    function updateMonitorKindFields() {
      const kind = byId('monitor-kind').value;
      document.querySelectorAll('.http-field').forEach((node) => { node.hidden = kind !== 'http'; });
      document.querySelectorAll('.heartbeat-field').forEach((node) => { node.hidden = kind !== 'heartbeat'; });
      byId('monitor-url').required = kind === 'http';
      byId('monitor-timeout').required = kind === 'http';
      byId('monitor-status-min').required = kind === 'http';
      byId('monitor-status-max').required = kind === 'http';
    }

    byId('monitor-kind').addEventListener('change', updateMonitorKindFields);
    byId('refresh').addEventListener('click', loadDashboard);
    byId('new-monitor').addEventListener('click', () => openMonitorForm());
    document.querySelectorAll('[data-close]').forEach((button) => {
      button.addEventListener('click', () => byId(button.dataset.close).close());
    });
    byId('monitor-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = form.querySelector('[type="submit"]');
      const values = new FormData(form);
      submit.disabled = true;
      byId('monitor-form-error').textContent = '';
      try {
        const monitorPath = editingMonitorId
          ? ['/v1/monitors', encodeURIComponent(editingMonitorId)].join('/')
          : '/v1/monitors';
        const kind = String(values.get('kind'));
        const common = {
          kind,
          name: values.get('name'),
          intervalSeconds: Number(values.get('intervalSeconds')),
          failureThreshold: Number(values.get('failureThreshold')),
          recoveryThreshold: Number(values.get('recoveryThreshold')),
          published: form.elements.published.checked
        };
        const saved = await fetchJson(monitorPath, {
          method: editingMonitorId ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(kind === 'heartbeat' ? {
            ...common,
            gracePeriodSeconds: Number(values.get('gracePeriodSeconds'))
          } : {
            ...common,
            url: values.get('url'),
            method: values.get('method'),
            timeoutSeconds: Number(values.get('timeoutSeconds')),
            acceptedStatus: {
              min: Number(values.get('statusMin')),
              max: Number(values.get('statusMax'))
            },
            headers: JSON.parse(String(values.get('headers') || '[]'))
          })
        });
        byId('monitor-form-dialog').close();
        form.reset();
        editingMonitorId = undefined;
        await loadDashboard();
        if (saved.heartbeat) {
          window.prompt('Copy heartbeat ping curl', 'curl -X POST ' + location.origin + saved.heartbeat.pingPath + ' -H "Idempotency-Key: nightly-job-$(date +%F)"');
        }
        await openMonitor(saved.monitor.id);
      } catch (error) {
        byId('monitor-form-error').textContent = error instanceof Error ? error.message : 'Unable to save monitor';
      } finally {
        submit.disabled = false;
      }
    });
    loadDashboard();
    setInterval(loadDashboard, 30000);
  </script>
</body>
</html>`;
