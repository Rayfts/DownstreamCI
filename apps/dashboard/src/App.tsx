import { useEffect, useMemo, useState } from "react";

type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
};
type Execution = { test: CommandResult; environment: Record<string, string> };
type Artifact = { kind: string; path: string; sha256: string; bytes: number };
type Cluster = { id: string; fingerprint: string; label: string; members: number };
type Comparison = {
  downstream?: { repository: string; ref: string; ecosystem?: string; tags?: string[]; priority?: string };
  classification: string;
  confidence?: number;
  cluster?: Cluster;
  artifacts?: Artifact[];
  reason: string;
  baseline: Execution;
  candidate: Execution;
  analysis?: { harness: string; raw: string; label: "ANALYSIS" };
  candidateSignature?: string;
};
type StoredRun = { id: string; createdAt: number; upstream: string; ref: string; comparisons: Comparison[] };
type DownstreamSignal = {
  repository: string;
  runs: number;
  regressions: number;
  flaky: number;
  baselineFailing: number;
  unaffected: number;
  highSignalScore: number;
};
type ClusterSignal = { id: string; label: string; occurrences: number; repositories: string[] };
type HistorySignals = {
  downstreams: DownstreamSignal[];
  clusters: ClusterSignal[];
  classifications: Record<string, number>;
  ecosystems: Record<string, Record<string, number>>;
  runtimes: Record<string, Record<string, number>>;
};

type View = "matrix" | "failures" | "clusters" | "artifacts" | "logs" | "analysis" | "runtime" | "history";

