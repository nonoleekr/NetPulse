import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { WebSocketEvent } from "@netpulse/contracts";
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
  kind: "HTTP" | "TCP" | "ICMP";
  host: string | null;
  port: number | null;
  measurements: Measurement[];
  completedProbes: number;
  failedProbes: number;
  packetLossPercent: number | null;
  sampledAvailabilityPercent: number | null;
  status: "UP" | "DOWN" | "PAUSED" | "UNKNOWN";
  activeOutage: { id: string; startedAt: string; endedAt: string | null; failureCount: number; reason: string | null } | null;
};
type History = {
  measurements: Measurement[];
  outages: { id: string; startedAt: string; endedAt: string | null }[];
  durationAvailabilityPercent: number;
  sampledAvailabilityPercent: number | null;
  packetLossPercent: number | null;
  averageLatencyMs: number | null;
  minimumLatencyMs: number | null;
  maximumLatencyMs: number | null;
  successfulProbes: number;
  failedProbes: number;
  outageCount: number;
};

const api = "http://localhost:4000/api";
const websocketUrl = "ws://localhost:4000/ws";
type ConnectionStatus = "live" | "reconnecting" | "offline";

function App() {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [name, setName] = useState("Local test");
  const [url, setUrl] = useState("https://example.com");
  const [kind, setKind] = useState<Monitor["kind"]>("HTTP");
  const [host, setHost] = useState("example.com");
  const [port, setPort] = useState("443");
  const [error, setError] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("reconnecting");
  const [historyHours, setHistoryHours] = useState("24");
  const [history, setHistory] = useState<Record<string, History>>({});
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const socket = useRef<WebSocket | undefined>(undefined);
  const reconnectAttempt = useRef(0);

  const load = () => fetch(`${api}/monitors`).then((res) => res.json()).then((body) => setMonitors(body.data));
  const loadMonitor = (monitorId: string) => fetch(`${api}/monitors/${monitorId}`).then((res) => res.json()).then((body) => {
    if (!body.data) return;
    setMonitors((current) => current.some((monitor) => monitor.id === monitorId)
      ? current.map((monitor) => monitor.id === monitorId ? body.data : monitor)
      : [...current, body.data]);
  });
  const loadHistory = (monitorId: string) => fetch(`${api}/monitors/${monitorId}/history?hours=${historyHours}`).then((res) => res.json()).then((body) => {
    if (body.data) setHistory((current) => ({ ...current, [monitorId]: body.data }));
  });

  useEffect(() => {
    void load().then(() => {
      void fetch(`${api}/monitors`).then((res) => res.json()).then((body) => {
        for (const monitor of body.data as Monitor[]) void loadHistory(monitor.id);
      });
    });
  }, [historyHours]);
  useEffect(() => {
    let disposed = false;
    const connect = () => {
      if (disposed) return;
      setConnectionStatus("reconnecting");
      const currentSocket = new WebSocket(websocketUrl);
      socket.current = currentSocket;
      currentSocket.onopen = () => {
        reconnectAttempt.current = 0;
        setConnectionStatus("live");
        void load();
      };
      currentSocket.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data) as WebSocketEvent;
          if (event.type === "measurement.completed" || event.type === "outage.started" || event.type === "outage.recovered" || event.type === "monitor.status_changed") {
            void loadMonitor(event.payload.monitorId);
            void loadHistory(event.payload.monitorId);
          }
        } catch {
          setConnectionStatus("offline");
        }
      };
      currentSocket.onerror = () => setConnectionStatus("offline");
      currentSocket.onclose = () => {
        if (disposed) return;
        setConnectionStatus("offline");
        const delay = Math.min(5000, 250 * 2 ** reconnectAttempt.current);
        reconnectAttempt.current += 1;
        reconnectTimer.current = setTimeout(connect, delay);
      };
    };
    connect();
    return () => {
      disposed = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      socket.current?.close(1000, "Dashboard closed");
    };
  }, []);

  async function addMonitor(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const response = await fetch(`${api}/monitors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(kind === "HTTP"
        ? { name, kind, url, intervalSeconds: 30, timeoutMs: 5000 }
        : { name, kind, host, ...(kind === "TCP" ? { port: Number(port) } : {}), intervalSeconds: 30, timeoutMs: 5000 }),
    });
    const body = await response.json();
    if (!response.ok) { setError(body.error?.message ?? "Could not create monitor"); return; }
    await load();
  }

  return <main>
    <header><p className="eyebrow">NETPULSE / MILESTONE 04</p><h1>Know when the network changes.</h1><p className="subtitle">Real HTTP, TCP, and ICMP monitoring with outage history.</p><span className={`connection ${connectionStatus}`}>{connectionStatus === "live" ? "Live" : connectionStatus === "reconnecting" ? "Reconnecting" : "Offline"}</span></header>
    <section className="panel">
      <h2>Add a monitor</h2>
      <form onSubmit={addMonitor}>
        <input aria-label="Monitor name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Monitor name" />
        <select aria-label="Probe type" value={kind} onChange={(e) => setKind(e.target.value as Monitor["kind"])}>
          <option value="HTTP">HTTP(S)</option>
          <option value="TCP">TCP</option>
          <option value="ICMP">ICMP</option>
        </select>
        {kind === "HTTP"
          ? <input aria-label="HTTP URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" />
          : <input aria-label="Host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="example.com or IP address" />}
        {kind === "TCP" && <input aria-label="TCP port" type="number" min="1" max="65535" value={port} onChange={(e) => setPort(e.target.value)} placeholder="443" />}
        <button type="submit">Start monitoring</button>
      </form>
      {error && <p className="error">{error}</p>}
    </section>
    <section className="grid">
      {monitors.map((monitor) => {
        const latest = monitor.measurements[0];
        const monitorHistory = history[monitor.id];
        const points = monitorHistory?.measurements.slice(-30) ?? [];
        return <article className="card" key={monitor.id}>
          <div className="card-top"><div><h2>{monitor.name}</h2><p>{monitor.kind} · {monitor.kind === "TCP" ? `${monitor.host}:${monitor.port}` : monitor.kind === "ICMP" ? monitor.host : monitor.url}</p></div><span className={`pill ${monitor.status.toLowerCase()}`} aria-label={`Monitor status: ${monitor.status}`}>{monitor.status}</span></div>
          <div className="metric"><strong>{latest?.latencyMs ?? "—"}{latest?.latencyMs ? " ms" : ""}</strong><span>latest latency</span></div>
          <div className="stats"><span><strong>{monitorHistory?.sampledAvailabilityPercent ?? monitor.sampledAvailabilityPercent ?? "—"}%</strong> sampled availability</span><span><strong>{monitorHistory?.packetLossPercent ?? monitor.packetLossPercent ?? "—"}%</strong> packet loss</span><span><strong>{monitorHistory?.durationAvailabilityPercent ?? "—"}%</strong> duration availability</span></div>
          <div className="stats secondary"><span><strong>{monitorHistory?.averageLatencyMs ?? "—"} ms</strong> average latency</span><span><strong>{monitorHistory?.minimumLatencyMs ?? "—"}–{monitorHistory?.maximumLatencyMs ?? "—"} ms</strong> min–max latency</span><span><strong>{monitorHistory?.outageCount ?? 0}</strong> outages</span></div>
          <div className="history-heading"><span>Last {historyHours}h</span><label>Window <select value={historyHours} onChange={(e) => setHistoryHours(e.target.value)}><option value="1">1h</option><option value="6">6h</option><option value="24">24h</option><option value="168">7d</option><option value="720">30d</option></select></label></div>
          <div className="history-chart" aria-label="Recent latency and probe result history">{points.map((point) => {
            const maximum = Math.max(...points.flatMap((item) => item.latencyMs === null ? [] : [item.latencyMs]), 1);
            const height = point.latencyMs === null ? 8 : Math.max(8, Math.round((point.latencyMs / maximum) * 30));
            return <span key={point.completedAt} className={`history-point ${point.success ? "success" : "failure"}`} style={{ height }} title={`${new Date(point.completedAt).toLocaleString()} — ${point.success ? `${point.latencyMs ?? "No latency"} ms` : "failed probe"}`} />;
          })}</div>
          {monitorHistory?.outages.length ? <div className="outage-history" aria-label="Outage history">{monitorHistory.outages.map((outage) => <p key={outage.id}><strong>{new Date(outage.startedAt).toLocaleString()}</strong> → {outage.endedAt ? new Date(outage.endedAt).toLocaleString() : "ongoing"}</p>)}</div> : null}
          {monitor.activeOutage ? <p className="outage-note">Outage since {new Date(monitor.activeOutage.startedAt).toLocaleString()} ({monitor.activeOutage.failureCount} failures)</p> : monitorHistory?.outages.length ? <p className="outage-note">{monitorHistory.outages.length} outage{monitorHistory.outages.length === 1 ? "" : "s"} in this window</p> : null}
          <p className="muted">{latest ? `Checked ${new Date(latest.completedAt).toLocaleString()}` : "First real probe is running..."}</p>
        </article>;
      })}
      {!monitors.length && <div className="empty">Add a URL above to begin collecting real measurements.</div>}
    </section>
  </main>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
