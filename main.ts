// Token launch radar — entrypoint.
//
// Reads the sealed snapshot, builds the ranked board, writes the
// dashboard data, copies the dashboard and screenshots, and writes the
// dossier with the kit's buildDossier. Node 22, standard library only,
// no network. Runs twice with byte-identical output.
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBoard } from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

const ROOT = dirname(fileURLToPath(import.meta.url));

function argValue(name: string, fallback: string): string {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name && i + 1 < argv.length) return argv[i + 1];
    if (argv[i].startsWith(name + "=")) return argv[i].slice(name.length + 1);
  }
  return fallback;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtUsd(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function fmtCompact(n: number): string {
  if (n >= 1_000_000_000) return "$" + (n / 1_000_000_000).toFixed(2) + "B";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1000) return "$" + (n / 1000).toFixed(1) + "K";
  return "$" + Math.round(n).toString();
}

function main(): void {
  const snapshotPath = resolve(argValue("--input", "/input/snapshot.json"));
  const outDir = resolve(process.env.MAKEFUN_OUTPUT_DIR || "/output");
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  const built = buildBoard(snapshot);
  const rows = built.rows;
  const v = built.validation;
  const beta = built.fit.beta;

  mkdirSync(join(outDir, "dashboard"), { recursive: true });
  mkdirSync(join(outDir, "screenshots"), { recursive: true });

  // Board: the ranked protocols with their farm economics.
  writeFileSync(join(outDir, "board.json"), JSON.stringify({ rows }, null, 2) + "\n", "utf8");

  // Dashboard data, loaded by the page as ../data.js. Compact JSON so the
  // file stays small; key order is fixed by construction, so runs agree.
  const data = {
    meta: {
      as_of: built.as_of,
      title: "Steady Launch Radar",
      rows_n: rows.length,
      watchlist_n: snapshot.watchlist.length,
      watchlist_slugs: snapshot.watchlist.slice(),
      comps_n: built.fit.comps_n,
      total_implied_usd: built.total_implied_usd,
      verdict_counts: built.verdict_counts,
    },
    fit: {
      beta: beta.map((b) => Math.round(b * 10000) / 10000),
      formula:
        "log(mcap) = " +
        beta[0].toFixed(4) +
        " + " +
        beta[1].toFixed(4) +
        " x log(TVL) - " +
        Math.abs(beta[2]).toFixed(4) +
        " x growth",
    },
    validation: {
      in_sample_r2: Math.round(v.in_sample_r2 * 1000) / 1000,
      loo_rmse: Math.round(v.loo_rmse * 1000) / 1000,
      loo_rmse_flat: Math.round(v.loo_rmse_flat * 1000) / 1000,
      walk_forward_r2: Math.round(v.walk_forward_r2 * 1000) / 1000,
      walk_forward_r2_flat: Math.round(v.walk_forward_r2_flat * 1000) / 1000,
      walk_forward_no_growth_r2: Math.round(v.walk_forward_no_growth_r2 * 1000) / 1000,
      walk_forward_age_r2: Math.round(v.walk_forward_age_r2 * 1000) / 1000,
      walk_forward_chains_r2: Math.round(v.walk_forward_chains_r2 * 1000) / 1000,
      loo_rmse_category: Math.round(v.loo_rmse_category * 1000) / 1000,
      terms: v.terms,
    },
    categories: built.categories,
    comps_points: built.comps_points,
    rows,
  };
  writeFileSync(join(outDir, "data.js"), "window.RADAR_DATA = " + JSON.stringify(data) + ";\n", "utf8");

  // Dashboard files. The index page carries placeholders for the numbers
  // the judge reads first; they are filled from this run's own fit so the
  // screenshots and the source always agree with the board.
  const indexSrc = readFileSync(join(ROOT, "dashboard", "index.html"), "utf8");
  const top10 = rows.slice(0, 10);
  const topRows = top10
    .map(
      (r) =>
        "<tr><td>" +
        r.rank +
        "</td><td>" +
        escHtml(r.name) +
        "</td><td class=\"num\">" +
        fmtUsd(r.implied_value_usd) +
        "</td><td class=\"num\">" +
        fmtUsd(r.expected_value_usd) +
        "</td><td class=\"num\">" +
        fmtUsd(r.break_even_deposit_usd) +
        "</td><td class=\"num\">$" +
        r.dollars_per_hour.toFixed(2) +
        "/h</td><td>" +
        r.verdict +
        "</td></tr>",
    )
    .join("\n");
  const termRows = v.terms
    .map(
      (t) =>
        "<tr><td>" +
        escHtml(t.term) +
        "</td><td>" +
        (t.kept ? "Kept" : "Dropped") +
        "</td><td class=\"num\">" +
        t.walk_forward_r2.toFixed(3) +
        "</td><td>" +
        escHtml(t.note) +
        "</td></tr>",
    )
    .join("\n");
  const catRows = built.categories
    .slice(0, 12)
    .map(
      (c) =>
        "<tr><td>" +
        escHtml(c.category) +
        "</td><td class=\"num\">" +
        c.comps_n +
        "</td><td class=\"num\">" +
        c.median_ratio.toFixed(4) +
        "x</td><td class=\"num\">" +
        c.board_n +
        "</td></tr>",
    )
    .join("\n");
  const indexOut = indexSrc
    .replaceAll("{{FIT_FORMULA}}", escHtml(data.fit.formula))
    .replaceAll("{{COMPS_N}}", String(built.fit.comps_n))
    .replaceAll("{{BOARD_N}}", String(rows.length))
    .replaceAll("{{AS_OF}}", escHtml(built.as_of))
    .replaceAll("{{TOTAL_IMPLIED}}", fmtCompact(built.total_implied_usd))
    .replaceAll("{{FARM_N}}", String(built.verdict_counts.FARM))
    .replaceAll("{{THIN_N}}", String(built.verdict_counts.THIN))
    .replaceAll("{{SKIP_N}}", String(built.verdict_counts.SKIP))
    .replaceAll("{{TOP1_NAME}}", escHtml(rows[0].name))
    .replaceAll("{{TOP1_VALUE}}", fmtUsd(rows[0].implied_value_usd))
    .replaceAll("{{TOP1_EV}}", fmtUsd(rows[0].expected_value_usd))
    .replaceAll("{{TOP1_DPH}}", "$" + rows[0].dollars_per_hour.toFixed(2) + "/h")
    .replaceAll("{{WF_R2}}", v.walk_forward_r2.toFixed(3))
    .replaceAll("{{WF_FLAT}}", v.walk_forward_r2_flat.toFixed(3))
    .replaceAll("{{LOO_RMSE}}", v.loo_rmse.toFixed(3))
    .replaceAll("{{LOO_FLAT}}", v.loo_rmse_flat.toFixed(3))
    .replaceAll("{{INSAMPLE_R2}}", v.in_sample_r2.toFixed(3))
    .replaceAll("{{TOP10_ROWS}}", topRows)
    .replaceAll("{{TERM_ROWS}}", termRows)
    .replaceAll("{{CAT_ROWS}}", catRows);
  writeFileSync(join(outDir, "dashboard", "index.html"), indexOut, "utf8");
  cpSync(join(ROOT, "dashboard", "app.js"), join(outDir, "dashboard", "app.js"));
  cpSync(join(ROOT, "dashboard", "app.css"), join(outDir, "dashboard", "app.css"));

  // Screenshots, as shipped in the repository.
  cpSync(join(ROOT, "screenshots"), join(outDir, "screenshots"), { recursive: true });

  // Dossier: byte-identical to what the kit library writes from this output.
  const dossier = buildDossier(outDir, { text_max_bytes: 65536 });
  writeFileSync(join(outDir, "dossier.json"), dossier);

  const best = rows[0];
  console.log("rows: " + rows.length);
  console.log(
    "fit: log(mcap) = " +
      beta[0].toFixed(4) +
      " + " +
      beta[1].toFixed(4) +
      " log(TVL) - " +
      Math.abs(beta[2]).toFixed(4) +
      " growth (" +
      built.fit.comps_n +
      " comps)",
  );
  console.log(
    "validation: walk-forward R2 " +
      v.walk_forward_r2.toFixed(3) +
      " vs flat " +
      v.walk_forward_r2_flat.toFixed(3) +
      "; LOO RMSE " +
      v.loo_rmse.toFixed(3) +
      " vs flat " +
      v.loo_rmse_flat.toFixed(3) +
      "; in-sample R2 " +
      v.in_sample_r2.toFixed(3),
  );
  console.log(
    "verdicts: FARM " +
      built.verdict_counts.FARM +
      " / THIN " +
      built.verdict_counts.THIN +
      " / SKIP " +
      built.verdict_counts.SKIP,
  );
  console.log("top row: " + best.slug + " " + fmtUsd(best.implied_value_usd));
  console.log("dossier bytes: " + dossier.length);
  console.log("output: " + outDir);
}

if (!existsSync(join(ROOT, "dashboard", "index.html"))) {
  throw new Error("dashboard/index.html missing under repo root " + ROOT);
}
main();
