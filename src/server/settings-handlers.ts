import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createApiProfile,
  deleteApiProfile,
  getApiProfile,
  listApiProfiles,
  probeAndSaveProfileCapabilities,
  updateApiProfile,
} from "../config/api-profiles.js";
import {
  deliveryModeLabel,
  resolveStructuredDeliveryMode,
} from "../llm/capabilities.js";
import {
  ensureActiveProfileDefault,
  loadAppSettings,
  normalizeContextTraceKeepLatest,
  saveAppSettings,
  setActivePresetId,
  setActiveProfileId,
} from "../config/settings.js";
import {
  countEnabledEntries,
  countInjectingEntries,
  listAllPresetEntries,
  patchPresetEntries,
  type PresetEntryPatch,
} from "../preset/entries.js";
import { patchPresetGeneration } from "../preset/generation.js";
import { runPresetProbe } from "../preset/probe.js";
import {
  deletePreset,
  getPreset,
  importAndSavePreset,
  listPresets,
} from "../preset/store.js";
import type { GenerationParameters } from "../types/preset.js";
import {
  createLlmForPreset,
  hasRealLlmConfig,
} from "../runtime/llm-factory.js";
import {
  createPersona,
  deletePersona,
  getActivePersona,
  getCreationDefaultPersona,
  listPersonas,
  setActivePersonaId,
  updatePersona,
} from "../persona/store.js";
import { listDirectiveCatalog } from "../directives/expand.js";
import { sessionManager } from "./session-manager.js";

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function personasPayload(extra: Record<string, unknown> = {}) {
  const creation = getCreationDefaultPersona();
  return {
    personas: listPersonas(),
    activeId: getActivePersona()?.id ?? null,
    creationDefaultId: creation?.id ?? null,
    ...extra,
  };
}

