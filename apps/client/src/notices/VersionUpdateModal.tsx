import { useEffect, useState } from "react";
import { useIntl } from "react-intl";
import ReactMarkdown from "react-markdown";
import type { VersionUpdateNotice } from "@fyendal/shared";
import { apiVersionUpdateNotice } from "../auth/auth.js";
import { DiscordIcon } from "../components/DiscordIcon.js";
import { ModalSurface } from "../components/ModalSurface.js";

function isDiscordLink(href: string | undefined): boolean {
  if (!href) return false;
  try {
    const url = new URL(href);
    return (url.protocol === "https:" || url.protocol === "http:")
      && ["discord.gg", "discord.com", "discordapp.com"].includes(url.hostname.replace(/^www\./, ""));
  } catch {
    return false;
  }
}

export function versionUpdateSeenKey(username: string, id: string): string {
  return `fyendal-version-update-seen-${username.toLowerCase()}-${id}`;
}

export function seenUpdate(username: string, id: string): boolean {
  try { return localStorage.getItem(versionUpdateSeenKey(username, id)) === "1"; }
  catch { return false; }
}

export function VersionUpdateBody({ markdown }: { markdown: string }) {
  return (
    <div className="version-update-markdown">
      <ReactMarkdown skipHtml components={{
        img: () => null,
        a: ({ href, children }) => {
          const discord = isDiscordLink(href);
          return (
            <a
              className={discord ? "version-update-discord-link" : undefined}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {discord ? <DiscordIcon className="version-update-discord-icon" /> : null}
              {children}
            </a>
          );
        },
      }}>{markdown}</ReactMarkdown>
    </div>
  );
}

export function VersionUpdateDialog({ notice, onDismiss }: {
  notice: VersionUpdateNotice;
  onDismiss: () => void;
}) {
  const intl = useIntl();
  const publishedAt = notice.publishedAt;
  const updated = publishedAt === null ? undefined : (
    <time dateTime={new Date(publishedAt).toISOString()}>
      {intl.formatMessage({ id: "versionUpdate.updatedAt" }, {
        date: intl.formatDate(publishedAt, { dateStyle: "medium", timeStyle: "short" }),
      })}
    </time>
  );
  return (
    <ModalSurface
      title={intl.formatMessage({ id: "versionUpdate.title" }, { version: notice.version })}
      eyebrow={intl.formatMessage({ id: "versionUpdate.kicker" })}
      description={updated}
      showCloseButton={false}
      onClose={onDismiss}
      className="version-update-modal"
    >
      <VersionUpdateBody markdown={notice.markdown} />
      <div className="version-update-actions">
        <button className="version-update-confirm" type="button" data-modal-initial-focus onClick={onDismiss}>
          {intl.formatMessage({ id: "versionUpdate.dismiss" })}
        </button>
      </div>
    </ModalSurface>
  );
}

export function VersionUpdateModal({ username }: { username: string }) {
  const [notice, setNotice] = useState<VersionUpdateNotice | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void apiVersionUpdateNotice(controller.signal).then((result) => {
      if (!controller.signal.aborted && result.ok) setNotice(result.notice);
    }).catch(() => {
      // Try again the next time Home opens.
    });
    return () => controller.abort();
  }, [username]);

  if (!notice || notice.id === dismissedId || seenUpdate(username, notice.id)) return null;
  const dismiss = () => {
    setDismissedId(notice.id);
    try { localStorage.setItem(versionUpdateSeenKey(username, notice.id), "1"); }
    catch { /* Session dismissal still works when storage is unavailable. */ }
  };
  return <VersionUpdateDialog notice={notice} onDismiss={dismiss} />;
}
