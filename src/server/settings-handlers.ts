import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createApiProfile,
  deleteApiProfile,
  getApiProfile,
  listApiProfiles,
  testApiProfile,
  updateApiProfile,
} from "../config/api-profiles.js";
import {
  ensureActiveProfileDefault,
  loadAppSettings,
  saveAppSettings,
  setActivePresetId,
  setActiveProfileId,
} from "../config/settings.js";
import {
  deletePreset,
  getPreset,
  importAndSavePreset,
  listPresets,
} from "../preset/store.js";
import {
  countInjectingEntries,
  listEnabledPresetEntries,
} from "../preset/entries.js";
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
      const entries = listEnabledPresetEntries(p);
      return {
        id: p.id,
        name: p.name,
        source: p.source,
        enabledCount: p.promptOrder.filter((o) => o.enabled).length,
        injectingCount: countInjectingEntries(entries),
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
    };
    const settings = loadAppSettings();
    if (body.activeProfileId !== undefined) {
      settings.activeProfileId = body.activeProfileId;
    }
    if (body.activePresetId !== undefined) {
      settings.activePresetId = body.activePresetId;
    }
    saveAppSettings(settings);
    json(res, 200, { settings });
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
    };
    const profile = createApiProfile({
      name: body.name ?? "新配置",
      baseUrl: body.baseUrl ?? "https://api.deepseek.com",
      apiKey: body.apiKey ?? "",
      model: body.model ?? "deepseek-v4-pro",
    });
    const activate = (body as { activate?: boolean }).activate === true;
    if (activate) {
      setActiveProfileId(profile.id);
    }
    const reloadedSessions = activate ? sessionManager.reloadAllLlms() : 0;
    json(res, 201, { profile, activeProfileId: activate ? profile.id : null, reloadedSessions });
    return true;
  }

  const profileMatch = pathname.match(/^\/api\/profiles\/([^/]+)(\/test)?$/);
  if (profileMatch) {
    const id = decodeURIComponent(profileMatch[1]);
    const isTest = profileMatch[2] === "/test";

    if (isTest && req.method === "POST") {
      const profile = getApiProfile(id);
      if (!profile) {
        json(res, 404, { error: "配置不存在" });
        return true;
      }
      const result = await testApiProfile(profile);
      json(res, 200, result);
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
      };
      try {
        const profile = updateApiProfile(id, body);
        json(res, 200, { profile });
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

  const presetEntriesMatch = pathname.match(
    /^\/api\/presets\/([^/]+)\/entries$/,
  );
  if (presetEntriesMatch && req.method === "GET") {
    const id = decodeURIComponent(presetEntriesMatch[1]);
    const preset = getPreset(id);
    if (!preset) {
      json(res, 404, { error: "预设不存在" });
      return true;
    }
    const entries = listEnabledPresetEntries(preset);
    json(res, 200, {
      presetId: preset.id,
      presetName: preset.name,
      generation: preset.generation,
      entries,
      injectingCount: countInjectingEntries(entries),
    });
    return true;
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
      const entries = listEnabledPresetEntries(preset);
      json(res, 200, { preset, entries, injectingCount: countInjectingEntries(entries) });
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

  return false;
}
