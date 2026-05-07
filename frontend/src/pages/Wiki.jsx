import { Link } from 'react-router-dom'
import {
  BookOpen,
  Boxes,
  Braces,
  Database,
  GitBranch,
  KeyRound,
  PlayCircle,
  ShieldCheck,
  Workflow,
} from 'lucide-react'

function Section({ id, title, icon: Icon, children }) {
  return (
    <section id={id} className="rounded-lg border border-[#343746] bg-[#191a21]">
      <div className="flex items-center gap-2 border-b border-[#343746] px-5 py-4">
        <Icon size={18} className="text-[#8be9fd]" />
        <h2 className="text-lg font-semibold text-[#f8f8f2]">{title}</h2>
      </div>
      <div className="space-y-4 p-5 text-sm leading-6 text-[#a7abc4]">{children}</div>
    </section>
  )
}

function Code({ children }) {
  return <pre className="overflow-auto rounded-md border border-[#343746] bg-[#0f1117] p-3 text-xs leading-relaxed text-[#50fa7b]"><code>{children}</code></pre>
}

function Callout({ children }) {
  return <div className="rounded-md border border-[#6272a4] bg-[#282a36] px-4 py-3 text-sm text-[#f8f8f2]">{children}</div>
}

export default function Wiki() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[#8be9fd]"><BookOpen size={20} /><span className="text-sm uppercase tracking-wide">Pylo Wiki</span></div>
          <h1 className="mt-2 text-3xl font-semibold text-[#f8f8f2]">Console principles and examples</h1>
          <p className="mt-2 max-w-3xl text-sm text-[#6272a4]">A compact reference for how Pylo's main concepts fit together: Blueprints create Entries, PyBooks run code, Workflows chain automation, and Runs tell you what happened.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
          <a href="#blueprints" className="rounded border border-[#343746] bg-[#191a21] px-3 py-2 text-[#a7abc4] hover:text-[#f8f8f2]">Blueprints</a>
          <a href="#pybooks" className="rounded border border-[#343746] bg-[#191a21] px-3 py-2 text-[#a7abc4] hover:text-[#f8f8f2]">PyBooks</a>
          <a href="#payloads" className="rounded border border-[#343746] bg-[#191a21] px-3 py-2 text-[#a7abc4] hover:text-[#f8f8f2]">Payloads</a>
          <a href="#runs" className="rounded border border-[#343746] bg-[#191a21] px-3 py-2 text-[#a7abc4] hover:text-[#f8f8f2]">Runs</a>
        </div>
      </div>

      <Section id="blueprints" title="Blueprints and Entries" icon={Boxes}>
        <p><strong className="text-[#f8f8f2]">Blueprints</strong> define how Pylo fetches and parses structured data from an external API. Each parsed object becomes an <strong className="text-[#f8f8f2]">Entry</strong>.</p>
        <p>Use Blueprints for IOC feeds, alert lists, asset inventories, vulnerability exports, allowlists, or any structured source you want to search and trigger automation from.</p>
        <Callout>Manual Blueprints have no API source. They are useful for shared lists or operator-curated records.</Callout>
        <Code>{`Entry payload shape passed to a PyBook:
{
  "blueprint_id": "...",
  "entry_id": "...",
  "entry_data": {"hash": "...", "severity": "high"}
}`}</Code>
        <p><Link to="/blueprints" className="text-[#8be9fd] hover:text-[#bd93f9]">Open Blueprints</Link> or <Link to="/entries" className="text-[#8be9fd] hover:text-[#bd93f9]">browse Entries</Link>.</p>
      </Section>

      <Section id="pybooks" title="PyBooks" icon={Braces}>
        <p><strong className="text-[#f8f8f2]">PyBooks</strong> are Python scripts that run in isolated Docker containers. They can be run manually, scheduled, triggered by a webhook, triggered by Blueprint entries, or called as Sub-PyBooks.</p>
        <p>Declare extra pip packages in the PyBook dependencies field when the base runner image does not already provide them. Secrets selected in Required API keys / secrets are injected as environment variables named <code className="rounded bg-[#0f1117] px-1 text-[#50fa7b]">SECRET_name</code>.</p>
        <Code>{`import os
import pylo_sdk as pylo

api_key = os.environ["SECRET_sekoia_api_key"]
payload = pylo.get_payload()

print(payload)
pylo.set_output("processed", True)`}</Code>
      </Section>

      <Section id="payloads" title="Payloads and Variables" icon={Database}>
        <p><strong className="text-[#f8f8f2]">Payloads are inputs.</strong> Pylo injects them into the container as <code className="rounded bg-[#0f1117] px-1 text-[#50fa7b]">TRIGGER_PAYLOAD</code>. The recommended helper is <code className="rounded bg-[#0f1117] px-1 text-[#50fa7b]">pylo.get_payload()</code>.</p>
        <p><strong className="text-[#f8f8f2]">Output variables are outputs.</strong> Use <code className="rounded bg-[#0f1117] px-1 text-[#50fa7b]">pylo.set_output()</code> or <code className="rounded bg-[#0f1117] px-1 text-[#50fa7b]">pylo.export_vars(locals())</code> to publish values for workflow edges and run inspection.</p>
        <Code>{`import pylo_sdk as pylo

payload = pylo.get_payload()
entry_data = payload.get("entry_data", {})
hash_value = entry_data.get("hash")

pylo.set_output("hash_uploaded", bool(hash_value))`}</Code>
      </Section>

      <Section id="workflows" title="Workflows" icon={Workflow}>
        <p><strong className="text-[#f8f8f2]">Workflows</strong> chain PyBooks into a visual DAG. A Workflow edge can map one node's output variables into the next node's payload.</p>
        <p>Use Workflows when you need multi-step automation with branching, reusable PyBooks, or clear run history per node.</p>
        <Code>{`Upstream PyBook:
pylo.set_output("ioc", "1.2.3.4")

Workflow edge mapping:
$.vars.ioc -> payload.ioc

Downstream PyBook:
payload = pylo.get_payload()
ioc = payload.get("ioc")`}</Code>
        <p><Link to="/workflows" className="text-[#8be9fd] hover:text-[#bd93f9]">Open Workflows</Link>.</p>
      </Section>

      <Section id="runs" title="Runs and Debugging" icon={PlayCircle}>
        <p><strong className="text-[#f8f8f2]">Runs</strong> are the execution records for PyBooks and Workflows. Use them to inspect status, stdout, stderr, payload, duration, and exported variables.</p>
        <p>During development, run a PyBook with a sample payload, watch stdout/stderr, then reuse a previous run payload to iterate quickly.</p>
        <Callout>Raise an exception to fail a run deliberately. Print progress for long-running jobs so the run console is useful while the container is still working.</Callout>
        <p><Link to="/runs" className="text-[#8be9fd] hover:text-[#bd93f9]">Open Runs</Link>.</p>
      </Section>

      <Section id="security" title="Security Model" icon={ShieldCheck}>
        <p>API access is authenticated. Secrets are encrypted at rest and only injected into containers for PyBooks that declare them. Decrypted secret values should never be printed, logged, returned by APIs, or stored in Entries.</p>
        <p>Viewer users can inspect data but cannot perform write operations. Admin users can create, update, run, and delete resources.</p>
      </Section>

      <Section id="quick-links" title="Quick Links" icon={KeyRound}>
        <div className="grid gap-2 text-sm md:grid-cols-3">
          <Link to="/dashboard" className="rounded border border-[#343746] bg-[#282a36] px-3 py-2 text-[#f8f8f2] hover:border-[#8be9fd]">Dashboard</Link>
          <Link to="/pybooks" className="rounded border border-[#343746] bg-[#282a36] px-3 py-2 text-[#f8f8f2] hover:border-[#8be9fd]">PyBooks</Link>
          <Link to="/secrets" className="rounded border border-[#343746] bg-[#282a36] px-3 py-2 text-[#f8f8f2] hover:border-[#8be9fd]">Secrets</Link>
        </div>
      </Section>
    </div>
  )
}
