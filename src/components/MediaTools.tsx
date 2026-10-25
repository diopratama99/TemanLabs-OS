import { useCallback, useEffect, useState, type ReactNode } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { api } from "../api";
import { Switch } from "./Switch";
import type { MediaTools } from "../api/types";
import { useJob } from "../hooks/useJob";
import { tr } from "../lib/i18n";

// The download tools (yt-dlp, gallery-dl, streamlink), shared by Downloader and Live Recorder.

export function useMediaTools() {
  const [tools, setTools] = useState<MediaTools | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api.mediaTools().then(setTools, () => {}), []);
  useEffect(() => {
    void load();
  }, [load]);
  const job = useJob(kind, (j) => {
    setKind(null);
    if (j.exit !== 0) setError(j.log.at(-1) ?? tr("It didn’t work."));
    void load();
  });
  const install = (opts?: { galleryDev?: boolean }) => {
    setError(null);
    api.installMediaTools(opts).then(
      (r) => setKind(r.job),
      (e) => setError(e instanceof Error ? e.message : String(e)),
    );
  };
  const busy = !!job?.running || !!tools?.working;
  return { tools, install, busy, line: job?.log.at(-1), error };
}

/** Until the tools are there: what they are, and a button that installs them. */
export function MediaToolsGate({
  icon,
  title,
  text,
  children,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  children: ReactNode;
}) {
  const { tools, install, busy, line, error } = useMediaTools();
  if (!tools) return <p className="empty">{tr("Loading…")}</p>;
  if (tools.installed) return <>{children}</>;
  return (
    <div className="bk-hero mt-hero">
      {icon}
      <h2>{title}</h2>
      <p>{text}</p>
      <button
        className="btn btn-primary"
        disabled={busy}
        onClick={() => install()}
      >
        {busy ? <LoaderCircle size={14} className="spin" /> : null}{" "}
        {tr("Install Download Tools")}
      </button>
      {busy && line && <code className="bk-log-line">{line}</code>}
      {error && <p className="form-error">{error}</p>}
      <small>
        {tr(
          "Installs yt-dlp, gallery-dl and streamlink, well-known open-source tools, in a folder of TemanLabsOS’s own (about 220 MB).",
        )}
      </small>
    </div>
  );
}

/**
 * The tools' versions and an Update button; sites change often, and new versions keep up. With
 * galleryDev, a switch for gallery-dl's development version too.
 */
export function MediaToolsRow({ galleryDev }: { galleryDev?: boolean }) {
  const { tools, install, busy, line, error } = useMediaTools();
  const versions = tools ? Object.entries(tools.versions) : [];
  return (
    <div className="mt-box">
      <div className="mt-row">
        <span>
          <strong>{tr("Download tools")}</strong>
          <small>
            {busy
              ? (line ?? tr("Updating…"))
              : versions.map(([k, v]) => `${k} ${v}`).join(" · ") || "–"}
          </small>
          {error && <small className="form-error">{error}</small>}
        </span>
        <button className="btn" disabled={busy} onClick={() => install()}>
          {busy ? (
            <LoaderCircle size={13} className="spin" />
          ) : (
            <RefreshCw size={13} />
          )}{" "}
          {tr("Update")}
        </button>
      </div>
      {galleryDev && tools && (
        <div className="mt-row mt-dev">
          <span>
            <strong>{tr("gallery-dl’s development version")}</strong>
            <small>
              {tr(
                "Fixes for sites that changed (Instagram lately) before they’re released. Newer, so now and then less steady; off puts the release back.",
              )}
            </small>
          </span>
          <Switch
            checked={tools.galleryDev}
            disabled={busy}
            onChange={(on) => install({ galleryDev: on })}
            label={tr("gallery-dl’s development version")}
          />
        </div>
      )}
    </div>
  );
}
