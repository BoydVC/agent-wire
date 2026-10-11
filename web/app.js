(function () {
  "use strict";

  const COLOR_MAP = {
    yellow: "#f5d76e",
    green: "#00ff9c",
    blue: "#00d4ff",
    purple: "#b388ff",
    red: "#ff5c7a",
    orange: "#ff9f43",
    pink: "#ff4fd8",
    teal: "#1dd1a1",
    gray: "#8b9bb4",
    grey: "#8b9bb4",
    cyan: "#00d4ff",
    white: "#e8fff6",
    black: "#3a4654",
  };

  const KIND_COLOR = {
    routine: "#ffc857",
    tool: "#00ff9c",
    message: "#00d4ff",
    shell: "#9d8cff",
    browser: "#ff4fd8",
    computer: "#ff9f43",
    file: "#1dd1a1",
    output: "#8b9bb4",
    other: "#6f9a8a",
  };

  let WIRE = window.__WIRE__;
  const state = {
    view: "rain",
    rain: { pause: false, speed: 1, particles: [], raf: 0 },
    graph: { nodes: [], edges: [], raf: 0, hover: null },
    tl: { dayIdx: 0, days: [] },
    filter: "",
  };

  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  function avatarColor(name) {
    if (!name || name === "unknown") return "#00ff9c";
    const key = String(name).toLowerCase();
    if (COLOR_MAP[key]) return COLOR_MAP[key];
    // hash fallback for unknown named colors
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    const hue = Math.abs(h) % 360;
    return `hsl(${hue} 80% 55%)`;
  }

  function initials(name) {
    if (!name || name === "unknown") return "?";
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function fmtTime(iso) {
    if (!iso || iso === "unknown") return "unknown";
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return String(iso);
      return d.toLocaleString("en-US", {
        timeZone: "America/New_York",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }) + " ET";
    } catch (_) {
      return String(iso);
    }
  }

  function fmtDay(day) {
    if (!day) return "—";
    try {
      const d = new Date(day + "T12:00:00Z");
      return d.toLocaleDateString("en-US", {
        timeZone: "UTC",
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch (_) {
      return day;
    }
  }

  async function loadWire() {
    if (WIRE && WIRE.bots) return WIRE;
    try {
      const r = await fetch("/api/wire", { cache: "no-store" });
      if (r.ok) {
        WIRE = await r.json();
        window.__WIRE__ = WIRE;
        return WIRE;
      }
    } catch (_) {}
    WIRE = {
      bots: [],
      chips: [],
      events: [],
      eventDaysUTC: [],
      edges: [],
      stats: { botCount: 0, routineCount: 0, eventCount: 0, lastCollectorAt: "unknown" },
      generatedAt: "unknown",
    };
    return WIRE;
  }

  function renderHealth() {
    const s = WIRE.stats || {};
    const el = $("#healthStrip");
    const items = [
      ["bots", s.botCount ?? "unknown"],
      ["routines", s.routineCount ?? "unknown"],
      ["events", s.eventCount ?? "unknown"],
      ["collector", fmtTime(s.lastCollectorAt || WIRE.generatedAt)],
    ];
    el.innerHTML = items
      .map(([k, v]) => `<span class="pill"><strong>${v}</strong> ${k}</span>`)
      .join("");
    $("#footMeta").textContent =
      `Agent Wire · ${s.botCount || 0} bots · generated ${fmtTime(WIRE.generatedAt)}`;
  }

  /* ---------- tabs ---------- */
  function setView(name) {
    state.view = name;
    if (location.hash.replace(/^#/, "") !== name) {
      try { history.replaceState(null, "", "#" + name); } catch (_) {}
    }
    $$(".tab").forEach((t) => {
      const on = t.dataset.view === name;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    $$(".view").forEach((v) => {
      const on = v.id === "view-" + name;
      v.hidden = !on;
      v.classList.toggle("active", on);
    });
    if (name === "rain") startRain();
    else stopRain();
    if (name === "graph") startGraph();
    else stopGraph();
    if (name === "timeline") renderTimeline();
  }

  /* ---------- Wire Rain ---------- */
  function chipColor(kind) {
    return KIND_COLOR[kind] || KIND_COLOR.other;
  }

  function buildParticles() {
    const chips = WIRE.chips || [];
    const canvas = $("#rainCanvas");
    const w = canvas.width;
    const h = canvas.height;
    const pool = chips.length ? chips : [];
    const n = Math.min(90, Math.max(24, pool.length || 24));
    const particles = [];
    for (let i = 0; i < n; i++) {
      const c = pool.length ? pool[i % pool.length] : { kind: "other", bot: "unknown", detail: "no events" };
      const vertical = Math.random() > 0.35;
      particles.push({
        chip: c,
        x: Math.random() * w,
        y: Math.random() * h,
        vx: vertical ? (Math.random() - 0.5) * 0.15 : 0.6 + Math.random() * 1.4,
        vy: vertical ? 0.5 + Math.random() * 1.8 : (Math.random() - 0.5) * 0.2,
        vertical,
        life: Math.random(),
      });
    }
    state.rain.particles = particles;
  }

  function drawRain() {
    const canvas = $("#rainCanvas");
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = "rgba(5,10,15,0.22)";
    ctx.fillRect(0, 0, w, h);

    // faint grid
    ctx.strokeStyle = "rgba(0,255,156,0.04)";
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 48) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const spd = state.rain.speed;
    for (const p of state.rain.particles) {
      if (!state.rain.pause) {
        p.x += p.vx * spd;
        p.y += p.vy * spd;
        if (p.y > h + 40) {
          p.y = -40;
          p.x = Math.random() * w;
        }
        if (p.x > w + 120) {
          p.x = -120;
          p.y = Math.random() * h;
        }
        if (p.x < -120) p.x = w + 40;
        if (p.y < -40) p.y = h + 20;
      }
      const c = p.chip;
      const col = chipColor(c.kind);
      const label = `${c.bot || "unknown"} · ${c.kind} · ${c.detail || ""}`.slice(0, 42);
      ctx.font = "600 11px IBM Plex Mono, ui-monospace, monospace";
      const tw = ctx.measureText(label).width + 18;
      const th = 22;
      // glow
      ctx.shadowColor = col;
      ctx.shadowBlur = 12;
      ctx.fillStyle = "rgba(8,18,28,0.92)";
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.2;
      roundRect(ctx, p.x, p.y, tw, th, 6);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = col;
      ctx.fillText(label, p.x + 9, p.y + 14);
    }

    // scan beam
    const t = (performance.now() / 18) % h;
    const g = ctx.createLinearGradient(0, t - 40, 0, t + 40);
    g.addColorStop(0, "rgba(0,212,255,0)");
    g.addColorStop(0.5, "rgba(0,212,255,0.07)");
    g.addColorStop(1, "rgba(0,212,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, t - 40, w, 80);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function rainLoop() {
    drawRain();
    state.rain.raf = requestAnimationFrame(rainLoop);
  }

  function startRain() {
    stopRain();
    sizeCanvas($("#rainCanvas"), $("#rainStage"));
    buildParticles();
    $("#rainBadge").textContent = `${(WIRE.chips || []).length} chips`;
    const ctx = $("#rainCanvas").getContext("2d");
    ctx.fillStyle = "#050a0f";
    ctx.fillRect(0, 0, $("#rainCanvas").width, $("#rainCanvas").height);
    rainLoop();
  }

  function stopRain() {
    if (state.rain.raf) cancelAnimationFrame(state.rain.raf);
    state.rain.raf = 0;
  }

  function sizeCanvas(canvas, stage) {
    const rect = stage.getBoundingClientRect();
    const w = Math.max(640, Math.floor(rect.width) || 1400);
    const h = Math.max(420, Math.min(720, Math.floor(w * 0.52)));
    canvas.width = w;
    canvas.height = h;
  }

  /* ---------- Fleet Graph ---------- */
  function initGraph() {
    const bots = WIRE.bots || [];
    const edges = WIRE.edges || [];
    const canvas = $("#graphCanvas");
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const R = Math.min(cx, cy) * 0.72;
    const nodes = bots.map((b, i) => {
      const a = (i / Math.max(bots.length, 1)) * Math.PI * 2 - Math.PI / 2;
      return {
        id: b.id,
        bot: b,
        x: cx + Math.cos(a) * R * (0.55 + (i % 3) * 0.12),
        y: cy + Math.sin(a) * R * (0.55 + (i % 3) * 0.12),
        vx: 0,
        vy: 0,
        color: avatarColor(b.avatarColor),
      };
    });
    state.graph.nodes = nodes;
    state.graph.edges = edges;
    const kind = edges[0] ? edges[0].kind : "none";
    $("#graphHint").textContent =
      kind === "cooccurrence"
        ? "Force graph · edges = agent_msg co-occurrence from fleet.json"
        : kind === "heuristic"
          ? "Force/radial graph · edges = same-household heuristic (no co-occurrence data)"
          : "Radial layout from real profile.json bots · no edges";
    const side = $("#graphSide");
    side.innerHTML =
      `<h3>Roster (${bots.length})</h3><div class="node-list">` +
      bots
        .map(
          (b) =>
            `<button type="button" data-id="${escapeAttr(b.id)}"><strong>${escapeHtml(
              b.name
            )}</strong><br><span style="color:var(--muted)">${escapeHtml(b.title)}</span></button>`
        )
        .join("") +
      `</div>`;
    side.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => openDrawer(btn.dataset.id));
    });
  }

  function stepGraph() {
    const nodes = state.graph.nodes;
    const edges = state.graph.edges;
    const canvas = $("#graphCanvas");
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

    // repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i],
          b = nodes[j];
        let dx = a.x - b.x,
          dy = a.y - b.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = 1800 / (dist * dist);
        dx = (dx / dist) * f;
        dy = (dy / dist) * f;
        a.vx += dx;
        a.vy += dy;
        b.vx -= dx;
        b.vy -= dy;
      }
    }
    // attraction along edges
    for (const e of edges) {
      const a = byId[e.source],
        b = byId[e.target];
      if (!a || !b) continue;
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const ideal = e.kind === "heuristic" ? 160 : Math.max(80, 200 - (e.weight || 1) * 4);
      const f = (dist - ideal) * 0.01 * Math.min(3, e.weight || 1);
      const fx = (dx / dist) * f,
        fy = (dy / dist) * f;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
    // mild center pull
    for (const n of nodes) {
      n.vx += (cx - n.x) * 0.002;
      n.vy += (cy - n.y) * 0.002;
      n.vx *= 0.85;
      n.vy *= 0.85;
      n.x += n.vx;
      n.y += n.vy;
      n.x = Math.max(40, Math.min(canvas.width - 40, n.x));
      n.y = Math.max(40, Math.min(canvas.height - 40, n.y));
    }
  }

  function drawGraph() {
    const canvas = $("#graphCanvas");
    const ctx = canvas.getContext("2d");
    const nodes = state.graph.nodes;
    const edges = state.graph.edges;
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    ctx.fillStyle = "#060e16";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const e of edges) {
      const a = byId[e.source],
        b = byId[e.target];
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle =
        e.kind === "cooccurrence"
          ? `rgba(0,255,156,${Math.min(0.55, 0.12 + (e.weight || 1) * 0.03)})`
          : "rgba(0,212,255,0.18)";
      ctx.lineWidth = e.kind === "cooccurrence" ? Math.min(3, 0.6 + (e.weight || 1) * 0.08) : 1;
      ctx.stroke();
    }

    for (const n of nodes) {
      const r = 16;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 4, 0, Math.PI * 2);
      ctx.fillStyle = n.color + "33";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = n.color;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#04110c";
      ctx.font = "700 10px IBM Plex Mono, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(initials(n.bot.name), n.x, n.y);
      ctx.fillStyle = "#d7fff0";
      ctx.font = "600 11px IBM Plex Sans, sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText(n.bot.name, n.x, n.y + r + 6);
      ctx.textAlign = "left";
    }
  }

  function graphLoop() {
    stepGraph();
    drawGraph();
    state.graph.raf = requestAnimationFrame(graphLoop);
  }

  function startGraph() {
    stopGraph();
    sizeCanvas($("#graphCanvas"), $(".graph-stage"));
    initGraph();
    graphLoop();
  }

  function stopGraph() {
    if (state.graph.raf) cancelAnimationFrame(state.graph.raf);
    state.graph.raf = 0;
  }

  /* ---------- Bot Cards ---------- */
  function renderCards() {
    const q = state.filter.trim().toLowerCase();
    const bots = (WIRE.bots || []).filter((b) => {
      if (!q) return true;
      return (
        b.name.toLowerCase().includes(q) ||
        String(b.title).toLowerCase().includes(q) ||
        String(b.blurb).toLowerCase().includes(q)
      );
    });
    const grid = $("#cardGrid");
    if (!bots.length) {
      grid.innerHTML = `<div class="empty"><p>No bots match.</p></div>`;
      return;
    }
    grid.innerHTML = bots
      .map((b) => {
        const col = avatarColor(b.avatarColor);
        return `<article class="bot-card" data-id="${escapeAttr(b.id)}" tabindex="0" role="button">
          <div class="av" style="background:${col}">${escapeHtml(initials(b.name))}</div>
          <h3>${escapeHtml(b.name)}</h3>
          <p class="title">${escapeHtml(b.title || "unknown")}</p>
          <div class="meta">
            <span class="chip">${b.routineCount || 0} routines</span>
            <span class="chip">${b.eventCount != null ? b.eventCount + " events" : "events unknown"}</span>
            <span class="chip">${escapeHtml(b.avatarShape || "unknown")}</span>
          </div>
        </article>`;
      })
      .join("");
    grid.querySelectorAll(".bot-card").forEach((card) => {
      const open = () => openDrawer(card.dataset.id);
      card.addEventListener("click", open);
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });
    });
  }

  function openDrawer(id) {
    const b = (WIRE.bots || []).find((x) => x.id === id);
    if (!b) return;
    const body = $("#drawerBody");
    const routines = b.routines || [];
    body.innerHTML = `
      <h2>${escapeHtml(b.name)}</h2>
      <p class="sub">${escapeHtml(b.title || "unknown")}</p>
      <p class="blurb">${escapeHtml(b.blurb || "unknown")}</p>
      <dl style="margin-top:1rem">
        <dt>id</dt><dd>${escapeHtml(b.id)}</dd>
        <dt>serverId</dt><dd>${escapeHtml(b.serverId || "unknown")}</dd>
        <dt>color</dt><dd>${escapeHtml(b.avatarColor || "unknown")}</dd>
        <dt>shape</dt><dd>${escapeHtml(b.avatarShape || "unknown")}</dd>
        <dt>harness</dt><dd>${escapeHtml(b.harness || "unknown")}</dd>
        <dt>namedBy</dt><dd>${escapeHtml(b.namedBy || "unknown")}</dd>
        <dt>events</dt><dd>${b.eventCount != null ? b.eventCount : "unknown"}</dd>
        <dt>chats</dt><dd>${b.chatCount != null ? b.chatCount : "unknown"}</dd>
        <dt>building</dt><dd>${escapeHtml(b.building || "unknown")}</dd>
      </dl>
      <h3 style="margin:1.1rem 0 .35rem;font-family:var(--font);font-size:.85rem;color:var(--cyan)">Routines (${routines.length})</h3>
      ${
        routines.length
          ? `<ul>${routines
              .map(
                (r) =>
                  `<li><strong style="color:var(--text)">${escapeHtml(r.name)}</strong> · cron ${escapeHtml(
                    String(r.schedule)
                  )} · enabled ${escapeHtml(String(r.enabled))}</li>`
              )
              .join("")}</ul>`
          : `<p class="muted">No automation folders readable for this bot (or count is zero).</p>`
      }
    `;
    $("#botDrawer").hidden = false;
    $("#backdrop").hidden = false;
  }

  function closeDrawer() {
    $("#botDrawer").hidden = true;
    $("#backdrop").hidden = true;
  }

  /* ---------- Timeline ---------- */
  function renderTimeline() {
    const days = WIRE.eventDaysUTC || [];
    state.tl.days = days;
    const empty = $("#timelineEmpty");
    const wrap = $("#timelineWrap");
    if (!days.length) {
      empty.hidden = false;
      wrap.hidden = true;
      return;
    }
    empty.hidden = true;
    wrap.hidden = false;
    const scrub = $("#tlScrub");
    scrub.max = String(Math.max(0, days.length - 1));
    if (state.tl.dayIdx > days.length - 1) state.tl.dayIdx = days.length - 1;
    scrub.value = String(state.tl.dayIdx);
    paintDay();
  }

  function paintDay() {
    const days = state.tl.days;
    if (!days.length) return;
    const day = days[state.tl.dayIdx];
    $("#tlDayLabel").textContent = fmtDay(day);
    $("#tlScrub").value = String(state.tl.dayIdx);

    const events = (WIRE.events || []).filter((e) => (e.ts || "").slice(0, 10) === day);
    const hours = Array.from({ length: 24 }, () => 0);
    for (const e of events) {
      try {
        const h = new Date(e.ts).getUTCHours();
        if (h >= 0 && h < 24) hours[h]++;
      } catch (_) {}
    }
    const max = Math.max(1, ...hours);
    $("#tlBars").innerHTML = hours
      .map((c, h) => {
        const pct = Math.max(4, (c / max) * 100);
        return `<div class="bar" style="height:${c ? pct : 2}%" data-h="${String(h).padStart(2, "0")}Z · ${c}" title="${h}:00 UTC · ${c} events"></div>`;
      })
      .join("");

    const nameById = Object.fromEntries((WIRE.bots || []).map((b) => [b.id, b.name]));
    const feed = events.slice(-120).reverse();
    $("#tlFeed").innerHTML = feed.length
      ? feed
          .map((e) => {
            const t = (e.ts || "").slice(11, 19) || "??:??:??";
            const bot = nameById[e.bot] || "unknown";
            const detail = e.tool || e.app || e.host || e.type || "unknown";
            return `<div class="tl-row"><span class="t">${escapeHtml(t)}</span><span class="k">${escapeHtml(
              e.type || "unknown"
            )}</span><span>${escapeHtml(bot)} · ${escapeHtml(String(detail))}</span></div>`;
          })
          .join("")
      : `<div class="tl-row"><span class="t">—</span><span class="k">empty</span><span>No events stored for this UTC day in the capped snapshot.</span></div>`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  /* ---------- boot ---------- */
  async function boot() {
    await loadWire();
    renderHealth();
    renderCards();
    renderTimeline();

    $$(".tab").forEach((t) => t.addEventListener("click", () => setView(t.dataset.view)));
    $("#rainPause").addEventListener("change", (e) => {
      state.rain.pause = e.target.checked;
    });
    $("#rainSpeed").addEventListener("input", (e) => {
      state.rain.speed = parseFloat(e.target.value) || 1;
    });
    $("#cardFilter").addEventListener("input", (e) => {
      state.filter = e.target.value;
      renderCards();
    });
    $("#drawerClose").addEventListener("click", closeDrawer);
    $("#backdrop").addEventListener("click", closeDrawer);
    $("#tlPrev").addEventListener("click", () => {
      if (state.tl.dayIdx > 0) {
        state.tl.dayIdx--;
        paintDay();
      }
    });
    $("#tlNext").addEventListener("click", () => {
      if (state.tl.dayIdx < state.tl.days.length - 1) {
        state.tl.dayIdx++;
        paintDay();
      }
    });
    $("#tlScrub").addEventListener("input", (e) => {
      state.tl.dayIdx = parseInt(e.target.value, 10) || 0;
      paintDay();
    });
    window.addEventListener("resize", () => {
      if (state.view === "rain") startRain();
      if (state.view === "graph") startGraph();
    });

    // Start on a recent day with activity if possible
    const days = WIRE.eventDaysUTC || [];
    if (days.length) state.tl.dayIdx = days.length - 1;

    const hash = (location.hash || "").replace(/^#/, "");
    const allowed = ["rain", "graph", "cards", "timeline"];
    setView(allowed.includes(hash) ? hash : "rain");
    window.addEventListener("hashchange", () => {
      const h = (location.hash || "").replace(/^#/, "");
      if (allowed.includes(h)) setView(h);
    });
  }

  boot();
})();