export function App() {
  const [runs, setRuns] = useState<StoredRun[]>([]);
  const [signals, setSignals] = useState<HistorySignals | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [view, setView] = useState<View>("matrix");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const base = import.meta.env.VITE_API_BASE ?? "";
    Promise.all([fetchJson<{ runs: StoredRun[] }>(`${base}/api/runs/latest?limit=30`), fetchJson<{ signals: HistorySignals }>(`${base}/api/signals?limit=100`)])
      .then(([runData, signalData]) => {
        setRuns(runData.runs);
        setSignals(signalData.signals);
        setSelectedId(runData.runs[0]?.id ?? "");
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  const run = runs.find((item) => item.id === selectedId) ?? runs[0];
  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const comparison of run?.comparisons ?? []) {
      result[comparison.classification] = (result[comparison.classification] ?? 0) + 1;
    }
    return result;
  }, [run]);
  const regressions = run?.comparisons.filter((item) => item.classification === "newly-broken") ?? [];

  return (
    <main className="shell">
      <header>
        <div>
          <p className="eyebrow">DownstreamCI</p>
          <h1>Compatibility evidence</h1>
        </div>
        {run ? (
          <div className={regressions.length ? "status statusBad" : "status"}>
            {regressions.length
              ? `${regressions.length} candidate-only failure${regressions.length === 1 ? "" : "s"}`
              : "No candidate-only regressions"}
          </div>
        ) : null}
      </header>

      {error ? (
        <section className="panel error">
          <h2>Dashboard API unavailable</h2>
          <p>{error}</p>
        </section>
      ) : null}
      {!error && !run ? (
        <section className="panel">
          <h2>No runs yet</h2>
          <p>
            Run <code>downstreamci run .</code> to populate local history.
          </p>
        </section>
      ) : null}

      {run ? (
        <>
          <section className="runbar">
            <div>
              <span>Upstream</span>
              <strong>{run.upstream}</strong>
            </div>
            <div>
              <span>Ref</span>
              <code>{run.ref.slice(0, 12)}</code>
            </div>
            <label>
              <span>Run</span>
              <select value={run.id} onChange={(event) => setSelectedId(event.target.value)}>
                {runs.map((item) => (
                  <option value={item.id} key={item.id}>
                    {new Date(item.createdAt).toLocaleString()} · {item.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
          </section>
          <section className="metrics">
            <article><strong>{run.comparisons.length}</strong><span>downstreams</span></article>
            <article><strong>{counts.unaffected ?? 0}</strong><span>unaffected</span></article>
            <article><strong>{counts.flaky ?? 0}</strong><span>flaky</span></article>
            <article><strong>{counts["newly-broken"] ?? 0}</strong><span>newly-broken</span></article>
          </section>
          <nav className="tabs">
            {(["matrix", "failures", "clusters", "artifacts", "logs", "analysis", "runtime", "history"] as View[]).map((item) => (
              <button type="button" className={view === item ? "active" : ""} onClick={() => setView(item)} key={item}>
                {item}
              </button>
            ))}
          </nav>
          {view === "matrix" ? <Matrix comparisons={run.comparisons} /> : null}
          {view === "failures" ? <Failures comparisons={run.comparisons} /> : null}
          {view === "clusters" ? <Clusters comparisons={run.comparisons} /> : null}
          {view === "artifacts" ? <Artifacts comparisons={run.comparisons} /> : null}
          {view === "logs" ? <Logs comparisons={run.comparisons} /> : null}
          {view === "analysis" ? <Analysis comparisons={run.comparisons} /> : null}
          {view === "runtime" ? <Runtime comparisons={run.comparisons} signals={signals} /> : null}
          {view === "history" ? <History runs={runs} signals={signals} /> : null}
        </>
      ) : null}
    </main>
  );
}

function Matrix({ comparisons }: { comparisons: Comparison[] }) {
  return (
    <section className="panel">
      <div className="panelTitle"><h2>Baseline / candidate matrix</h2><span>Deterministic CI fact</span></div>
      <table>
        <thead><tr><th>Downstream</th><th>Baseline</th><th>Candidate</th><th>Classification</th><th>Confidence</th></tr></thead>
        <tbody>
          {comparisons.map((item) => (
            <tr key={comparisonKey(item)}>
              <td>{item.downstream?.repository ?? "downstream"}<small>{item.downstream?.ref}</small></td>
              <td>{outcome(item.baseline.test)}</td>
              <td>{outcome(item.candidate.test)}</td>
              <td><code>{item.classification}</code></td>
              <td>{item.confidence === undefined ? "—" : `${Math.round(item.confidence * 100)}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Failures({ comparisons }: { comparisons: Comparison[] }) {
  const failures = comparisons.filter((item) => item.classification !== "unaffected");
  return (
    <section className="stack">
      {failures.length ? failures.map((item) => (
        <article className="panel" key={comparisonKey(item)}>
          <div className="panelTitle"><h2>{item.downstream?.repository ?? "downstream"}</h2><code>{item.classification}</code></div>
          <p>{item.reason}</p>
          {item.cluster ? <p>Cluster <code>{item.cluster.id}</code> · {item.cluster.label}</p> : null}
          {item.candidateSignature ? <p>Signature <code>{item.candidateSignature}</code></p> : null}
        </article>
      )) : <article className="panel"><h2>No failures</h2><p>Every approved downstream passed baseline and candidate.</p></article>}
    </section>
  );
}

function Clusters({ comparisons }: { comparisons: Comparison[] }) {
  const clusters = new Map<string, { cluster: Cluster; repositories: string[] }>();
  for (const comparison of comparisons) {
    if (!comparison.cluster) continue;
    const current = clusters.get(comparison.cluster.id) ?? { cluster: comparison.cluster, repositories: [] };
    current.repositories.push(comparison.downstream?.repository ?? "downstream");
    clusters.set(comparison.cluster.id, current);
  }
  const values = [...clusters.values()];
  return (
    <section className="stack">
      {values.length ? values.map(({ cluster, repositories }) => (
        <article className="panel" key={cluster.id}>
          <div className="panelTitle"><h2>{cluster.label}</h2><code>{cluster.id}</code></div>
          <p>{repositories.length} affected downstream{repositories.length === 1 ? "" : "s"}: {repositories.join(", ")}</p>
          <p>Fingerprint <code>{cluster.fingerprint}</code></p>
        </article>
      )) : <article className="panel"><h2>No regression clusters</h2><p>This run has no candidate-only failure signatures to group.</p></article>}
    </section>
  );
}

function Artifacts({ comparisons }: { comparisons: Comparison[] }) {
  const rows = comparisons.flatMap((comparison) =>
    (comparison.artifacts ?? []).map((artifact) => ({ repository: comparison.downstream?.repository ?? "downstream", artifact })),
  );
  return (
    <section className="panel">
      <div className="panelTitle"><h2>Evidence artifacts</h2><span>{rows.length} files</span></div>
      {rows.length ? <table><thead><tr><th>Downstream</th><th>Kind</th><th>Path</th><th>SHA-256</th><th>Bytes</th></tr></thead><tbody>{rows.map(({ repository, artifact }) => <tr key={`${repository}-${artifact.path}`}><td>{repository}</td><td>{artifact.kind}</td><td><code>{artifact.path}</code></td><td><code>{artifact.sha256.slice(0, 16)}</code></td><td>{artifact.bytes}</td></tr>)}</tbody></table> : <p>No artifact references were persisted for this run.</p>}
    </section>
  );
}

function Logs({ comparisons }: { comparisons: Comparison[] }) {
  return <section className="stack">{comparisons.map((item) => <article className="panel" key={comparisonKey(item)}><h2>{item.downstream?.repository ?? "downstream"}</h2><div className="loggrid"><Log title="Baseline" result={item.baseline.test}/><Log title="Candidate" result={item.candidate.test}/></div></article>)}</section>;
}

function Log({ title, result }: { title: string; result: CommandResult }) {
  const text = `${result.stderr}\n${result.stdout}`.trim() || "(no output)";
  return <div><div className="panelTitle"><strong>{title}</strong><span>{result.durationMs} ms · exit {result.exitCode ?? "null"}</span></div><pre>{text.slice(-12000)}</pre></div>;
}

function Analysis({ comparisons }: { comparisons: Comparison[] }) {
  const items = comparisons.filter((item) => item.analysis);
  return <section className="stack">{items.length ? items.map((item) => <article className="panel" key={comparisonKey(item)}><p className="analysis">ANALYSIS · {item.analysis?.harness}</p><h2>{item.downstream?.repository ?? "downstream"}</h2><pre>{item.analysis?.raw}</pre></article>) : <article className="panel"><h2>No agent analysis</h2><p>Agent output only appears for candidate-only failures when a harness is explicitly selected.</p></article>}</section>;
}

function Runtime({ comparisons, signals }: { comparisons: Comparison[]; signals: HistorySignals | null }) {
  return (
    <section className="stack">
      {comparisons.map((item) => <article className="panel" key={comparisonKey(item)}><div className="panelTitle"><h2>{item.downstream?.repository ?? "downstream"}</h2><span>{item.downstream?.ecosystem ?? "auto"}</span></div><pre>{JSON.stringify(item.candidate.environment, null, 2)}</pre></article>)}
      {signals ? <article className="panel"><div className="panelTitle"><h2>Historical runtime / ecosystem matrix</h2><span>recent runs</span></div><pre>{JSON.stringify({ ecosystems: signals.ecosystems, runtimes: signals.runtimes }, null, 2)}</pre></article> : null}
    </section>
  );
}

function History({ runs, signals }: { runs: StoredRun[]; signals: HistorySignals | null }) {
  return (
    <section className="stack">
      <article className="panel">
        <div className="panelTitle"><h2>Historical compatibility</h2><span>{runs.length} recent runs</span></div>
        <table><thead><tr><th>When</th><th>Ref</th><th>Downstreams</th><th>Regressions</th></tr></thead><tbody>{runs.map((run) => <tr key={run.id}><td>{new Date(run.createdAt).toLocaleString()}</td><td><code>{run.ref.slice(0, 12)}</code></td><td>{run.comparisons.length}</td><td>{run.comparisons.filter((item) => item.classification === "newly-broken").length}</td></tr>)}</tbody></table>
      </article>
      {signals ? <article className="panel"><div className="panelTitle"><h2>Downstream signal history</h2><span>higher is cleaner signal</span></div><table><thead><tr><th>Downstream</th><th>Runs</th><th>Regressions</th><th>Flaky</th><th>Baseline failing</th><th>Signal</th></tr></thead><tbody>{signals.downstreams.map((item) => <tr key={item.repository}><td>{item.repository}</td><td>{item.runs}</td><td>{item.regressions}</td><td>{item.flaky}</td><td>{item.baselineFailing}</td><td>{Math.round(item.highSignalScore * 100)}%</td></tr>)}</tbody></table></article> : null}
      {signals?.clusters.length ? <article className="panel"><div className="panelTitle"><h2>Repeated failure clusters</h2><span>{signals.clusters.length} tracked</span></div><table><thead><tr><th>Cluster</th><th>Occurrences</th><th>Downstreams</th></tr></thead><tbody>{signals.clusters.map((cluster) => <tr key={cluster.id}><td>{cluster.label}<small>{cluster.id}</small></td><td>{cluster.occurrences}</td><td>{cluster.repositories.join(", ")}</td></tr>)}</tbody></table></article> : null}
    </section>
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`API returned ${response.status}`);
  return (await response.json()) as T;
}

function comparisonKey(comparison: Comparison): string {
  const repository = comparison.downstream?.repository ?? "downstream";
  const ref = comparison.downstream?.ref ?? "unknown";
  return `${repository}@${ref}`;
}

function outcome(result: CommandResult): string {
  if (result.timedOut) return "timeout";
  return result.exitCode === 0 ? "pass" : "fail";
}
