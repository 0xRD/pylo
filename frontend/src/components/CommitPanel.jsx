import { useState, useEffect } from "react";
import { GitCommit, ChevronDown, ChevronRight, Loader2, X, Plus, Pencil, Trash2 } from "lucide-react";
import { getGitDiff, commitToGit } from "../api/gitops";
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

function ObjectSection({ title, items, type, selected, onToggle }) {
  const [expanded, setExpanded] = useState({});

  if (!items || items.length === 0) return null;

  const toggle = (slug) => setExpanded((p) => ({ ...p, [slug]: !p[slug] }));

  const icon = {
    new: <Plus size={12} className="text-green-400 shrink-0" />,
    modified: <Pencil size={12} className="text-yellow-400 shrink-0" />,
    deleted: <Trash2 size={12} className="text-red-400 shrink-0" />,
  };

  return (
    <div className="mb-4">
      <div className="text-xs font-semibold text-[#6272a4] uppercase tracking-wider mb-1">{title}</div>
      <div className="space-y-1">
        {items.map((obj) => (
          <div key={obj.slug} className="rounded-sm border border-[#44475a] bg-[#282a36]">
            <div className="flex items-center gap-2 px-3 py-2">
              <input
                type="checkbox"
                checked={selected.has(obj.slug)}
                onChange={() => onToggle(obj.slug)}
                className="accent-[#bd93f9] shrink-0"
              />
              {icon[type]}
              <span className="text-sm text-[#f8f8f2] flex-1 truncate">{obj.name}</span>
              {obj.changed_fields && obj.changed_fields.length > 0 && (
                <button
                  onClick={() => toggle(obj.slug)}
                  className="text-[#6272a4] hover:text-[#f8f8f2] ml-auto"
                >
                  {expanded[obj.slug]
                    ? <ChevronDown size={14} />
                    : <ChevronRight size={14} />}
                </button>
              )}
            </div>
            {expanded[obj.slug] && <FieldDiff fields={obj.changed_fields} />}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CommitPanel({ onClose }) {
  const { refetch } = useGitops();
  const [diff, setDiff] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [committing, setCommitting] = useState(false);
  const [message, setMessage] = useState("Pylo config update");

  // selected sets per type+status
  const [selBps, setSelBps] = useState(new Set());
  const [selDelBps, setSelDelBps] = useState(new Set());
  const [selPbs, setSelPbs] = useState(new Set());
  const [selDelPbs, setSelDelPbs] = useState(new Set());
  const [selWfs, setSelWfs] = useState(new Set());
  const [selDelWfs, setSelDelWfs] = useState(new Set());

  useEffect(() => {
    getGitDiff()
      .then((d) => {
        setDiff(d);
        // Pre-select all by default
        setSelBps(new Set([...d.blueprints.new, ...d.blueprints.modified].map((o) => o.slug)));
        setSelDelBps(new Set(d.blueprints.deleted.map((o) => o.slug)));
        setSelPbs(new Set([...d.pybooks.new, ...d.pybooks.modified].map((o) => o.slug)));
        setSelDelPbs(new Set(d.pybooks.deleted.map((o) => o.slug)));
        setSelWfs(new Set([...d.workflows.new, ...d.workflows.modified].map((o) => o.slug)));
        setSelDelWfs(new Set(d.workflows.deleted.map((o) => o.slug)));
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

  const hasAnything = diff && (
    diff.blueprints.new.length + diff.blueprints.modified.length + diff.blueprints.deleted.length +
    diff.pybooks.new.length + diff.pybooks.modified.length + diff.pybooks.deleted.length +
    diff.workflows.new.length + diff.workflows.modified.length + diff.workflows.deleted.length > 0
  );

  async function handleCommit() {
    setCommitting(true);
    setError(null);
    try {
      await commitToGit({
        message,
        blueprints: [...selBps],
        pybooks: [...selPbs],
        workflows: [...selWfs],
        delete_blueprints: [...selDelBps],
        delete_pybooks: [...selDelPbs],
        delete_workflows: [...selDelWfs],
      });
      await refetch();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setCommitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/50">
      <div className="h-full w-full max-w-xl bg-[#21222c] border-l border-[#44475a] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#44475a] shrink-0">
          <div className="flex items-center gap-2">
            <GitCommit size={18} className="text-[#bd93f9]" />
            <span className="font-semibold text-[#f8f8f2]">Commit to Git</span>
          </div>
          <button onClick={onClose} className="text-[#6272a4] hover:text-[#f8f8f2]">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="flex items-center gap-2 text-[#6272a4]">
              <Loader2 size={16} className="animate-spin" /> Loading diff…
            </div>
          )}
          {error && (
            <div className="rounded-sm bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-3 py-2 mb-4">
              {error}
            </div>
          )}
          {diff && !hasAnything && (
            <p className="text-[#6272a4] text-sm">Everything is up to date — nothing to commit.</p>
          )}
          {diff && hasAnything && (
            <>
              {/* Blueprints */}
              <ObjectSection
                title="Blueprints — new / modified"
                items={[...diff.blueprints.new.map((o) => ({ ...o, _t: "new" })),
                         ...diff.blueprints.modified.map((o) => ({ ...o, _t: "modified" }))]}
                type="new"
                selected={selBps}
                onToggle={toggler(setSelBps)}
              />
              <ObjectSection
                title="Blueprints — deleted"
                items={diff.blueprints.deleted}
                type="deleted"
                selected={selDelBps}
                onToggle={toggler(setSelDelBps)}
              />
              {/* PyBooks */}
              <ObjectSection
                title="PyBooks — new / modified"
                items={[...diff.pybooks.new.map((o) => ({ ...o, _t: "new" })),
                         ...diff.pybooks.modified.map((o) => ({ ...o, _t: "modified" }))]}
                type="new"
                selected={selPbs}
                onToggle={toggler(setSelPbs)}
              />
              <ObjectSection
                title="PyBooks — deleted"
                items={diff.pybooks.deleted}
                type="deleted"
                selected={selDelPbs}
                onToggle={toggler(setSelDelPbs)}
              />
              {/* Workflows */}
              <ObjectSection
                title="Workflows — new / modified"
                items={[...diff.workflows.new.map((o) => ({ ...o, _t: "new" })),
                         ...diff.workflows.modified.map((o) => ({ ...o, _t: "modified" }))]}
                type="new"
                selected={selWfs}
                onToggle={toggler(setSelWfs)}
              />
              <ObjectSection
                title="Workflows — deleted"
                items={diff.workflows.deleted}
                type="deleted"
                selected={selDelWfs}
                onToggle={toggler(setSelDelWfs)}
              />
            </>
          )}
        </div>

        {/* Footer */}
        {diff && hasAnything && (
          <div className="shrink-0 border-t border-[#44475a] px-5 py-4 space-y-3">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Commit message…"
              className="w-full bg-[#282a36] border border-[#44475a] rounded-sm px-3 py-2 text-sm text-[#f8f8f2] placeholder-[#6272a4] focus:outline-hidden focus:border-[#bd93f9]"
            />
            {error && (
              <div className="rounded-sm bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-3 py-2">
                {error}
              </div>
            )}
            <button
              onClick={handleCommit}
              disabled={committing}
              className="w-full flex items-center justify-center gap-2 bg-[#bd93f9] hover:bg-[#caa9fb] text-[#282a36] font-semibold py-2 rounded-sm transition-colors disabled:opacity-50"
            >
              {committing ? <Loader2 size={16} className="animate-spin" /> : <GitCommit size={16} />}
              {committing ? "Committing…" : "Commit & Push"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
