import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type Measurement = {
  success: boolean;
  latencyMs: number | null;
  statusCode: number | null;
  errorCode: string | null;
  completedAt: string;
};
type Monitor = {
  id: string;
  name: string;
  url: string;
  measurements: Measurement[];
  completedProbes: number;
  failedProbes: number;
  packetLossPercent: number | null;
  sampledAvailabilityPercent: number | null;
};

const api = "http://localhost:4000/api";

function App() {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [name, setName] = useState("Local test");
  const [url, setUrl] = useState("https://example.com");
  const [error, setError] = useState("");

  const load = () => fetch(`${api}/monitors`).then((res) => res.json()).then((body) => setMonitors(body.data));
  useEffect(() => { void load(); }, []);

  async function addMonitor(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const response = await fetch(`${api}/monitors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, url, intervalSeconds: 30, timeoutMs: 5000 }),
    });
    const body = await response.json();
    if (!response.ok) { setError(body.error?.message ?? "Could not create monitor"); return; }
    await load();
  }

  return <main>
    <header><p className="eyebrow">NETPULSE / MILESTONE 01</p><h1>Know when the network changes.</h1><p className="subtitle">A local-first monitor measuring real HTTP reachability.</p></header>
    <section className="panel">
      <h2>Add an HTTP monitor</h2>
      <form onSubmit={addMonitor}>
        <input aria-label="Monitor name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Monitor name" />
        <input aria-label="HTTP URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" />
        <button type="submit">Start monitoring</button>
      </form>
      {error && <p className="error">{error}</p>}
    </section>
    <section className="grid">
      {monitors.map((monitor) => {
        const latest = monitor.measurements[0];
        return <article className="card" key={monitor.id}>
          <div className="card-top"><div><h2>{monitor.name}</h2><p>{monitor.url}</p></div><span className={latest?.success ? "pill up" : "pill down"}>{latest?.success ? "ONLINE" : latest ? "DOWN" : "WAITING"}</span></div>
          <div className="metric"><strong>{latest?.latencyMs ?? "—"}{latest?.latencyMs ? " ms" : ""}</strong><span>latest latency</span></div>
          <div className="stats"><span><strong>{monitor.sampledAvailabilityPercent ?? "—"}%</strong> sampled availability</span><span><strong>{monitor.packetLossPercent ?? "—"}%</strong> packet loss</span></div>
          <p className="muted">{latest ? `Checked ${new Date(latest.completedAt).toLocaleString()}` : "First real probe is running..."}</p>
        </article>;
      })}
      {!monitors.length && <div className="empty">Add a URL above to begin collecting real measurements.</div>}
    </section>
  </main>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