export async function handleSettingsApi(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (pathname === "/api/settings" && req.method === "GET") {
    ensureActiveProfileDefault();
    const settings = loadAppSettings();
    const profiles = listApiProfiles();
    const presets = listPresets().map((p) => {
      const all = listAllPresetEntries(p);
      return {
        id: p.id,
        name: p.name,
        source: p.source,
        enabledCount: countEnabledEntries(all),
        injectingCount: countInjectingEntries(all),
        entryCount: all.length,
        importedAt: p.importedAt,
      };
    });
    json(res, 200, { settings, profiles, presets });
    return true;
  }

  if (pathname === "/api/settings" && req.method === "PUT") {
    const body = JSON.parse(await readBody(req)) as {
      activeProfileId?: string | null;
      activePresetId?: string | null;
      contextTraceKeepLatest?: number;
    };
    const settings = loadAppSettings();
    if (body.activeProfileId !== undefined) {
      settings.activeProfileId = body.activeProfileId;
    }
    if (body.activePresetId !== undefined) {
      settings.activePresetId = body.activePresetId;
    }
    if (body.contextTraceKeepLatest !== undefined) {
      settings.contextTraceKeepLatest = normalizeContextTraceKeepLatest(
        body.contextTraceKeepLatest,
      );
    }
    saveAppSettings(settings);
    json(res, 200, { settings });
    return true;
  }

  if (pathname === "/api/settings/context-traces/prune" && req.method === "POST") {
    const result = sessionManager.pruneAllOpenContextTraces();
    json(res, 200, result);
    return true;
  }

  if (pathname === "/api/settings/context-traces/clear" && req.method === "POST") {
    const result = sessionManager.clearAllOpenContextTraces();
    json(res, 200, result);
    return true;
  }

  if (pathname === "/api/profiles" && req.method === "GET") {
    ensureActiveProfileDefault();
    json(res, 200, { profiles: listApiProfiles() });
    return true;
  }

  if (pathname === "/api/profiles" && req.method === "POST") {
    const body = JSON.parse(await readBody(req)) as {
      name?: string;
      baseUrl?: string;
      apiKey?: string;
      model?: string;
      reasoningEffort?: string;
    };
    const profile = createApiProfile({
      name: body.name ?? "新配置",
      baseUrl: body.baseUrl ?? "https://api.deepseek.com",
      apiKey: body.apiKey ?? "",
      model: body.model ?? "deepseek-v4-pro",
      reasoningEffort: body.reasoningEffort,
    });
    const activate = (body as { activate?: boolean }).activate === true;
    if (activate) {
      setActiveProfileId(profile.id);
    }
    const reloadedSessions = activate ? sessionManager.reloadAllLlms() : 0;
    json(res, 201, { profile, activeProfileId: activate ? profile.id : null, reloadedSessions });
    return true;
  }

  const profileMatch = pathname.match(
    /^\/api\/profiles\/([^/]+)(\/probe-capabilities)?$/,
  );
  if (profileMatch) {
    const id = decodeURIComponent(profileMatch[1]);
    const suffix = profileMatch[2];

    if (suffix === "/probe-capabilities" && req.method === "POST") {
      try {
        const profile = await probeAndSaveProfileCapabilities(id);
        const mode = resolveStructuredDeliveryMode(profile.capabilities);
        const settings = loadAppSettings();
        const reloadedSessions =
          settings.activeProfileId === id
            ? sessionManager.reloadAllLlms()
            : 0;
        json(res, 200, {
          ok: profile.capabilities?.chat === "ok",
          profile,
          deliveryMode: mode,
          deliveryModeLabel: deliveryModeLabel(mode),
          reloadedSessions,
        });
      } catch (err) {
        json(res, 400, {
          error: err instanceof Error ? err.message : "能力探测失败",
        });
      }
      return true;
    }

    if (req.method === "GET") {
      const profile = getApiProfile(id);
      if (!profile) {
        json(res, 404, { error: "配置不存在" });
        return true;
      }
      json(res, 200, { profile });
      return true;
    }

    if (req.method === "PUT") {
      const body = JSON.parse(await readBody(req)) as {
        name?: string;
        baseUrl?: string;
        apiKey?: string;
        model?: string;
        reasoningEffort?: string;
      };
      try {
        const profile = updateApiProfile(id, body);
        const settings = loadAppSettings();
        const reloadedSessions =
          settings.activeProfileId === id
            ? sessionManager.reloadAllLlms()
            : 0;
        json(res, 200, { profile, reloadedSessions });
      } catch (err) {
        json(res, 404, {
          error: err instanceof Error ? err.message : "更新失败",
        });
      }
      return true;
    }

    if (req.method === "DELETE") {
      deleteApiProfile(id);
      const settings = loadAppSettings();
      if (settings.activeProfileId === id) {
        settings.activeProfileId = listApiProfiles()[0]?.id ?? null;
        saveAppSettings(settings);
      }
      json(res, 200, { ok: true });
      return true;
    }
  }

  const activateProfileMatch = pathname.match(
    /^\/api\/profiles\/([^/]+)\/activate$/,
  );
  if (activateProfileMatch && req.method === "POST") {
    const id = decodeURIComponent(activateProfileMatch[1]);
    if (!getApiProfile(id)) {
      json(res, 404, { error: "配置不存在" });
      return true;
    }
    setActiveProfileId(id);
    const reloadedSessions = sessionManager.reloadAllLlms();
    json(res, 200, { activeProfileId: id, reloadedSessions });
    return true;
  }

  if (pathname === "/api/presets" && req.method === "GET") {
    json(res, 200, { presets: listPresets() });
    return true;
  }

  if (pathname === "/api/presets/import" && req.method === "POST") {
    const body = JSON.parse(await readBody(req)) as {
      raw?: unknown;
      name?: string;
    };
    if (!body.raw) {
      json(res, 400, { error: "缺少 raw 字段" });
      return true;
    }
    const report = importAndSavePreset(body.raw, { name: body.name });
    const activate = (body as { activate?: boolean }).activate === true;
    if (activate) {
      setActivePresetId(report.preset.id);
      sessionManager.reloadAllLlms();
    }
    json(res, 201, { ...report, activePresetId: activate ? report.preset.id : null });
    return true;
  }

  const presetProbeMatch = pathname.match(/^\/api\/presets\/([^/]+)\/probe$/);
  if (presetProbeMatch && req.method === "POST") {
    const id = decodeURIComponent(presetProbeMatch[1]);
    const preset = getPreset(id);
    if (!preset) {
      json(res, 404, { error: "预设不存在" });
      return true;
    }
    const body = JSON.parse(await readBody(req)) as {
      message?: string;
      loreBefore?: string;
      history?: string;
      loreAfter?: string;
      postTurn?: string;
      complete?: boolean;
    };
    try {
      const wantComplete = body.complete !== false;
      const canComplete = wantComplete && hasRealLlmConfig();
      const llm = canComplete ? createLlmForPreset(preset) : null;
      const result = await runPresetProbe({
        preset,
        input: {
          message: body.message ?? "",
          loreBefore: body.loreBefore,
          history: body.history,
          loreAfter: body.loreAfter,
          postTurn: body.postTurn,
        },
        complete: llm
          ? (messages) =>
              llm.complete(messages, { caller: "preset-probe" })
          : undefined,
      });
      if (!llm && wantComplete) {
        result.skipReason = "未配置 API Key，只返回拼装后的上下文";
      }
      json(res, 200, result);
    } catch (err) {
      json(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  const presetEntriesMatch = pathname.match(
    /^\/api\/presets\/([^/]+)\/entries$/,
  );
  if (presetEntriesMatch) {
    const id = decodeURIComponent(presetEntriesMatch[1]);
    const preset = getPreset(id);
    if (!preset) {
      json(res, 404, { error: "预设不存在" });
      return true;
    }

    if (req.method === "GET") {
      const entries = listAllPresetEntries(preset);
      json(res, 200, {
        presetId: preset.id,
        presetName: preset.name,
        generation: preset.generation,
        entries,
        enabledCount: countEnabledEntries(entries),
        injectingCount: countInjectingEntries(entries),
      });
      return true;
    }

    if (req.method === "PATCH" || req.method === "PUT") {
      const body = JSON.parse(await readBody(req)) as {
        entries?: PresetEntryPatch[];
        entry?: PresetEntryPatch;
        generation?: GenerationParameters | Record<string, unknown>;
      };
      const patches = body.entries?.length
        ? body.entries
        : body.entry
          ? [body.entry]
          : [];
      const hasGeneration = Object.prototype.hasOwnProperty.call(
        body,
        "generation",
      );
      if (!patches.length && !hasGeneration) {
        json(res, 400, { error: "缺少 entries、entry 或 generation" });
        return true;
      }
      try {
        let next = preset;
        if (patches.length) next = patchPresetEntries(next, patches);
        if (hasGeneration) next = patchPresetGeneration(next, body.generation);
        const entries = listAllPresetEntries(next);
        const settings = loadAppSettings();
        let reloadedSessions = 0;
        if (settings.activePresetId === id) {
          reloadedSessions = sessionManager.reloadAllLlms();
        }
        json(res, 200, {
          presetId: next.id,
          presetName: next.name,
          generation: next.generation,
          entries,
          enabledCount: countEnabledEntries(entries),
          injectingCount: countInjectingEntries(entries),
          reloadedSessions,
        });
      } catch (err) {
        json(res, 400, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return true;
    }
  }

  const presetMatch = pathname.match(/^\/api\/presets\/([^/]+)(\/activate)?$/);
  if (presetMatch) {
    const id = decodeURIComponent(presetMatch[1]);
    const isActivate = presetMatch[2] === "/activate";

    if (isActivate && req.method === "POST") {
      if (!getPreset(id)) {
        json(res, 404, { error: "预设不存在" });
        return true;
      }
      setActivePresetId(id);
      const reloadedSessions = sessionManager.reloadAllLlms();
      json(res, 200, { activePresetId: id, reloadedSessions });
      return true;
    }

    if (req.method === "GET") {
      const preset = getPreset(id);
      if (!preset) {
        json(res, 404, { error: "预设不存在" });
        return true;
      }
      const entries = listAllPresetEntries(preset);
      json(res, 200, {
        preset,
        entries,
        enabledCount: countEnabledEntries(entries),
        injectingCount: countInjectingEntries(entries),
      });
      return true;
    }

    if (req.method === "DELETE") {
      deletePreset(id);
      const settings = loadAppSettings();
      if (settings.activePresetId === id) {
        settings.activePresetId = null;
        saveAppSettings(settings);
      }
      json(res, 200, { ok: true });
      return true;
    }
  }

  if (pathname === "/api/directives/catalog" && req.method === "GET") {
    json(res, 200, { items: listDirectiveCatalog() });
    return true;
  }

  if (pathname === "/api/personas" && req.method === "GET") {
    const active = getActivePersona();
    json(res, 200, {
      ...personasPayload(),
      active,
      creationDefault: getCreationDefaultPersona(),
    });
    return true;
  }

  if (pathname === "/api/personas" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req)) as {
        name?: string;
        description?: string;
        activate?: boolean;
        creationDefault?: boolean;
      };
      const persona = createPersona({
        name: body.name ?? "",
        description: body.description,
        activate: body.activate,
        creationDefault: body.creationDefault,
      });
      json(res, 201, {
        ...personasPayload({ persona }),
      });
    } catch (e) {
      json(res, 400, {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return true;
  }

  const personaMatch = pathname.match(
    /^\/api\/personas\/([^/]+)(\/activate)?$/,
  );
  if (personaMatch) {
    const id = decodeURIComponent(personaMatch[1]);
    const activate = Boolean(personaMatch[2]);

    if (activate && req.method === "POST") {
      try {
        const persona = setActivePersonaId(id);
        json(res, 200, {
          ...personasPayload({ persona, activeId: persona.id }),
        });
      } catch (e) {
        json(res, 404, {
          error: e instanceof Error ? e.message : String(e),
        });
      }
      return true;
    }

    if (req.method === "PUT") {
      try {
        const body = JSON.parse(await readBody(req)) as {
          name?: string;
          description?: string;
          creationDefault?: boolean;
        };
        const persona = updatePersona(id, body);
        json(res, 200, {
          ...personasPayload({ persona }),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        json(res, msg.includes("不存在") ? 404 : 400, { error: msg });
      }
      return true;
    }

    if (req.method === "DELETE") {
      try {
        deletePersona(id);
        json(res, 200, {
          ...personasPayload({ ok: true }),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        json(res, msg.includes("不存在") ? 404 : 400, { error: msg });
      }
      return true;
    }
  }

  return false;
}
