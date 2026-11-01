import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { WebSocketEvent } from "@netpulse/contracts";
import "./style.css";

type Measurement = {
  id?: string;
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
  enabled: boolean;
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${api}${path}`, init);
  } catch {
    throw new Error("The API is unavailable. Check that the backend is running.");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message ?? "The request could not be completed.");
  return body.data as T;
}

function formatStatus(status: Monitor["status"]) {
  return status === "UP" ? "Up" : status === "DOWN" ? "Down" : status === "PAUSED" ? "Paused" : "Unknown";
}

function App() {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [name, setName] = useState("Local test");
  const [url, setUrl] = useState("https://example.com");
  const [kind, setKind] = useState<Monitor["kind"]>("HTTP");
  const [host, setHost] = useState("example.com");
  const [port, setPort] = useState("443");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("reconnecting");
  const [historyHours, setHistoryHours] = useState("24");
  const [history, setHistory] = useState<Record<string, History>>({});
  const [historyError, setHistoryError] = useState("");
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const socket = useRef<WebSocket | undefined>(undefined);
  const reconnectAttempt = useRef(0);

  const load = async () => {
    const data = await request<Monitor[]>("/monitors");
    setMonitors(data);
    return data;
  };
  const loadMonitor = async (monitorId: string) => {
    try {
      const data = await request<Monitor>(`/monitors/${monitorId}`);
      setMonitors((current) => current.some((monitor) => monitor.id === monitorId)
        ? current.map((monitor) => monitor.id === monitorId ? data : monitor)
        : [...current, data]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not refresh monitor.");
    }
  };
  const loadHistory = async (monitorId: string) => {
    try {
      const data = await request<History>(`/monitors/${monitorId}/history?hours=${historyHours}`);
      setHistory((current) => ({ ...current, [monitorId]: data }));
    } catch (loadError) {
      setHistoryError(loadError instanceof Error ? loadError.message : "Could not load history.");
    }
  };

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError("");
    void load()
      .then((data) => Promise.all(data.map((monitor) => loadHistory(monitor.id))))
      .catch((loadError) => {
        if (!disposed) setError(loadError instanceof Error ? loadError.message : "Could not load monitors.");
      })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
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
        void load().catch(() => setConnectionStatus("offline"));
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
    setSubmitting(true);
    try {
      await request<Monitor>("/monitors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(kind === "HTTP"
          ? { name, kind, url, intervalSeconds: 30, timeoutMs: 5000 }
          : { name, kind, host, ...(kind === "TCP" ? { port: Number(port) } : {}), intervalSeconds: 30, timeoutMs: 5000 }),
      });
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not create monitor.");
    } finally {
      setSubmitting(false);
    }
  }

  async function updateMonitor(monitor: Monitor, enabled: boolean) {
    setActionId(monitor.id);
    setError("");
    try {
      await request(`/monitors/${monitor.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      await loadMonitor(monitor.id);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not update monitor.");
    } finally {
      setActionId(null);
    }
  }

  async function deleteMonitor(monitor: Monitor) {
    if (!window.confirm(`Delete "${monitor.name}" and its history? This cannot be undone.`)) return;
    setActionId(monitor.id);
    try {
      await request(`/monitors/${monitor.id}`, { method: "DELETE" });
      setMonitors((current) => current.filter((item) => item.id !== monitor.id));
      setHistory((current) => {
        const next = { ...current };
        delete next[monitor.id];
        return next;
      });
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not delete monitor.");
    } finally {
      setActionId(null);
    }
  }

  return <main>
    <header>
      <p className="eyebrow">NETPULSE / OPERATIONS</p>
      <h1>Know when the network changes.</h1>
      <p className="subtitle">Real HTTP, TCP, and ICMP monitoring with outage history.</p>
      <span className={`connection ${connectionStatus}`} role="status" aria-live="polite">
        <span className="status-dot" aria-hidden="true" />{connectionStatus === "live" ? "Live updates" : connectionStatus === "reconnecting" ? "Reconnecting" : "Offline"}
      </span>
    </header>
    <section className="panel" aria-labelledby="add-heading">
      <div className="section-heading"><div><p className="section-kicker">New check</p><h2 id="add-heading">Add a monitor</h2></div><span className="panel-note">Runs every 30 seconds</span></div>
      <form onSubmit={addMonitor}>
        <label>Monitor name<input aria-label="Monitor name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Monitor name" /></label>
        <label>Probe type<select aria-label="Probe type" value={kind} onChange={(e) => setKind(e.target.value as Monitor["kind"])}><option value="HTTP">HTTP(S)</option><option value="TCP">TCP</option><option value="ICMP">ICMP</option></select></label>
        <label className="grow">{kind === "HTTP" ? "HTTP URL" : "Host"}{kind === "HTTP" ? <input aria-label="HTTP URL" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" /> : <input aria-label="Host" required value={host} onChange={(e) => setHost(e.target.value)} placeholder="example.com or IP address" />}</label>
        {kind === "TCP" && <label>TCP port<input aria-label="TCP port" required type="number" min="1" max="65535" value={port} onChange={(e) => setPort(e.target.value)} /></label>}
        <button type="submit" disabled={submitting}>{submitting ? "Starting…" : "Start monitoring"}</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
    <div className="content-heading"><div><p className="section-kicker">Fleet view</p><h2>Monitors</h2></div><span className="muted">{monitors.length} configured</span></div>
    <section className="grid" aria-live="polite">
      {loading && <div className="empty"><strong>Loading monitors…</strong><span>Connecting to the local API.</span></div>}
      {!loading && !monitors.length && <div className="empty"><strong>No monitors yet</strong><span>Add a real HTTP, TCP, or ICMP target above to begin collecting measurements.</span></div>}
      {!loading && monitors.map((monitor) => {
        const latest = monitor.measurements[0];
        const monitorHistory = history[monitor.id];
        const points = monitorHistory?.measurements.slice(-30) ?? [];
        const maximum = Math.max(...points.flatMap((item) => item.latencyMs === null ? [] : [item.latencyMs]), 1);
        return <article className="card" key={monitor.id}>
          <div className="card-top"><div><h3>{monitor.name}</h3><p>{monitor.kind} · {monitor.kind === "TCP" ? `${monitor.host}:${monitor.port}` : monitor.kind === "ICMP" ? monitor.host : monitor.url}</p></div><span className={`pill ${monitor.status.toLowerCase()}`} aria-label={`Monitor status: ${formatStatus(monitor.status)}`}>{formatStatus(monitor.status)}</span></div>
          <div className="metric"><strong>{latest?.latencyMs ?? "—"}{latest?.latencyMs ? " ms" : ""}</strong><span>{latest ? latest.success ? "latest response" : "latest probe failed" : "awaiting first probe"}</span></div>
          <div className="stats"><span><strong>{monitorHistory?.sampledAvailabilityPercent ?? monitor.sampledAvailabilityPercent ?? "—"}%</strong>sampled availability</span><span><strong>{monitorHistory?.packetLossPercent ?? monitor.packetLossPercent ?? "—"}%</strong>packet loss</span><span><strong>{monitorHistory?.outageCount ?? 0}</strong>outages</span></div>
          <div className="history-heading"><span>History · {historyHours === "24" ? "24 hours" : historyHours === "720" ? "30 days" : `${historyHours} hours`}</span><label>Window <select value={historyHours} onChange={(e) => setHistoryHours(e.target.value)}><option value="1">1 hour</option><option value="6">6 hours</option><option value="24">24 hours</option><option value="168">7 days</option><option value="720">30 days</option></select></label></div>
          {historyError && <p className="error compact" role="alert">{historyError}</p>}
          <div className="history-chart" aria-label="Recent latency and probe result history">{points.map((point, index) => {
            const height = point.latencyMs === null ? 8 : Math.max(8, Math.round((point.latencyMs / maximum) * 34));
            return <span key={point.id ?? `${point.completedAt}-${index}`} className={`history-point ${point.success ? "success" : "failure"}`} style={{ height }} title={`${new Date(point.completedAt).toLocaleString()} — ${point.success ? `${point.latencyMs ?? "No latency"} ms` : "failed probe"}`} />;
          })}{!points.length && <span className="chart-empty">No measurements in this window</span>}</div>
          <div className="card-footer"><span className="muted">{latest ? `Checked ${new Date(latest.completedAt).toLocaleString()}` : "First real probe is running…"}</span><div className="actions"><button className="secondary" disabled={actionId === monitor.id} onClick={() => void updateMonitor(monitor, !monitor.enabled)}>{monitor.enabled ? "Pause" : "Resume"}</button><button className="secondary danger" disabled={actionId === monitor.id} onClick={() => void deleteMonitor(monitor)}>Delete</button></div></div>
          {monitor.activeOutage && <p className="outage-note" role="status">Down since {new Date(monitor.activeOutage.startedAt).toLocaleString()} · {monitor.activeOutage.failureCount} consecutive failures</p>}
          {monitorHistory?.outages.length ? <div className="outage-history" aria-label="Outage history"><strong>Outage history</strong>{monitorHistory.outages.slice(-3).map((outage) => <p key={outage.id}>{new Date(outage.startedAt).toLocaleString()} → {outage.endedAt ? new Date(outage.endedAt).toLocaleString() : "ongoing"}</p>)}</div> : null}
        </article>;
      })}
    </section>
  </main>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
