// Update checking (DESIGN.md §13). Silent on failure: offline, or no release
// yet, is not worth a dialog. Installing is always the user's choice.

import { useCallback, useEffect, useState } from "react";
import { isTauri } from "./settings";

export type UpdateStage = "idle" | "available" | "downloading" | "installing" | "done" | "failed";

export interface UpdateInfo {
  version: string;
  date?: string;
  body?: string;
}

export interface Updater {
  update: UpdateInfo | null;
  stage: UpdateStage;
  progress: number | null;
  error: string | null;
  install: () => Promise<void>;
  dismiss: () => void;
}

type PluginUpdate = import("@tauri-apps/plugin-updater").Update;

export function useUpdater(): Updater {
  const [handle, setHandle] = useState<PluginUpdate | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [stage, setStage] = useState<UpdateStage>("idle");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    (async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const found = await check();
        if (found && !cancelled) {
          setHandle(found);
          setUpdate({ version: found.version, date: found.date, body: found.body });
          setStage("available");
        }
      } catch (err) {
        console.warn("update check failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const install = useCallback(async () => {
    if (!handle) return;
    setError(null);
    setStage("downloading");
    try {
      let downloaded = 0;
      let total = 0;
      await handle.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? 0;
            setProgress(0);
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            setProgress(total > 0 ? downloaded / total : null);
            break;
          case "Finished":
            setProgress(1);
            setStage("installing");
            break;
        }
      });
      setStage("done");
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (err) {
      setStage("failed");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [handle]);

  const dismiss = useCallback(() => {
    setUpdate(null);
    setHandle(null);
    setStage("idle");
    setProgress(null);
    setError(null);
  }, []);

  return { update, stage, progress, error, install, dismiss };
}
