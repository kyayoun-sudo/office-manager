import { requirePilotAccess } from "../lib/auth.js";
import {
  sendEynowaLabFeedback,
  validateEynowaLabConclusion
} from "../eynowa-lab-client.js";

export default async function handler(req, res) {
  try {
    requirePilotAccess(req);

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body = req.body || {};
    const action = String(body.action || "").trim().toLowerCase();
    const card = body.card && typeof body.card === "object" ? body.card : {};

    if (!card.validation_id) {
      return res.status(400).json({ error: "validation_id is required" });
    }

    if (action === "accept" || action === "correct") {
      const correctedDecision = String(body.corrected_decision || "").trim();
      if (action === "correct" && !correctedDecision) {
        return res.status(400).json({ error: "corrected_decision is required" });
      }

      const result = await validateEynowaLabConclusion({
        ...card,
        action,
        confirmed: true,
        corrected_decision: action === "correct" ? correctedDecision : undefined,
        decision: action === "accept" ? card.proposed_conclusion : undefined,
        validation_reason: card.reason,
        professional_id: card.professional_id || body.professional_id || "default"
      });

      return res.status(200).json(result);
    }

    if (action === "request_evidence") {
      const result = await sendEynowaLabFeedback({
        validation_id: card.validation_id,
        application: card.application,
        domain: Array.isArray(card.domains) ? card.domains[0] : "",
        topic: Array.isArray(card.topics) ? card.topics[0] : "",
        rating: "needs_evidence",
        note: String(body.note || card.question || "Additional evidence requested").slice(0, 4000)
      });
      return res.status(200).json({ ...result, status: "MORE_EVIDENCE_REQUESTED" });
    }

    if (action === "reject") {
      const result = await sendEynowaLabFeedback({
        validation_id: card.validation_id,
        application: card.application,
        domain: Array.isArray(card.domains) ? card.domains[0] : "",
        topic: Array.isArray(card.topics) ? card.topics[0] : "",
        rating: "rejected",
        note: String(body.note || "Professional proposal rejected").slice(0, 4000)
      });
      return res.status(200).json({ ...result, status: "REJECTED" });
    }

    return res.status(400).json({ error: "UNKNOWN_VALIDATION_ACTION" });
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || error.status || 500).json({
      error: String(error.message || error)
    });
  }
}
