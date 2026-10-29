import { tool } from "@openai/agents";
import { z } from "zod";
import { rest } from "./supabase.js";
import { driveAdapter } from "./drive-adapter.js";
import { firmDriveId, firmDriveKind } from "./google-connection.js";
import { instrument } from "./agent-tool-instrument.js";
import {
  eynowaLabConfigured,
  labHealth,
  labLocalChat,
  labOcr,
  labConvertToPdf,
  labSemanticMemoryStore,
  labSemanticMemorySearch,
  labSearchIndex,
  labSearchQuery,
  labWorkflowRun
} from "./eynowa-lab-client.js";
// EYNOWA Lab tools and the document-scope check, extracted from agent-tools.js (audit 2026-10-29); agent-tools.js re-exports driveDocumentScope.

const EYNOWA_LAB_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

function extractEynowaOcrText(value, maxChars = 60000) {
  const words = [];

  function walk(node) {
    if (words.join(" ").length >= maxChars) return;

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    if (!node || typeof node !== "object") return;

    if (typeof node.value === "string" && node.value.trim()) {
      words.push(node.value.trim());
      return;
    }

    for (const item of Object.values(node)) {
      walk(item);
    }
  }

  walk(value);
  return words.join(" ").slice(0, maxChars);
}

// A document read by an agent stays inside what the person may see (security review, 2026-10-24): the file must be
// in the firm's chosen Drive and, for someone who is not owner / partner, under the folder of a
// mission they are staffed on. An agent turn with no person behind it keeps the Drive check only.
async function isUnderFolder(meta, rootId, getMeta) {
  let cur = meta;
  for (let i = 0; i < 30 && cur; i++) {
    if (cur.id === rootId || cur.driveId === rootId) return true;
    const parent = (cur.parents || [])[0];
    if (!parent) return false;
    if (parent === rootId) return true;
    cur = await getMeta(parent).catch(() => null);
  }
  return false;
}

export async function driveDocumentScope(meta, ctx, missionId, d = {}) {
  const getMeta = d.getMeta || (id => driveAdapter.getMeta(id));
  const fetchRows = d.fetchRows || rest;
  const kind = d.driveKind !== undefined ? d.driveKind : firmDriveKind();
  const driveId = d.driveId !== undefined ? d.driveId : firmDriveId();
  if (meta?.trashed) return "DOCUMENT_TRASHED";
  if (kind !== "all") {
    if (!driveId) return "FIRM_DRIVE_NOT_CHOSEN";
    if (!(await isUnderFolder(meta, driveId, getMeta))) return "DOCUMENT_OUTSIDE_FIRM_DRIVE";
  }
  const account = ctx?.account;
  if (!account || ["owner", "partner"].includes(account.role)) return null;
  if (!missionId) return "MISSION_ID_REQUIRED";
  const { requireMissionAccess } = await import("./mission-access.js");
  try { await requireMissionAccess(ctx.orgId, missionId, account, fetchRows); }
  catch { return "NOT_ON_THIS_MISSION"; }
  const mission = (await fetchRows("office_missions?org_id=eq." + encodeURIComponent(ctx.orgId) + "&id=eq." + encodeURIComponent(missionId) + "&select=id,drive_folder_id&limit=1"))?.[0];
  if (!mission?.drive_folder_id) return "MISSION_FOLDER_REQUIRED";
  if (!(await isUnderFolder(meta, mission.drive_folder_id, getMeta))) return "DOCUMENT_OUTSIDE_MISSION";
  return null;
}

function safeLabFileMeta(meta) {
  return {
    id: meta?.id || null,
    name: meta?.name || "",
    mimeType: meta?.mimeType || "",
    modifiedTime: meta?.modifiedTime || null,
    webViewLink: meta?.webViewLink || null
  };
}

