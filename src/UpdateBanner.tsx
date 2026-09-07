import type { Updater } from "./useUpdater";

/** A strip under the top bar: worth mentioning, not worth a modal. */
export function UpdateBanner({ updater }: { updater: Updater }) {
  const { update, stage, progress, error } = updater;
  if (!update || stage === "idle") return null;
  const percent = progress == null ? null : Math.round(progress * 100);

  return (
    <div className="update-banner">
      <span>
        {stage === "available" && (
          <>
            <strong>Version {update.version}</strong> is available{update.body ? `: ${update.body.split("\n")[0]}` : "."}
          </>
        )}
        {stage === "downloading" && <>Downloading update{percent != null ? ` (${percent}%)` : "…"}</>}
        {stage === "installing" && <>Installing…</>}
        {stage === "done" && <>Installed. Restarting…</>}
        {stage === "failed" && <span className="error">Update failed: {error}</span>}
      </span>
      {(stage === "available" || stage === "failed") && (
        <span className="update-banner__actions">
          <button onClick={updater.dismiss}>Later</button>
          <button className="primary" onClick={() => void updater.install()}>
            {stage === "failed" ? "Retry" : "Install and restart"}
          </button>
        </span>
      )}
    </div>
  );
}
