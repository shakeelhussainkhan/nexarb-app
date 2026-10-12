// Offline harness for the Buy Box rotation history pure logic.
// Run: node --loader ./scripts/alias-loader.mjs scripts/verify-buybox-history.mjs
// Pure-logic tests — NO network, NO database.
import {
  buyboxWinRate,
  currentStreak,
  normalizeWinner,
  sortObservations,
} from "@/lib/engine/buyboxHistory.ts";

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name} ${detail}`);
  }
}

const obs = (winner, at, sellPrice = 10) => ({ checkedAt: at, sellPrice, winner });

// --- normalizeWinner -------------------------------------------------------
check("normalize: us", normalizeWinner("us") === "us");
check("normalize: competitor", normalizeWinner("competitor") === "competitor");
check("normalize: null -> unknown", normalizeWinner(null) === "unknown");
check("normalize: garbage -> unknown", normalizeWinner("maybe") === "unknown");
check("normalize: undefined -> unknown", normalizeWinner(undefined) === "unknown");

// --- buyboxWinRate -----------------------------------------------------------
{
  const r = buyboxWinRate([
    obs("us", "2026-10-01T00:00:00Z"),
    obs("us", "2026-10-02T00:00:00Z"),
    obs("competitor", "2026-10-03T00:00:00Z"),
    obs("competitor", "2026-10-04T00:00:00Z"),
  ]);
  check("winrate: 2/4 = 0.5", r.winRate === 0.5, `got ${r.winRate}`);
  check("winrate: wins/losses", r.wins === 2 && r.losses === 2);
  check("winrate: total", r.total === 4 && r.unknowns === 0);
}
{
  const r = buyboxWinRate([
    obs("us", "2026-10-01T00:00:00Z"),
    obs("unknown", "2026-10-02T00:00:00Z"),
    obs("competitor", "2026-10-03T00:00:00Z"),
  ]);
  check("winrate: unknowns excluded (1/2)", r.winRate === 0.5, `got ${r.winRate}`);
  check("winrate: unknowns counted separately", r.unknowns === 1 && r.total === 3);
}
{
  const r = buyboxWinRate([]);
  check("winrate: empty -> null", r.winRate === null && r.total === 0);
}
{
  const r = buyboxWinRate([obs("unknown", "2026-10-01T00:00:00Z"), obs(null, "2026-10-02T00:00:00Z")]);
  check("winrate: all unknown -> null", r.winRate === null && r.unknowns === 2);
}
{
  const r = buyboxWinRate([obs("us", "2026-10-01T00:00:00Z")]);
  check("winrate: single us -> 1", r.winRate === 1);
}

// --- currentStreak -----------------------------------------------------------
{
  const s = currentStreak([
    obs("competitor", "2026-10-01T00:00:00Z"),
    obs("us", "2026-10-02T00:00:00Z"),
    obs("us", "2026-10-03T00:00:00Z"),
    obs("us", "2026-10-04T00:00:00Z"),
  ]);
  check("streak: us x3", s.winner === "us" && s.count === 3, JSON.stringify(s));
}
{
  const s = currentStreak([
    obs("us", "2026-10-01T00:00:00Z"),
    obs("competitor", "2026-10-02T00:00:00Z"),
  ]);
  check("streak: competitor x1", s.winner === "competitor" && s.count === 1);
}
{
  const s = currentStreak([
    obs("us", "2026-10-01T00:00:00Z"),
    obs("unknown", "2026-10-02T00:00:00Z"),
  ]);
  check("streak: latest unknown -> null winner", s.winner === null && s.count === 0, JSON.stringify(s));
}
{
  const s = currentStreak([]);
  check("streak: empty -> null/0", s.winner === null && s.count === 0);
}
{
  // Unsorted input must still streak correctly.
  const s = currentStreak([
    obs("us", "2026-10-04T00:00:00Z"),
    obs("competitor", "2026-10-01T00:00:00Z"),
    obs("us", "2026-10-03T00:00:00Z"),
  ]);
  check("streak: unsorted input handled", s.winner === "us" && s.count === 2, JSON.stringify(s));
}
{
  const sorted = sortObservations([
    obs("us", "2026-10-03T00:00:00Z"),
    obs("us", "2026-10-01T00:00:00Z"),
  ]);
  check("sort: oldest first", sorted[0].checkedAt < sorted[1].checkedAt);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
