// Steady Launch Radar — dashboard behaviour. No network: all data comes
// from ../data.js, written by main.ts from the sealed snapshot.
(function () {
  var DATA = window.RADAR_DATA || { rows: [], categories: [], fit: { beta: [0, 0, 0] } };
  var rows = DATA.rows || [];
  var watchlist = new Set((DATA.meta && DATA.meta.watchlist_slugs) || []);
  var state = { sort: "rank", dir: 1, verdict: "ALL", query: "", watchOnly: false };

  function $(id) {
    return document.getElementById(id);
  }

  function fmtUsd(n) {
    return "$" + Math.round(n).toLocaleString("en-US");
  }

  function fmtCompact(n) {
    if (n >= 1000000000) return "$" + (n / 1000000000).toFixed(2) + "B";
    if (n >= 1000000) return "$" + (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return "$" + (n / 1000).toFixed(1) + "K";
    return "$" + Math.round(n);
  }

  function fmtPct(v) {
    if (v === null || v === undefined) return "—";
    var s = (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
    return s;
  }

  function fmtAge(days) {
    if (days === null || days === undefined) return "—";
    if (days < 365) return Math.round(days / 30.46) + "mo";
    return (days / 365.25).toFixed(1) + "y";
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function visibleRows() {
    var q = state.query.trim().toLowerCase();
    var out = rows.filter(function (r) {
      if (state.verdict !== "ALL" && r.verdict !== state.verdict) return false;
      if (state.watchOnly && !watchlist.has(r.slug)) return false;
      if (q && (r.name + " " + r.slug + " " + (r.category || "")).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var key = state.sort;
    out.sort(function (a, b) {
      var av = a[key];
      var bv = b[key];
      if (av === null || av === undefined) av = key === "name" ? "" : -Infinity;
      if (bv === null || bv === undefined) bv = key === "name" ? "" : -Infinity;
      if (typeof av === "string") return av.localeCompare(bv) * state.dir;
      return (av - bv) * state.dir;
    });
    return out;
  }

  function renderBoard() {
    var body = $("board-body");
    var list = visibleRows();
    var html = "";
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      html +=
        '<tr data-slug="' +
        esc(r.slug) +
        '"><td>' +
        r.rank +
        "</td><td><b>" +
        esc(r.name) +
        "</b><br><span class=\"muted\">" +
        esc(r.category || "uncategorised") +
        " · " +
        esc(r.chains.join(", ")) +
        "</span></td><td class=\"num\">" +
        fmtCompact(r.tvl_usd) +
        "</td><td class=\"num\">" +
        fmtPct(r.change_7d) +
        "</td><td class=\"num\">" +
        fmtAge(r.age_days) +
        "</td><td class=\"num\"><b>" +
        fmtUsd(r.implied_value_usd) +
        "</b></td><td class=\"num\">" +
        fmtCompact(r.implied_lo_usd) +
        " – " +
        fmtCompact(r.implied_hi_usd) +
        "</td><td class=\"num\">" +
        r.rank_lo +
        "–" +
        r.rank_hi +
        "</td><td class=\"num\">" +
        fmtUsd(r.expected_value_usd) +
        "</td><td class=\"num\">" +
        fmtUsd(r.break_even_deposit_usd) +
        "</td><td class=\"num\">$" +
        r.dollars_per_hour.toFixed(2) +
        "</td><td><span class=\"v-" +
        r.verdict +
        "\">" +
        r.verdict +
        "</span></td></tr>";
    }
    body.innerHTML = html;
    $("count").textContent =
      list.length + " of " + rows.length + " protocols shown · sorted by " + state.sort + ". Click a row for its farm plan.";
  }

  function renderDetail(slug) {
    var r = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].slug === slug) {
        r = rows[i];
        break;
      }
    }
    var panel = $("detail");
    if (!r) {
      panel.hidden = true;
      return;
    }
    $("detail-title").textContent = "#" + r.rank + " — " + r.name;
    var steps = "";
    for (var s = 0; s < r.farm_steps.length; s++) {
      steps +=
        "<tr><td>Step " +
        (s + 1) +
        "</td><td>" +
        esc(r.farm_steps[s]) +
        "</td></tr>";
    }
    $("detail-body").innerHTML =
      '<div class="detail-grid">' +
      "<div><h3>Value</h3><dl>" +
      "<dt>Implied value</dt><dd>" + fmtUsd(r.implied_value_usd) + "</dd>" +
      "<dt>Interval (P10–P90)</dt><dd>" + fmtUsd(r.implied_lo_usd) + " – " + fmtUsd(r.implied_hi_usd) + "</dd>" +
      "<dt>Rank range across 200 refits</dt><dd>#" + r.rank_lo + " – #" + r.rank_hi + "</dd>" +
      "<dt>Fitted log value</dt><dd>" + r.fitted_log_value.toFixed(4) + "</dd>" +
      "<dt>7-day growth</dt><dd>" + fmtPct(r.change_7d) + "</dd>" +
      "<dt>Age</dt><dd>" + fmtAge(r.age_days) + "</dd>" +
      "</dl></div>" +
      "<div><h3>Farm economics</h3><dl>" +
      "<dt>Verdict</dt><dd><span class=\"v-" + r.verdict + "\">" + r.verdict + "</span></dd>" +
      "<dt>Deposit (sized by TVL)</dt><dd>" + fmtUsd(r.deposit_usd) + "</dd>" +
      "<dt>Expected value</dt><dd>" + fmtUsd(r.expected_value_usd) + "</dd>" +
      "<dt>Cash cost</dt><dd>" + fmtUsd(r.cash_cost_usd) + " ($30 set-up + $5 exit)</dd>" +
      "<dt>Break-even deposit</dt><dd>" + fmtUsd(r.break_even_deposit_usd) + "</dd>" +
      "<dt>Dollars per hour</dt><dd>$" + r.dollars_per_hour.toFixed(2) + "</dd>" +
      "<dt>Timeline</dt><dd>" + r.start_date + " → " + r.end_date + " (" + r.hold_days + " days)</dd>" +
      "</dl></div>" +
      "</div>" +
      "<h3>Farm plan — when, what it costs, how long it takes</h3>" +
      '<table class="board"><thead><tr><th>When</th><th>Step</th></tr></thead><tbody>' +
      steps +
      "</tbody></table>" +
      '<p><a href="#board-panel">Back to the full board</a></p>';
    panel.hidden = false;
  }

  function drawScatter() {
    var cv = $("scatter");
    if (!cv || !cv.getContext) return;
    var ctx = cv.getContext("2d");
    var pts = DATA.comps_points || [];
    var beta = (DATA.fit && DATA.fit.beta) || [0, 0, 0];
    var W = cv.width;
    var H = cv.height;
    ctx.fillStyle = "#0d1420";
    ctx.fillRect(0, 0, W, H);
    if (!pts.length) return;
    var xs = pts.map(function (p) { return p.x; });
    var ys = pts.map(function (p) { return p.y; });
    var x0 = Math.min.apply(null, xs) - 0.5;
    var x1 = Math.max.apply(null, xs) + 0.5;
    var y0 = Math.min.apply(null, ys) - 0.5;
    var y1 = Math.max.apply(null, ys) + 0.5;
    function X(v) { return 44 + ((v - x0) / (x1 - x0)) * (W - 56); }
    function Y(v) { return H - 30 - ((v - y0) / (y1 - y0)) * (H - 44); }
    ctx.strokeStyle = "#223349";
    ctx.beginPath();
    ctx.moveTo(44, 8);
    ctx.lineTo(44, H - 30);
    ctx.lineTo(W - 12, H - 30);
    ctx.stroke();
    ctx.fillStyle = "#8aa0b8";
    ctx.font = "11px sans-serif";
    ctx.fillText("log TVL →", W - 70, H - 12);
    ctx.fillText("log mcap", 4, 18);
    ctx.fillStyle = "#6ea8ff";
    for (var i = 0; i < pts.length; i++) {
      ctx.fillRect(X(pts[i].x) - 1.5, Y(pts[i].y) - 1.5, 3, 3);
    }
    ctx.strokeStyle = "#ffb454";
    ctx.lineWidth = 2;
    ctx.beginPath();
    var gx0 = x0;
    var gx1 = x1;
    ctx.moveTo(X(gx0), Y(beta[0] + beta[1] * gx0));
    ctx.lineTo(X(gx1), Y(beta[0] + beta[1] * gx1));
    ctx.stroke();
    ctx.fillStyle = "#ffb454";
    ctx.fillText("fitted curve (growth = 0)", 52, 22);
    ctx.fillStyle = "#8aa0b8";
    ctx.fillText(pts.length + " traded comparables", 52, 36);
  }

  function applyHash() {
    var h = window.location.hash || "";
    var m = h.match(/^#\/detail\/(.+)$/);
    if (m) {
      renderDetail(decodeURIComponent(m[1]));
      return;
    }
    var f = h.match(/^#\/filter\/(FARM|THIN|SKIP|ALL)$/);
    if (f) {
      state.verdict = f[1];
      syncFilterButtons();
      renderBoard();
    }
  }

  function syncFilterButtons() {
    var btns = document.querySelectorAll(".filters button");
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle("active", btns[i].getAttribute("data-verdict") === state.verdict);
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    // Screenshot modes (?shot=detail / ?shot=board / ?shot=board-top): show
    // one view at the top of the page, still rendered by this same
    // dashboard code. board-top keeps the validation panel and pulls the
    // board rows into the first 900 px, so the first screenshot shows the
    // board itself, not just the panel above it.
    var shot = new URLSearchParams(window.location.search).get("shot");
    if (shot === "detail" || shot === "board" || shot === "board-top") document.body.classList.add("shot-" + shot);
    var search = $("search");
    if (search) {
      search.addEventListener("input", function () {
        state.query = search.value;
        renderBoard();
      });
    }
    var btns = document.querySelectorAll(".filters button");
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener("click", function () {
        state.verdict = this.getAttribute("data-verdict");
        syncFilterButtons();
        renderBoard();
      });
    }
    var wo = $("watch-only");
    if (wo) {
      wo.addEventListener("change", function () {
        state.watchOnly = wo.checked;
        renderBoard();
      });
    }
    var heads = document.querySelectorAll("#board th[data-sort]");
    for (var j = 0; j < heads.length; j++) {
      heads[j].addEventListener("click", function () {
        var k = this.getAttribute("data-sort");
        if (state.sort === k) state.dir = -state.dir;
        else {
          state.sort = k;
          state.dir = k === "rank" ? 1 : -1;
        }
        renderBoard();
      });
    }
    var body = $("board-body");
    if (body) {
      body.addEventListener("click", function (ev) {
        var tr = ev.target.closest("tr[data-slug]");
        if (!tr) return;
        window.location.hash = "#/detail/" + tr.getAttribute("data-slug");
        renderDetail(tr.getAttribute("data-slug"));
      });
    }
    window.addEventListener("hashchange", applyHash);
    drawScatter();
    renderBoard();
    applyHash();
  });
})();
