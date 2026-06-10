// ============================================================
//  Sincronizare rezultate finale CM 2026
//  Sursă: football-data.org  →  Țintă: tabelul Supabase "results"
//  Rulează în GitHub Actions (vezi .github/workflows/sync-results.yml)
//  Scrie DOAR meciurile din grupe care au status FINISHED.
// ============================================================

import { readFileSync } from "node:fs";

const FD_TOKEN = process.env.FOOTBALL_DATA_TOKEN;      // token-ul tău football-data.org
const SB_URL   = process.env.SUPABASE_URL;             // https://xxxx.supabase.co
const SB_KEY   = process.env.SUPABASE_SERVICE_KEY;     // cheia SECRET (sb_secret_...)

if (!FD_TOKEN || !SB_URL || !SB_KEY) {
  console.error("❌ Lipsesc variabile de mediu (FOOTBALL_DATA_TOKEN / SUPABASE_URL / SUPABASE_SERVICE_KEY).");
  process.exit(1);
}

// Numele tale (RO) -> codul FIFA de 3 litere (TLA) folosit de football-data.org
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

// cheie independentă de ordinea gazdă/oaspete (fiecare pereche joacă o dată în grupe)
const pairKey = (a, b) => [a, b].sort().join("-");

// ---- 1) construiește lookup din PROPRIUL program (data.json = sursa de adevăr) ----
const data = JSON.parse(readFileSync("./data.json", "utf8"));
const lookup = new Map();
for (const m of data.matches) {
  const h = TLA[m.home], a = TLA[m.away];
  if (!h || !a) { console.warn("⚠️  Fără cod TLA pentru:", m.home, "/", m.away); continue; }
  lookup.set(pairKey(h, a), { id: m.id, homeTla: h });
}

// ---- 2) ia de la football-data.org meciurile din grupe TERMINATE ----
const res = await fetch(
  "https://api.football-data.org/v4/competitions/WC/matches?status=FINISHED",
  { headers: { "X-Auth-Token": FD_TOKEN } }
);
if (!res.ok) {
  console.error("❌ Eroare football-data.org:", res.status, await res.text());
  process.exit(1);
}
const fd = await res.json();
const finished = (fd.matches || []).filter(m => m.stage === "GROUP_STAGE");

// ---- 3) mapează + orientează scorul la gazda/oaspetele TĂU ----
const rows = [];
const unmapped = [];
for (const m of finished) {
  const H = m.homeTeam?.tla, A = m.awayTeam?.tla;
  const fh = m.score?.fullTime?.home, fa = m.score?.fullTime?.away;
  if (H == null || A == null || fh == null || fa == null) continue;
  const hit = lookup.get(pairKey(H, A));
  if (!hit) { unmapped.push(`${H}-${A}`); continue; }
  const sameOrder = hit.homeTla === H;            // gazda lor == gazda ta?
  rows.push({
    match_id:   hit.id,
    home_score: sameOrder ? fh : fa,
    away_score: sameOrder ? fa : fh,
    updated_at: new Date().toISOString(),
  });
}

if (unmapped.length)
  console.warn("⚠️  Meciuri terminate dar NEMAPATE (verifică codurile TLA):", unmapped.join(", "));
if (rows.length === 0) { console.log("ℹ️  Niciun rezultat final de scris deocamdată."); process.exit(0); }

// ---- 4) upsert în Supabase (cheia secret ocolește RLS) ----
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
