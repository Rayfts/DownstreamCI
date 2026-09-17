import { useEffect, useMemo, useState } from "react";

type CommandResult = { stdout: string; stderr: string; exitCode: number | null; durationMs: number; timedOut: boolean };
type Execution = { test: CommandResult; environment: Record<string, string> };
type Comparison = {
  downstream?: { repository: string; ref: string };
  classification: string;
  reason: string;
  baseline: Execution;
  candidate: Execution;
  analysis?: { harness: string; raw: string; label: "ANALYSIS" };
  candidateSignature?: string;
};
type StoredRun = { id: string; createdAt: number; upstream: string; ref: string; comparisons: Comparison[] };

type View = "matrix" | "failures" | "logs" | "analysis" | "runtime" | "history";

export function App() {
  const [runs, setRuns] = useState<StoredRun[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [view, setView] = useState<View>("matrix");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const base = import.meta.env.VITE_API_BASE ?? "";
    fetch(`${base}/api/runs/latest?limit=30`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        return (await response.json()) as { runs: StoredRun[] };
      })
      .then((data) => {
        setRuns(data.runs);
        setSelectedId(data.runs[0]?.id ?? "");
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  const run = runs.find((item) => item.id === selectedId) ?? runs[0];
  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const comparison of run?.comparisons ?? []) result[comparison.classification] = (result[comparison.classification] ?? 0) + 1;
    return result;
  }, [run]);
  const regressions = run?.comparisons.filter((item) => item.classification === "newly-broken") ?? [];

  return (
    <main className="shell">
      <header>
        <div><p className="eyebrow">DownstreamCI</p><h1>Compatibility evidence</h1></div>
        {run ? <div className={regressions.length ? "status statusBad" : "status"}>{regressions.length ? `${regressions.length} candidate-only failure${regressions.length === 1 ? "" : "s"}` : "No candidate-only regressions"}</div> : null}
      </header>

      {error ? <section className="panel error"><h2>Dashboard API unavailable</h2><p>{error}</p></section> : null}
      {!error && !run ? <section className="panel"><h2>No runs yet</h2><p>Run <code>downstreamci run .</code> to populate local history.</p></section> : null}

      {run ? <>
        <section className="runbar">
          <div><span>Upstream</span><strong>{run.upstream}</strong></div>
          <div><span>Ref</span><code>{run.ref.slice(0, 12)}</code></div>
          <label><span>Run</span><select value={run.id} onChange={(event) => setSelectedId(event.target.value)}>{runs.map((item) => <option value={item.id} key={item.id}>{new Date(item.createdAt).toLocaleString()} · {item.id.slice(0, 8)}</option>)}</select></label>
        </section>
        <section className="metrics">
          <article><strong>{run.comparisons.length}</strong><span>downstreams</span></article>
          <article><strong>{counts.unaffected ?? 0}</strong><span>unaffected</span></article>
          <article><strong>{counts["baseline-failing"] ?? 0}</strong><span>baseline-failing</span></article>
          <article><strong>{counts["newly-broken"] ?? 0}</strong><span>newly-broken</span></article>
        </section>
        <nav className="tabs">
          {(["matrix", "failures", "logs", "analysis", "runtime", "history"] as View[]).map((item) => <button className={view === item ? "active" : ""} onClick={() => setView(item)} key={item}>{item}</button>)}
        </nav>
        {view === "matrix" ? <Matrix comparisons={run.comparisons} /> : null}
        {view === "failures" ? <Failures comparisons={run.comparisons} /> : null}
        {view === "logs" ? <Logs comparisons={run.comparisons} /> : null}
        {view === "analysis" ? <Analysis comparisons={run.comparisons} /> : null}
        {view === "runtime" ? <Runtime comparisons={run.comparisons} /> : null}
        {view === "history" ? <History runs={runs} /> : null}
      </> : null}
    </main>
  );
}

function Matrix({ comparisons }: { comparisons: Comparison[] }) {
  return <section className="panel"><div className="panelTitle"><h2>Baseline / candidate matrix</h2><span>Deterministic CI fact</span></div><table><thead><tr><th>Downstream</th><th>Baseline</th><th>Candidate</th><th>Classification</th></tr></thead><tbody>{comparisons.map((item, index) => <tr key={`${item.downstream?.repository ?? "downstream"}-${index}`}><td>{item.downstream?.repository ?? "downstream"}<small>{item.downstream?.ref}</small></td><td>{outcome(item.baseline.test)}</td><td>{outcome(item.candidate.test)}</td><td><code>{item.classification}</code></td></tr>)}</tbody></table></section>;
}

function Failures({ comparisons }: { comparisons: Comparison[] }) {
  const failures = comparisons.filter((item) => item.classification !== "unaffected");
  return <section className="stack">{failures.length ? failures.map((item, index) => <article className="panel" key={index}><div className="panelTitle"><h2>{item.downstream?.repository ?? "downstream"}</h2><code>{item.classification}</code></div><p>{item.reason}</p>{item.candidateSignature ? <p>Signature <code>{item.candidateSignature}</code></p> : null}</article>) : <article className="panel"><h2>No failures</h2><p>Every approved downstream passed baseline and candidate.</p></article>}</section>;
}

function Logs({ comparisons }: { comparisons: Comparison[] }) {
  return <section className="stack">{comparisons.map((item, index) => <article className="panel" key={index}><h2>{item.downstream?.repository ?? "downstream"}</h2><div className="loggrid"><Log title="Baseline" result={item.baseline.test}/><Log title="Candidate" result={item.candidate.test}/></div></article>)}</section>;
}

function Log({ title, result }: { title: string; result: CommandResult }) {
  const text = `${result.stderr}\n${result.stdout}`.trim() || "(no output)";
  return <div><div className="panelTitle"><strong>{title}</strong><span>{result.durationMs} ms · exit {result.exitCode ?? "null"}</span></div><pre>{text.slice(-12000)}</pre></div>;
}

function Analysis({ comparisons }: { comparisons: Comparison[] }) {
  const items = comparisons.filter((item) => item.analysis);
  return <section className="stack">{items.length ? items.map((item, index) => <article className="panel" key={index}><p className="analysis">ANALYSIS · {item.analysis?.harness}</p><h2>{item.downstream?.repository ?? "downstream"}</h2><pre>{item.analysis?.raw}</pre></article>) : <article className="panel"><h2>No agent analysis</h2><p>Agent output only appears for candidate-only failures when a harness is explicitly selected.</p></article>}</section>;
}

function Runtime({ comparisons }: { comparisons: Comparison[] }) {
  return <section className="stack">{comparisons.map((item, index) => <article className="panel" key={index}><h2>{item.downstream?.repository ?? "downstream"}</h2><pre>{JSON.stringify(item.candidate.environment, null, 2)}</pre></article>)}</section>;
}

function History({ runs }: { runs: StoredRun[] }) {
  return <section className="panel"><div className="panelTitle"><h2>Historical compatibility</h2><span>{runs.length} recent runs</span></div><table><thead><tr><th>When</th><th>Ref</th><th>Downstreams</th><th>Regressions</th></tr></thead><tbody>{runs.map((run) => <tr key={run.id}><td>{new Date(run.createdAt).toLocaleString()}</td><td><code>{run.ref.slice(0, 12)}</code></td><td>{run.comparisons.length}</td><td>{run.comparisons.filter((item) => item.classification === "newly-broken").length}</td></tr>)}</tbody></table></section>;
}

function outcome(result: CommandResult): string {
  if (result.timedOut) return "timeout";
  return result.exitCode === 0 ? "pass" : "fail";
}
