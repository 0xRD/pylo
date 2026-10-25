import { useState, useEffect } from "react";
import { GitPullRequest, ChevronDown, ChevronRight, Loader2, X, Plus, Pencil, AlertTriangle } from "lucide-react";
import { getGitDiff, syncFromGit } from "../api/gitops";
import { useGitops } from "../context/GitopsContext";

function FieldDiff({ fields }) {
  if (!fields || fields.length === 0) return null;
  return (
    <div className="mt-2 rounded-sm border border-[#44475a] bg-[#1e1f29] text-xs font-mono divide-y divide-[#44475a]">
      {fields.map((f) => (
        <div key={f.field} className="px-3 py-1 grid grid-cols-[140px_1fr_1fr] gap-2 items-start">
          <span className="text-[#6272a4] truncate">{f.field}</span>
          <span className="text-red-400 truncate line-through">{String(f.old ?? "—")}</span>
          <span className="text-green-400 truncate">{String(f.new ?? "—")}</span>
        </div>
      ))}
    </div>
  );
}

function ObjectCard({ obj, changeType, selected, onToggle }) {
  const [open, setOpen] = useState(false);

  const badge = {
    new: <span className="text-[10px] font-semibold bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded-sm">NEW</span>,
    modified: <span className="text-[10px] font-semibold bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded-sm">MODIFIED</span>,
    deleted: <span className="text-[10px] font-semibold bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-sm">DELETED IN GIT</span>,
  };

  const isWarning = changeType === "deleted";

  return (
    <div className={`rounded-sm border ${isWarning ? "border-red-500/30 bg-red-500/5" : "border-[#44475a] bg-[#282a36]"}`}>
      <div className="flex items-center gap-2 px-3 py-2">
        {!isWarning && (
          <input
            type="checkbox"
            checked={selected.has(obj.slug)}
            onChange={() => onToggle(obj.slug)}
            className="accent-[#bd93f9] shrink-0"
          />
        )}
        {isWarning && <AlertTriangle size={13} className="text-red-400 shrink-0" />}
        <span className="text-sm text-[#f8f8f2] flex-1 truncate">{obj.name}</span>
        {badge[changeType]}
        {obj.changed_fields && obj.changed_fields.length > 0 && (
          <button onClick={() => setOpen((p) => !p)} className="text-[#6272a4] hover:text-[#f8f8f2]">
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
      </div>
      {open && <FieldDiff fields={obj.changed_fields} />}
    </div>
  );
}

function TypeSection({ title, newItems, modifiedItems, deletedItems, selected, onToggle }) {
  const hasItems = newItems.length + modifiedItems.length + deletedItems.length > 0;
  if (!hasItems) return null;

  return (
    <div className="mb-5">
      <div className="text-xs font-semibold text-[#6272a4] uppercase tracking-wider mb-2">{title}</div>
      <div className="space-y-1.5">
        {newItems.map((o) => (
          <ObjectCard key={o.slug} obj={o} changeType="new" selected={selected} onToggle={onToggle} />
        ))}
        {modifiedItems.map((o) => (
          <ObjectCard key={o.slug} obj={o} changeType="modified" selected={selected} onToggle={onToggle} />
        ))}
        {deletedItems.map((o) => (
          <ObjectCard key={o.slug} obj={o} changeType="deleted" selected={new Set()} onToggle={() => {}} />
        ))}
      </div>
      {deletedItems.length > 0 && (
        <p className="text-xs text-[#6272a4] mt-1.5">
          Objects absent from git are shown as warnings only — they will not be auto-deleted.
        </p>
      )}
    </div>
  );
}

export default function SyncPanel({ onClose }) {
  const { refetch } = useGitops();
  const [diff, setDiff] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const [selBps, setSelBps] = useState(new Set());
  const [selPbs, setSelPbs] = useState(new Set());
  const [selWfs, setSelWfs] = useState(new Set());

  useEffect(() => {
    // For prod sync: diff is (repo→db), but we want (db vs repo) from the prod perspective.
    // The backend /diff returns {new: items in DB not in repo, modified: changed, deleted: in repo not in DB}
    // For prod sync, we want to apply what's in the repo to the DB, so:
    //   "Apply" candidates = repo items that differ from DB (i.e. "deleted" from DB perspective = new in repo)
    // Re-interpret: items in repo but not in DB = what we want to import as "new"
    //               items modified in DB vs repo = what we want to update
    // The /diff endpoint returns diff(repo, db) where new=in_db_not_in_repo, modified=changed, deleted=in_repo_not_in_db
    // For sync panel: we show deleted (from DB perspective) as "available to create" and modified as "available to update"
    getGitDiff()
      .then((d) => {
        setDiff(d);
        // Pre-select: modified (to update) + deleted from DB (= new in repo, to create)
        setSelBps(new Set([
          ...d.blueprints.modified.map((o) => o.slug),
          ...d.blueprints.deleted.map((o) => o.slug),
        ]));
        setSelPbs(new Set([
          ...d.pybooks.modified.map((o) => o.slug),
          ...d.pybooks.deleted.map((o) => o.slug),
        ]));
        setSelWfs(new Set([
          ...d.workflows.modified.map((o) => o.slug),
          ...d.workflows.deleted.map((o) => o.slug),
        ]));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function toggler(setter) {
    return (slug) =>
      setter((prev) => {
        const next = new Set(prev);
        if (next.has(slug)) next.delete(slug);
        else next.add(slug);
        return next;
      });
  }

  // For sync: we pass what's in repo (deleted from DB view = new in repo; modified = update in DB)
  // "new" in DB view = in DB but not repo = "local only", shown as warning, not selectable

  const hasApplicable = diff && (
    diff.blueprints.modified.length + diff.blueprints.deleted.length +
    diff.pybooks.modified.length + diff.pybooks.deleted.length +
    diff.workflows.modified.length + diff.workflows.deleted.length > 0
  );

  async function handleSync() {
    setSyncing(true);
    setError(null);
    try {
      await syncFromGit({
        blueprints: [...selBps],
        pybooks: [...selPbs],
        workflows: [...selWfs],
      });
      await refetch();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/50">
      <div className="h-full w-full max-w-xl bg-[#21222c] border-l border-[#44475a] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#44475a] shrink-0">
          <div className="flex items-center gap-2">
            <GitPullRequest size={18} className="text-[#50fa7b]" />
            <span className="font-semibold text-[#f8f8f2]">Sync from Git</span>
          </div>
          <button onClick={onClose} className="text-[#6272a4] hover:text-[#f8f8f2]">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="flex items-center gap-2 text-[#6272a4]">
              <Loader2 size={16} className="animate-spin" /> Fetching remote changes…
            </div>
          )}
          {error && (
            <div className="rounded-sm bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-3 py-2 mb-4">
              {error}
            </div>
          )}
          {diff && !hasApplicable && diff.blueprints.new.length + diff.pybooks.new.length + diff.workflows.new.length === 0 && (
            <p className="text-[#6272a4] text-sm">Everything is up to date — nothing to apply.</p>
          )}
          {diff && (
            <>
              {/* Items from remote (to apply to local DB) */}
              <TypeSection
                title="Blueprints"
                newItems={[]}
                modifiedItems={diff.blueprints.modified}
                deletedItems={diff.blueprints.deleted}
                selected={selBps}
                onToggle={toggler(setSelBps)}
              />
              <TypeSection
                title="PyBooks"
                newItems={[]}
                modifiedItems={diff.pybooks.modified}
                deletedItems={diff.pybooks.deleted}
                selected={selPbs}
                onToggle={toggler(setSelPbs)}
              />
              <TypeSection
                title="Workflows"
                newItems={[]}
                modifiedItems={diff.workflows.modified}
                deletedItems={diff.workflows.deleted}
                selected={selWfs}
                onToggle={toggler(setSelWfs)}
              />
              {/* Items only in local DB (not in repo) — flagged as warnings */}
              {(diff.blueprints.new.length + diff.pybooks.new.length + diff.workflows.new.length) > 0 && (
                <div className="mt-4 rounded-sm border border-yellow-500/30 bg-yellow-500/5 px-4 py-3">
                  <div className="flex items-center gap-2 text-yellow-400 text-sm font-semibold mb-1">
                    <AlertTriangle size={14} />
                    Local-only objects (not in git)
                  </div>
                  <ul className="text-xs text-[#6272a4] space-y-0.5 list-disc list-inside">
                    {diff.blueprints.new.map((o) => <li key={o.slug}>Blueprint: {o.name}</li>)}
                    {diff.pybooks.new.map((o) => <li key={o.slug}>PyBook: {o.name}</li>)}
                    {diff.workflows.new.map((o) => <li key={o.slug}>Workflow: {o.name}</li>)}
                  </ul>
                  <p className="text-xs text-[#6272a4] mt-1">These exist locally but have no counterpart in git. They are not affected by sync.</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {diff && hasApplicable && (
          <div className="shrink-0 border-t border-[#44475a] px-5 py-4 space-y-3">
            {error && (
              <div className="rounded-sm bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-3 py-2">
                {error}
              </div>
            )}
            <button
              onClick={handleSync}
              disabled={syncing || (selBps.size + selPbs.size + selWfs.size === 0)}
              className="w-full flex items-center justify-center gap-2 bg-[#50fa7b] hover:bg-[#69ff94] text-[#282a36] font-semibold py-2 rounded-sm transition-colors disabled:opacity-50"
            >
              {syncing ? <Loader2 size={16} className="animate-spin" /> : <GitPullRequest size={16} />}
              {syncing ? "Applying…" : "Apply Selected Changes"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
