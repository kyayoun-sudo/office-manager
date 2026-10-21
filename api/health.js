import { googleConnectionConfigured } from "../lib/google-drive.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  return res.status(200).json({
    service: "Office Manager AI",
    status: "ok",
    release: "v2.2-operational-tools",
    providers: {
      supabase: Boolean(
        process.env.SUPABASE_URL &&
        process.env.SUPABASE_SERVICE_ROLE_KEY
      ),
      openai: Boolean(process.env.OPENAI_API_KEY),
      anthropic: Boolean(
        process.env.ANTHROPIC_API_KEY &&
        process.env.ANTHROPIC_MODEL
      ),
      openrouter: Boolean(process.env.OPENROUTER_API_KEY),
      mistral: Boolean(process.env.MISTRAL_API_KEY),
      huggingface: Boolean(process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN),
      groq: Boolean(process.env.GROQ_API_KEY),
      orpailleur: Boolean(process.env.ORPAILLEUR_JOB_SECRET),
      googleDriveSheets: googleConnectionConfigured()
    }
  });
}
