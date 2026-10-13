// Compliance alert computation (pure). Given the current compliance
// state, decide which alerts should fire, each with a stable dedupe key
// so the runner can avoid spamming: the same key is not re-sent inside
// its cooldown window (the runner enforces cooldowns via
// compliance_alerts_log).

export interface ComplianceAlert {
  key: string;
  kind: "isf_deadline" | "document_expiry" | "bond";
  text: string;
  cooldownHours: number;
}

export interface AlertShipment {
  id: string;
  name: string;
  transport: string;
  etd: string | null;
  isf_filed_at: string | null;
  status: string;
}

export interface AlertDocument {
  id: string;
  title: string;
  expires_at: string | null;
  status: string;
}

export type AlertBondState = {
  bondAmount: number;
  utilization: number; // 0..1+
  sufficient: boolean;
} | null;

const CLOSED_STATUSES = ["released", "delivered", "cancelled"];

export function computeComplianceAlerts(input: {
  shipments: AlertShipment[];
  documents: AlertDocument[];
  bond: AlertBondState;
  now: Date;
}): ComplianceAlert[] {
  const alerts: ComplianceAlert[] = [];
  const nowMs = input.now.getTime();
  const hour = 3600000;

  for (const s of input.shipments) {
    if (s.transport !== "ocean" || s.isf_filed_at || !s.etd) continue;
    if (CLOSED_STATUSES.includes(s.status)) continue;
    const deadlineMs = new Date(s.etd).getTime() - 24 * hour;
    const hoursLeft = (deadlineMs - nowMs) / hour;
    if (hoursLeft < 72) {
      alerts.push({
        key: `isf:${s.id}:${new Date(deadlineMs).toISOString().slice(0, 10)}`,
        kind: "isf_deadline",
        text:
          hoursLeft < 0
            ? `⛔ ISF deadline PASSED for "${s.name}" (was due 24h before lading) and the ISF is still not filed. Late ISF risks a $5,000/violation liquidated-damages claim. Contact your broker now.`
            : `⚠️ ISF deadline in ${Math.round(hoursLeft)}h for "${s.name}" (24h before lading) — ISF not yet filed. The broker filing package is ready on the Compliance page.`,
        cooldownHours: 24,
      });
    }
  }

  for (const d of input.documents) {
    if (!d.expires_at || d.status === "expired") continue;
    const daysLeft = (new Date(d.expires_at).getTime() - nowMs) / (24 * hour);
    if (daysLeft < 30) {
      alerts.push({
        key: `doc:${d.id}:${d.expires_at}`,
        kind: "document_expiry",
        text:
          daysLeft < 0
            ? `⛔ Compliance document EXPIRED: "${d.title}". Renew it before the next shipment that relies on it.`
            : `⚠️ Compliance document expiring in ${Math.ceil(daysLeft)} days: "${d.title}" (${d.expires_at}).`,
        cooldownHours: 24 * 7,
      });
    }
  }

  if (input.bond) {
    if (!input.bond.sufficient) {
      alerts.push({
        key: `bond:insufficient:${input.now.toISOString().slice(0, 7)}`,
        kind: "bond",
        text: `⛔ Customs bond INSUFFICIENT: at current duty volume the bond no longer covers 10% of trailing-12-month duties/taxes/fees. Increase the bond with your surety before the next entry — an under-bonded entry can be rejected.`,
        cooldownHours: 24 * 7,
      });
    } else if (input.bond.utilization >= 0.8) {
      alerts.push({
        key: `bond:utilisation:${input.now.toISOString().slice(0, 7)}`,
        kind: "bond",
        text: `⚠️ Customs bond at ${Math.round(input.bond.utilization * 100)}% utilisation ($${input.bond.bondAmount.toLocaleString()}). At 2026 duty rates it will need increasing soon — plan the surety increase before it becomes a blocker.`,
        cooldownHours: 24 * 7,
      });
    }
  }

  return alerts;
}