export function eynowaLabAgentTools(
  ctx,
  {
    allowSearch = false,
    allowWorkflow = false,
    allowMemorySearch = false,
    allowMemoryStore = false,
    allowDocumentRead = false,
    allowIndex = false
  } = {}
) {
  if (!eynowaLabConfigured()) return [];

  const tools = [];

  tools.push(tool({
    name: "eynowa_lab_health",
    description:
      "Check whether the private EYNOWA Lab is reachable and which local services are available. Read-only.",
    parameters: z.object({}),
    execute: instrument({
      ...ctx,
      toolName: "eynowa_lab_health",
      execute: async () => labHealth()
    })
  }));

  tools.push(tool({
    name: "eynowa_lab_local_chat",
    description:
      "Ask the private local EYNOWA AI model for additional analysis. Never treat its answer as audit evidence and never let it override verified source documents.",
    parameters: z.object({
      prompt: z.string().min(1).max(20000),
      system: z.string().max(8000).nullable().optional(),
      model: z.string().max(100).nullable().optional()
    }),
    execute: instrument({
      ...ctx,
      toolName: "eynowa_lab_local_chat",
      execute: async ({ prompt, system, model }) => {
        try {
          const result = await labLocalChat({
            prompt,
            ...(system ? { system } : {}),
            ...(model ? { model } : {})
          });

          return {
            available: true,
            source: "EYNOWA_LAB_LOCAL_AI",
            response: result?.response || result
          };
        } catch (error) {
          return {
            available: false,
            fallback_required: true,
            error: String(error?.message || error).slice(0, 200)
          };
        }
      }
    })
  }));

  if (allowDocumentRead) {
    tools.push(tool({
      name: "eynowa_lab_read_document",
      description:
        "Read an authorised document by file_id. Give mission_id when reading a mission's document: a person who is not owner or partner may only read documents under the folder of a mission they are staffed on. Existing safe structured readers are used first. If a PDF/image is scanned, EYNOWA docTR OCR is used. Unsupported Office binaries may be converted through Gotenberg then OCRed. Read-only: never modifies the source file.",
      parameters: z.object({
        file_id: z.string().min(1),
        mission_id: z.string().nullable().optional(),
        max_chars: z.number().int().min(1000).max(60000).nullable().optional()
      }),
      execute: instrument({
        ...ctx,
        toolName: "eynowa_lab_read_document",
        execute: async ({ file_id, mission_id, max_chars }) => {
          const maxChars = max_chars || 60000;

          try {
            const meta = await driveAdapter.getMeta(file_id);
            const refused = await driveDocumentScope(meta, ctx, mission_id || null);
            if (refused) {
              return {
                available: false,
                fallback_required: false,
                error: refused
              };
            }
            const mime = String(meta?.mimeType || "");

            if (mime === "application/vnd.google-apps.folder") {
              return {
                available: false,
                fallback_required: false,
                error: "DOCUMENT_IS_FOLDER"
              };
            }

            // Existing Office Manager readers stay first: better for structured
            // spreadsheets, native Google files and normal text documents.
            const existing = await driveAdapter
              .readText(file_id, {
                maxChars,
                structured: true
              })
              .catch(() => null);

            if (
              existing?.supported &&
              String(existing.text || "").trim() &&
              !existing.scanned
            ) {
              return {
                available: true,
                source: "OFFICE_MANAGER_DOCUMENT_READER",
                file: safeLabFileMeta(meta),
                extractor: existing.extractor || "existing-reader",
                text: String(existing.text).slice(0, maxChars),
                truncated: Boolean(existing.truncated),
                lab_ocr_used: false,
                converted_to_pdf: false
              };
            }

            // Native Google formats must be exported/read through the existing
            // Drive layer, never sent as fake binary bytes to LibreOffice.
            if (mime.startsWith("application/vnd.google-apps.")) {
              return {
                available: false,
                fallback_required: true,
                file: safeLabFileMeta(meta),
                error: "GOOGLE_NATIVE_READER_REQUIRED"
              };
            }

            let bytes = await driveAdapter.downloadBuffer(file_id, {
              maxBytes: EYNOWA_LAB_DOCUMENT_MAX_BYTES
            });

            let filename = meta?.name || "document";
            let contentType = mime || "application/octet-stream";
            let convertedToPdf = false;

            const directOcr =
              contentType === "application/pdf" ||
              contentType.startsWith("image/");

            if (!directOcr) {
              bytes = await labConvertToPdf({
                bytes,
                filename,
                contentType
              });

              filename =
                filename.replace(/\.[^.]+$/, "") + ".pdf";
              contentType = "application/pdf";
              convertedToPdf = true;
            }

            const ocr = await labOcr({
              bytes,
              filename,
              contentType
            });

            const text = extractEynowaOcrText(ocr, maxChars);

            return {
              available: true,
              source: convertedToPdf
                ? "EYNOWA_GOTENBERG_DOCTR"
                : "EYNOWA_DOCTR",
              file: safeLabFileMeta(meta),
              extractor: "doctr",
              text,
              chars: text.length,
              truncated: text.length >= maxChars,
              lab_ocr_used: true,
              converted_to_pdf: convertedToPdf
            };
          } catch (error) {
            return {
              available: false,
              fallback_required: true,
              error: String(error?.message || error).slice(0, 240)
            };
          }
        }
      })
    }));
  }

  if (allowIndex) {
    tools.push(tool({
      name: "eynowa_lab_index_text",
      description:
        "Index derived text in the private EYNOWA Meilisearch service so authorised agents can find it later. This does not alter the original document. Meilisearch indexing is asynchronous; task acceptance is not proof that indexing has completed.",
      parameters: z.object({
        id: z.string().min(1).max(300),
        text: z.string().min(1).max(60000),
        index: z.string().min(1).max(100).nullable().optional(),
        metadata: z.record(
          z.union([z.string(), z.number(), z.boolean()])
        ).nullable().optional()
      }),
      execute: instrument({
        ...ctx,
        toolName: "eynowa_lab_index_text",
        execute: async ({ id, text, index, metadata }) => {
          try {
            const indexName = index || "eynowa_documents";

            const receipt = await labSearchIndex({
              index: indexName,
              primaryKey: "id",
              documents: [{
                ...(metadata || {}),
                id,
                text
              }]
            });

            return {
              available: true,
              accepted: true,
              completed: false,
              source: "EYNOWA_LAB_MEILISEARCH",
              index: indexName,
              task: receipt
            };
          } catch (error) {
            return {
              available: false,
              fallback_required: true,
              error: String(error?.message || error).slice(0, 240)
            };
          }
        }
      })
    }));
  }

  if (allowMemorySearch) {
    tools.push(tool({
      name: "eynowa_lab_memory_search",
      description:
        "Search EYNOWA semantic memory by meaning using the private local embedding model and ChromaDB. Read-only. Use it to recover relevant prior knowledge; source documents and verified business records remain authoritative.",
      parameters: z.object({
        query: z.string().min(1).max(12000),
        collection: z.string().min(1).max(100).nullable().optional(),
        n_results: z.number().int().min(1).max(20).nullable().optional()
      }),
      execute: instrument({
        ...ctx,
        toolName: "eynowa_lab_memory_search",
        execute: async ({ query, collection, n_results }) => {
          try {
            return {
              available: true,
              source: "EYNOWA_LAB_CHROMA",
              result: await labSemanticMemorySearch({
                query,
                ...(collection ? { collection } : {}),
                ...(n_results ? { nResults: n_results } : {})
              })
            };
          } catch (error) {
            return {
              available: false,
              fallback_required: true,
              error: String(error?.message || error).slice(0, 200)
            };
          }
        }
      })
    }));
  }

  if (allowMemoryStore) {
    tools.push(tool({
      name: "eynowa_lab_memory_store",
      description:
        "Store durable semantic knowledge in the private EYNOWA Chroma memory. Store only useful factual or operational knowledge supported by the current work; never store secrets, passwords, API keys or unverified professional conclusions.",
      parameters: z.object({
        text: z.string().min(1).max(12000),
        collection: z.string().min(1).max(100).nullable().optional(),
        id: z.string().min(1).max(200).nullable().optional(),
        metadata: z.record(
          z.union([z.string(), z.number(), z.boolean()])
        ).nullable().optional()
      }),
      execute: instrument({
        ...ctx,
        toolName: "eynowa_lab_memory_store",
        execute: async ({ text, collection, id, metadata }) => {
          try {
            return {
              available: true,
              source: "EYNOWA_LAB_CHROMA",
              result: await labSemanticMemoryStore({
                text,
                ...(collection ? { collection } : {}),
                ...(id ? { id } : {}),
                ...(metadata ? { metadata } : {})
              })
            };
          } catch (error) {
            return {
              available: false,
              fallback_required: true,
              error: String(error?.message || error).slice(0, 200)
            };
          }
        }
      })
    }));
  }

  if (allowSearch) {
    tools.push(tool({
      name: "eynowa_lab_search",
      description:
        "Search the private EYNOWA Meilisearch indexes for already indexed firm or mission information. Read-only. Do not invent an index name if none is known.",
      parameters: z.object({
        index: z.string().min(1).max(100),
        query: z.string().max(2000).default(""),
        limit: z.number().int().min(1).max(50).nullable().optional(),
        filter: z.union([
          z.string(),
          z.array(z.string())
        ]).nullable().optional()
      }),
      execute: instrument({
        ...ctx,
        toolName: "eynowa_lab_search",
        execute: async ({ index, query, limit, filter }) => {
          try {
            const options = {};
            if (limit) options.limit = limit;
            if (filter) options.filter = filter;

            return {
              available: true,
              source: "EYNOWA_LAB_MEILISEARCH",
              result: await labSearchQuery({
                index,
                query,
                options
              })
            };
          } catch (error) {
            return {
              available: false,
              fallback_required: true,
              error: String(error?.message || error).slice(0, 200)
            };
          }
        }
      })
    }));
  }

  if (allowWorkflow) {
    tools.push(tool({
      name: "eynowa_lab_workflow",
      description:
        "Run an explicitly configured EYNOWA n8n webhook workflow. This may have side effects. Use only when the requested or validated business process clearly requires that specific workflow. Never guess a webhook path.",
      parameters: z.object({
        webhook_path: z.string().min(1).max(300),
        payload: z.record(z.any()).default({})
      }),
      execute: instrument({
        ...ctx,
        toolName: "eynowa_lab_workflow",
        execute: async ({ webhook_path, payload }) => {
          try {
            return {
              available: true,
              source: "EYNOWA_LAB_N8N",
              result: await labWorkflowRun({
                webhookPath: webhook_path,
                payload
              })
            };
          } catch (error) {
            return {
              available: false,
              fallback_required: true,
              error: String(error?.message || error).slice(0, 200)
            };
          }
        }
      })
    }));
  }

  return tools;
}

