// ============================================================
//  Sincronizare rezultate finale CM 2026
//  Sursă: football-data.org  →  Țintă: tabelul Supabase "results"
//  Scrie meciurile cu scor final; loghează exact ce întoarce API-ul.
// ============================================================

import { readFileSync } from "node:fs";

const FD_TOKEN = process.env.FOOTBALL_DATA_TOKEN;
const SB_URL   = process.env.SUPABASE_URL;
const SB_KEY   = process.env.SUPABASE_SERVICE_KEY;

if (!FD_TOKEN || !SB_URL || !SB_KEY) {
  console.error("❌ Lipsesc variabile de mediu (FOOTBALL_DATA_TOKEN / SUPABASE_URL / SUPABASE_SERVICE_KEY).");
  process.exit(1);
}

// Numele tale (RO) -> codul FIFA de 3 litere (TLA)
const TLA = {
  "Mexic":"MEX","Coreea de Sud":"KOR","Africa de Sud":"RSA","Cehia":"CZE",
  "Canada":"CAN","Elveția":"SUI","Qatar":"QAT","Bosnia și Herțegovina":"BIH",
  "Brazilia":"BRA","Maroc":"MAR","Scoția":"SCO","Haiti":"HAI",
  "SUA":"USA","Australia":"AUS","Paraguay":"PAR","Turcia":"TUR",
  "Germania":"GER","Ecuador":"ECU","Coasta de Fildeș":"CIV","Curaçao":"CUW",
  "Olanda":"NED","Japonia":"JPN","Tunisia":"TUN","Suedia":"SWE",
  "Belgia":"BEL","Iran":"IRN","Egipt":"EGY","Noua Zeelandă":"NZL",
  "Spania":"ESP","Uruguay":"URU","Arabia Saudită":"KSA","Capul Verde":"CPV",
  "Franța":"FRA","Senegal":"SEN","Norvegia":"NOR","Irak":"IRQ",
  "Argentina":"ARG","Austria":"AUT","Algeria":"ALG","Iordania":"JOR",
  "Portugalia":"POR","Columbia":"COL","Uzbekistan":"UZB","RD Congo":"COD",
  "Anglia":"ENG","Croația":"CRO","Panama":"PAN","Ghana":"GHA",
};
const pairKey = (a, b) => [a, b].sort().join("-");

// ---- lookup din PROPRIUL program ----
const data = JSON.parse(readFileSync("./data.json", "utf8"));
const lookup = new Map();
for (const m of data.matches) {
  if (m.phase === "ko") continue;            // play-off → introdus manual de admin
  const h = TLA[m.home], a = TLA[m.away];
  if (!h || !a) { console.warn("⚠️  Fără cod TLA pentru:", m.home, "/", m.away); continue; }
  lookup.set(pairKey(h, a), { id: m.id, homeTla: h });
}

// ---- ia TOATE meciurile (fără filtru), ca să putem diagnostica ----
const res = await fetch(
  "https://api.football-data.org/v4/competitions/WC/matches",
  { headers: { "X-Auth-Token": FD_TOKEN } }
);
if (!res.ok) {
  console.error("❌ Eroare football-data.org:", res.status, await res.text());
  process.exit(1);
}
const fd = await res.json();
const all = fd.matches || [];

console.log("🏆 Competiție:", fd.competition?.name, "| cod:", fd.competition?.code);
if (all[0]?.season) console.log("📅 Sezon:", all[0].season.startDate, "→", all[0].season.endDate);
console.log("🔢 Meciuri primite:", all.length);
const byStatus = {};
for (const m of all) byStatus[m.status] = (byStatus[m.status] || 0) + 1;
console.log("📊 După status:", JSON.stringify(byStatus));
const stages = [...new Set(all.map(m => m.stage))];
console.log("🧩 Etape (stage) văzute:", stages.join(", "));
for (const m of all.filter(m => m.status === "FINISHED" || m.status === "AWARDED"))
  console.log("   ↳", m.homeTeam?.name, "vs", m.awayTeam?.name,
              "| status:", m.status, "| fullTime:", JSON.stringify(m.score?.fullTime));

// ---- meci „final” = FINISHED sau AWARDED, cu scor pe fullTime ----
const isFinal = m =>
  (m.status === "FINISHED" || m.status === "AWARDED") &&
  m.score?.fullTime?.home != null && m.score?.fullTime?.away != null;
const finished = all.filter(isFinal);
console.log("✔️  Meciuri terminate cu scor:", finished.length);

// ---- mapează la match_id-urile tale ----
const rows = [];
const unmapped = [];
for (const m of finished) {
  const H = m.homeTeam?.tla, A = m.awayTeam?.tla;
  const fh = m.score.fullTime.home, fa = m.score.fullTime.away;
  const label = `${m.homeTeam?.name} ${fh}-${fa} ${m.awayTeam?.name}`;
  if (H == null || A == null) { unmapped.push(`(fără TLA) ${label}`); continue; }
  const hit = lookup.get(pairKey(H, A));
  if (!hit) { unmapped.push(`${H}-${A} (${label})`); continue; }
  const sameOrder = hit.homeTla === H;
  rows.push({
    match_id:   hit.id,
    home_score: sameOrder ? fh : fa,
    away_score: sameOrder ? fa : fh,
    updated_at: new Date().toISOString(),
  });
}

if (unmapped.length)
  console.warn("⚠️  Terminate dar NEMAPATE:", unmapped.join("  |  "));
if (rows.length === 0) { console.log("ℹ️  Niciun rezultat de scris."); process.exit(0); }

// ---- upsert în Supabase ----
const up = await fetch(`${SB_URL}/rest/v1/results?on_conflict=match_id`, {
  method: "POST",
  headers: {
    "apikey":        SB_KEY,
    "Authorization": `Bearer ${SB_KEY}`,
    "Content-Type":  "application/json",
    "Prefer":        "resolution=merge-duplicates,return=minimal",
  },
  body: JSON.stringify(rows),
});
if (!up.ok) {
  console.error("❌ Eroare upsert Supabase:", up.status, await up.text());
  process.exit(1);
}
console.log(`✅ ${rows.length} rezultate sincronizate în results.`);
