// Update checking (DESIGN.md §13). Silent on failure: offline, or no release
// yet, is not worth a dialog. Installing is always the user's choice.

import { useCallback, useEffect, useState } from "react";
import { isTauri } from "./settings";

export type UpdateStage = "idle" | "available" | "downloading" | "installing" | "done" | "failed";

/** First retry after a failed check; doubles each time up to RECHECK_MS. */
const RETRY_MS = 15_000;
/** How often to look again while the app stays open and no update was found. */
const RECHECK_MS = 60 * 60 * 1000;

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
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const schedule = (ms: number) => {
      if (!cancelled) timer = setTimeout(run, ms);
    };
    // One check at launch is not enough: the network may not be up yet, or
    // the check may just fail once, and the app only ever launches again
    // when the user restarts it. Retry with growing gaps, then keep looking
    // now and then while the app stays open.
    const run = async () => {
      if (cancelled) return;
      attempt++;
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const found = await check();
        if (cancelled) return;
        if (found) {
          setHandle(found);
          setUpdate({ version: found.version, date: found.date, body: found.body });
          setStage("available");
          return;
        }
        schedule(RECHECK_MS);
      } catch (err) {
        console.warn("update check failed:", err);
        schedule(Math.min(RECHECK_MS, RETRY_MS * 2 ** (attempt - 1)));
      }
    };
    void run();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
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
