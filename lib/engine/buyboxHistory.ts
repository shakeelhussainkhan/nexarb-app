// Buy Box rotation history — pure logic.
//
// Every deal check records whether the live Buy Box (competitive) price
// belonged to us or a competitor (via SP-API's belongsToRequester flag,
// persisted as deal_checks.buybox_winner). These helpers turn a series of
// observations into win-rate and streak stats for the UI.
//
// Never invents data: observations with winner "unknown" are counted
// separately and excluded from win-rate math.

export type BuyBoxWinner = "us" | "competitor" | "unknown";

export interface BuyBoxObservation {
  checkedAt: string; // ISO
  sellPrice: number | null;
  winner: BuyBoxWinner;
}

export interface BuyBoxWinRate {
  /** Fraction of known observations we held the Buy Box, 0..1, or null when no known observations. */
  winRate: number | null;
  wins: number;
  losses: number;
  unknowns: number;
  total: number;
}

export function normalizeWinner(raw: unknown): BuyBoxWinner {
  return raw === "us" || raw === "competitor" ? raw : "unknown";
}

/** Chronological oldest-first sort; tolerant of unsorted input. */
export function sortObservations(obs: BuyBoxObservation[]): BuyBoxObservation[] {
  return [...obs].sort((a, b) => (a.checkedAt < b.checkedAt ? -1 : a.checkedAt > b.checkedAt ? 1 : 0));
}

export function buyboxWinRate(observations: BuyBoxObservation[]): BuyBoxWinRate {
  const obs = sortObservations(observations);
  let wins = 0;
  let losses = 0;
  let unknowns = 0;
  for (const o of obs) {
    const w = normalizeWinner(o.winner);
    if (w === "us") wins++;
    else if (w === "competitor") losses++;
    else unknowns++;
  }
  const known = wins + losses;
  return {
    winRate: known > 0 ? wins / known : null,
    wins,
    losses,
    unknowns,
    total: obs.length,
  };
}

export interface BuyBoxStreak {
  /** Who holds the current streak ("us" | "competitor"), or null when the latest observation is unknown or there are none. */
  winner: "us" | "competitor" | null;
  /** Consecutive same-winner observations counting back from the latest known one. */
  count: number;
}

/**
 * Current streak: walks back from the most recent observation, counting
 * consecutive same-winner observations. "unknown" observations break the
 * streak and yield a null winner when they are the latest.
 */
export function currentStreak(observations: BuyBoxObservation[]): BuyBoxStreak {
  const obs = sortObservations(observations);
  if (obs.length === 0) return { winner: null, count: 0 };
  const latest = normalizeWinner(obs[obs.length - 1].winner);
  if (latest === "unknown") return { winner: null, count: 0 };
  let count = 0;
  for (let i = obs.length - 1; i >= 0; i--) {
    if (normalizeWinner(obs[i].winner) === latest) count++;
    else break;
  }
  return { winner: latest, count };
}
