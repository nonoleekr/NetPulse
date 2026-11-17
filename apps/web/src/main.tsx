import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { DiagnosticKind, DiagnosticRun, NetworkAnalysis, WebSocketEvent } from "@netpulse/contracts";
import "./style.css";

type Measurement = {
  id?: string;
  success: boolean;
  latencyMs: number | null;
  statusCode: number | null;
  errorCode: string | null;
  completedAt: string;
  source?: "LOCAL" | "AGENT";
  agentId?: string | null;
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
  agentId: string | null;
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
type Diagnostic = DiagnosticRun;
type Agent = {
  id: string;
  name: string;
  status: "ENROLLED" | "ONLINE" | "OFFLINE" | "SUSPENDED" | "REVOKED";
  platform: string;
  version: string;
  capabilities: Array<"HTTP" | "TCP" | "ICMP">;
  lastHeartbeatAt: string | null;
  credentialVersion: number;
};

const isViteDevelopment = window.location.port === "5173";
const api = isViteDevelopment ? "http://localhost:4000/api" : "/api";
const websocketUrl = isViteDevelopment
  ? "ws://localhost:4000/ws"
  : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`;
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
  const [diagnosticMonitorId, setDiagnosticMonitorId] = useState("");
  const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null);
  const [diagnosticLoading, setDiagnosticLoading] = useState(false);
  const [diagnosticError, setDiagnosticError] = useState("");
  const [adminToken, setAdminToken] = useState("");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentError, setAgentError] = useState("");
  const [enrollmentToken, setEnrollmentToken] = useState<{ token: string; expiresAt: string } | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [analysis, setAnalysis] = useState<NetworkAnalysis | null>(null);
  const [analysisHours, setAnalysisHours] = useState("24");
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const socket = useRef<WebSocket | undefined>(undefined);
  const reconnectAttempt = useRef(0);

  const adminRequest = <T,>(path: string, init?: RequestInit) => request<T>(path, {
    ...init,
    headers: { ...init?.headers, authorization: `Bearer ${adminToken}` },
  });
  const loadAgents = async () => {
    setAgentError("");
    try { setAgents(await adminRequest<Agent[]>("/admin/agents")); }
    catch (loadError) { setAgentError(loadError instanceof Error ? loadError.message : "Could not load agents."); }
  };
  const loadAnalysis = async () => {
    setAnalysisLoading(true); setAnalysisError("");
    try { setAnalysis(await request<NetworkAnalysis>(`/analysis?hours=${analysisHours}`)); }
    catch (loadError) { setAnalysisError(loadError instanceof Error ? loadError.message : "Could not load analysis."); }
    finally { setAnalysisLoading(false); }
  };
  const createEnrollment = async () => {
    setAgentBusy(true); setAgentError("");
    try { setEnrollmentToken(await adminRequest<{ token: string; expiresAt: string }>("/admin/agents/enrollment-tokens", { method: "POST" })); }
    catch (createError) { setAgentError(createError instanceof Error ? createError.message : "Could not create enrollment token."); }
    finally { setAgentBusy(false); }
  };
  const changeAgent = async (agent: Agent, action: "activate" | "suspend" | "revoke") => {
    if (action === "revoke" && !window.confirm(`Revoke ${agent.name}? Its assigned monitors will return to local execution.`)) return;
    setAgentBusy(true); setAgentError("");
    try { await adminRequest(`/admin/agents/${agent.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) }); await loadAgents(); await load(); }
    catch (changeError) { setAgentError(changeError instanceof Error ? changeError.message : "Could not update agent."); }
    finally { setAgentBusy(false); }
  };
  const assignMonitor = async (agentId: string, monitorId: string) => {
    if (!monitorId) return;
    setAgentBusy(true); setAgentError("");
    try { await adminRequest(`/admin/agents/${agentId}/monitors/${monitorId}`, { method: "PUT" }); await load(); }
    catch (assignError) { setAgentError(assignError instanceof Error ? assignError.message : "Could not assign monitor."); }
    finally { setAgentBusy(false); }
  };

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
  async function runDiagnostic(kind: DiagnosticKind) {
    if (!diagnosticMonitorId) return;
    setDiagnosticLoading(true);
    setDiagnosticError("");
    try {
      setDiagnostic(await request<Diagnostic>(`/monitors/${diagnosticMonitorId}/diagnostics`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind }),
      }));
    } catch (diagnosticRequestError) {
      setDiagnosticError(diagnosticRequestError instanceof Error ? diagnosticRequestError.message : "Diagnostic failed.");
    } finally {
      setDiagnosticLoading(false);
    }
  }

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

  useEffect(() => { void loadAnalysis(); }, [analysisHours]);

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

  const diagnosticMonitor = monitors.find((monitor) => monitor.id === diagnosticMonitorId);

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
    <section className="panel diagnostics" aria-labelledby="diagnostics-heading">
      <div className="section-heading"><div><p className="section-kicker">On-demand analysis</p><h2 id="diagnostics-heading">Diagnostics</h2></div><span className="panel-note">Bounded and user initiated</span></div>
      <div className="diagnostic-controls">
        <label>Monitor<select aria-label="Diagnostic monitor" value={diagnosticMonitorId} onChange={(event) => setDiagnosticMonitorId(event.target.value)}><option value="">Select a monitor</option>{monitors.map((monitor) => <option key={monitor.id} value={monitor.id}>{monitor.name}</option>)}</select></label>
        <button type="button" disabled={!diagnosticMonitorId || diagnosticLoading} onClick={() => void runDiagnostic("DNS")}>{diagnosticLoading ? "Running…" : "Resolve DNS"}</button>
        <button type="button" className="secondary" disabled={!diagnosticMonitorId || diagnosticLoading} onClick={() => void runDiagnostic("ROUTE")}>Trace route</button>
        <button type="button" className="secondary" disabled={diagnosticMonitor?.kind !== "HTTP" || diagnosticLoading} onClick={() => void runDiagnostic("HTTP")}>Inspect HTTP</button>
        <button type="button" className="secondary" disabled={diagnosticMonitor?.kind !== "HTTP" || !diagnosticMonitor.url.startsWith("https://") || diagnosticLoading} onClick={() => void runDiagnostic("TLS")}>Inspect TLS</button>
      </div>
      {diagnosticError && <p className="error" role="alert">{diagnosticError}</p>}
      {diagnostic && <div className="diagnostic-result" role="status"><strong>{diagnostic.kind} · {diagnostic.status}</strong><span>{new Date(diagnostic.startedAt).toLocaleString()} · {diagnostic.durationMs ?? "—"} ms</span>{diagnostic.result?.kind === "DNS" && <><span>A: {diagnostic.result.records.A.join(", ") || "No records"} ({diagnostic.result.recordStatus.A.toLowerCase()})</span><span>AAAA: {diagnostic.result.records.AAAA.join(", ") || "No records"} ({diagnostic.result.recordStatus.AAAA.toLowerCase()})</span></>}{diagnostic.result?.kind === "ROUTE" && <span>{diagnostic.result.platform}: {diagnostic.result.hops.length} hops reported</span>}{diagnostic.result?.kind === "HTTP" && <><span>HTTP/{diagnostic.result.httpVersion} {diagnostic.result.statusCode} · {diagnostic.result.redirectCount} redirects</span><span>DNS {diagnostic.result.timings.dnsLookupMs} ms · connect {diagnostic.result.timings.tcpConnectMs} ms · TLS {diagnostic.result.timings.tlsHandshakeMs ?? "—"} ms · first byte {diagnostic.result.timings.timeToFirstByteMs} ms</span><span>{diagnostic.result.finalUrl} · {diagnostic.result.responseBytes} bytes{diagnostic.result.responseTruncated ? " (bounded)" : ""}</span></>}{diagnostic.result?.kind === "TLS" && <><span>{diagnostic.result.protocol ?? "Unknown protocol"} · {diagnostic.result.cipher ?? "Unknown cipher"} · {diagnostic.result.authorized ? "trusted" : `not trusted${diagnostic.result.authorizationError ? ` (${diagnostic.result.authorizationError})` : ""}`}</span><span>{diagnostic.result.hostnameMatched ? "hostname matches" : `hostname mismatch${diagnostic.result.hostnameError ? ` (${diagnostic.result.hostnameError})` : ""}`} · certificate {diagnostic.result.certificate.validityStatus.toLowerCase()}</span><span>{diagnostic.result.certificate.subjectCommonName ?? diagnostic.result.hostname} · expires {new Date(diagnostic.result.certificate.validTo).toLocaleDateString()} ({diagnostic.result.certificate.daysRemaining} days)</span><span>DNS {diagnostic.result.timings.dnsLookupMs} ms · connect {diagnostic.result.timings.tcpConnectMs} ms · handshake {diagnostic.result.timings.tlsHandshakeMs} ms</span></>}{diagnostic.errorMessage && <span className="error">{diagnostic.errorMessage}</span>}</div>}
    </section>
    <section className="panel analysis" aria-labelledby="analysis-heading">
      <div className="section-heading"><div><p className="section-kicker">Evidence review</p><h2 id="analysis-heading">Network analysis</h2></div><span className="panel-note">Deterministic analysis · AI assistance disabled</span></div>
      <div className="analysis-controls">
        <label>Analysis window<select aria-label="Analysis window" value={analysisHours} onChange={(event) => setAnalysisHours(event.target.value)}><option value="24">24 hours</option><option value="168">7 days</option><option value="720">30 days</option></select></label>
        <button type="button" className="secondary" disabled={analysisLoading} onClick={() => void loadAnalysis()}>{analysisLoading ? "Analyzing…" : "Refresh analysis"}</button>
      </div>
      {analysisError && <p className="error" role="alert">{analysisError}</p>}
      {analysis && <>
        <div className="analysis-summary" role="status" aria-live="polite">
          <span className={`pill analysis-${analysis.health.toLowerCase()}`}>{analysis.health.toLowerCase().replaceAll("_", " ")}</span>
          <div><strong>{analysis.summary}</strong><span>{analysis.analyzedMonitorCount} monitor(s) · {new Date(analysis.window.from).toLocaleString()} to {new Date(analysis.window.to).toLocaleString()}</span></div>
        </div>
        <p className="analysis-boundary">{analysis.assistance.message}</p>
        {(analysis.limits.monitorsTruncated || analysis.monitors.some((monitor) => monitor.evidenceWindowTruncated)) && <p className="analysis-limit" role="status">Analysis reached a configured query limit. Findings use the newest bounded evidence and may not represent older records in the selected window.</p>}
        {!analysis.findings.length && <p className="muted">No findings matched the selected evidence window.</p>}
        <div className="finding-list">
          {analysis.findings.map((finding) => {
            const analyzedMonitor = analysis.monitors.find((item) => item.monitorId === finding.monitorId);
            return <article className={`finding finding-${finding.severity.toLowerCase()}`} key={finding.id}>
              <div className="finding-heading"><div><span className="finding-meta">{finding.severity} · {finding.confidence} evidence · {finding.classification.replaceAll("_", " ")}</span><h3>{finding.title}</h3></div><span className="muted">{analyzedMonitor?.monitorName ?? finding.monitorId}</span></div>
              <p><strong>Observation:</strong> {finding.observation}</p>
              {finding.possibleExplanations.length > 0 && <p><strong>Possible explanation:</strong> {finding.possibleExplanations.join(" ")}</p>}
              <p><strong>Recommended next step:</strong> {finding.recommendation}</p>
              {finding.evidence.length > 0 && <details><summary>Supporting evidence ({finding.evidence.length})</summary><ul>{finding.evidence.map((item) => <li key={`${item.kind}-${item.id}`}><code>{item.id}</code> · {new Date(item.occurredAt).toLocaleString()} · {item.summary}</li>)}</ul></details>}
            </article>;
          })}
        </div>
        <div className="analysis-monitors">
          {analysis.monitors.map((monitor) => <article key={monitor.monitorId} className="analysis-monitor"><div><strong>{monitor.monitorName}</strong><span>{monitor.monitorKind} · {monitor.measurementCount} samples · {monitor.sourceCounts.local} local / {monitor.sourceCounts.agent} agent{monitor.evidenceWindowTruncated ? " · evidence limit reached" : ""}</span></div><span>{monitor.baseline ? `${monitor.baseline.recentAverageLatencyMs} ms recent vs ${monitor.baseline.baselineAverageLatencyMs} ms baseline (${monitor.baseline.changePercent}%)` : "Baseline unavailable"}</span></article>)}
        </div>
      </>}
    </section>
    <section className="panel agents" aria-labelledby="agents-heading">
      <div className="section-heading"><div><p className="section-kicker">Remote execution</p><h2 id="agents-heading">Agent management</h2></div><span className="panel-note">Loopback prototype · cross-device disabled</span></div>
      <div className="agent-admin-controls">
        <label>Administrator token<input type="password" autoComplete="off" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} placeholder="NETPULSE_ADMIN_TOKEN" /></label>
        <button type="button" disabled={!adminToken || agentBusy} onClick={() => void loadAgents()}>Load agents</button>
        <button type="button" className="secondary" disabled={!adminToken || agentBusy} onClick={() => void createEnrollment()}>Create enrollment</button>
      </div>
      <p className="muted">The token stays in this browser tab only and is never persisted by the dashboard.</p>
      {agentError && <p className="error" role="alert">{agentError}</p>}
      {enrollmentToken && <div className="enrollment-token" role="status"><strong>One-time enrollment token</strong><code>{enrollmentToken.token}</code><span>Expires {new Date(enrollmentToken.expiresAt).toLocaleString()}. It will not be shown again.</span></div>}
      <div className="agent-grid">
        {agents.map((agent) => <article className="agent-card" key={agent.id}>
          <div className="card-top"><div><h3>{agent.name}</h3><p>{agent.platform} · agent {agent.version}</p></div><span className={`pill ${agent.status.toLowerCase()}`}>{agent.status.toLowerCase()}</span></div>
          <p>{agent.capabilities.join(" · ")} · credential v{agent.credentialVersion}</p>
          <p className="muted">{agent.lastHeartbeatAt ? `Last heartbeat ${new Date(agent.lastHeartbeatAt).toLocaleString()}` : "No heartbeat received"}</p>
          <label>Assign compatible monitor<select aria-label={`Assign monitor to ${agent.name}`} defaultValue="" onChange={(event) => void assignMonitor(agent.id, event.target.value)}><option value="">Choose monitor</option>{monitors.filter((monitor) => agent.capabilities.includes(monitor.kind) && monitor.agentId !== agent.id).map((monitor) => <option key={monitor.id} value={monitor.id}>{monitor.name} ({monitor.kind})</option>)}</select></label>
          <div className="actions">{agent.status === "SUSPENDED" ? <button type="button" className="secondary" disabled={agentBusy} onClick={() => void changeAgent(agent, "activate")}>Activate</button> : <button type="button" className="secondary" disabled={agentBusy || agent.status === "REVOKED"} onClick={() => void changeAgent(agent, "suspend")}>Suspend</button>}<button type="button" className="secondary danger" disabled={agentBusy || agent.status === "REVOKED"} onClick={() => void changeAgent(agent, "revoke")}>Revoke</button></div>
        </article>)}
      </div>
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
          <div className="metric"><strong>{latest?.latencyMs ?? "—"}{latest?.latencyMs ? " ms" : ""}</strong><span>{latest ? `${latest.success ? "latest response" : "latest probe failed"} · ${latest.source === "AGENT" ? "remote agent" : "local coordinator"}` : "awaiting first probe"}</span></div>
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
