// Online play over WebRTC (PeerJS, free public signaling server; no game server needed).
// The HOST's browser is the referee: guests send actions, the host checks them with the game engine,
// applies them and sends the new state to everyone.
const PEER_SRC = "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js";
const PREFIX = "cashflow-ftalla-";

async function loadPeer() {
  if (window.Peer) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = PEER_SRC; s.onload = resolve;
    s.onerror = () => reject(new Error("Couldn't load the networking library. Check your internet connection."));
    document.head.appendChild(s);
  });
}

export function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I confusion
  let c = "";
  const buf = crypto.getRandomValues(new Uint32Array(5));
  for (const n of buf) c += chars[n % chars.length];
  return c;
}

/**
 * Host a room. handlers: onHello(conn, msg) -> playerId|null, onAction(playerId, action), onLeave(playerId), onError(err)
 * Returns { code, send(playerId, msg), broadcast(fn(playerId) -> msg), close() }
 */
export async function hostRoom(handlers, code = makeCode()) {
  await loadPeer();
  const peer = new window.Peer(PREFIX + code);
  const conns = new Map(); // playerId -> conn
  await new Promise((resolve, reject) => {
    peer.on("open", resolve);
    peer.on("error", (e) => (e.type === "unavailable-id" ? reject(new Error("That room code is taken, try again.")) : reject(e)));
  });
  peer.on("error", (e) => handlers.onError && handlers.onError(e));
  peer.on("connection", (conn) => {
    let pid = null;
    conn.on("data", (msg) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.t === "hello") {
        pid = handlers.onHello(conn, msg);
        if (pid) { const old = conns.get(pid); if (old && old !== conn) old.close(); conns.set(pid, conn); }
      } else if (msg.t === "action" && pid) handlers.onAction(pid, msg.action);
    });
    conn.on("close", () => { if (pid && conns.get(pid) === conn) { conns.delete(pid); handlers.onLeave && handlers.onLeave(pid); } });
  });
  return {
    code,
    online: () => new Set(conns.keys()),
    send: (pid, msg) => { const c = conns.get(pid); if (c && c.open) c.send(msg); },
    broadcast: (fn) => { for (const [pid, c] of conns) if (c.open) c.send(fn(pid)); },
    close: () => peer.destroy(),
  };
}

/** Join a room. handlers: onMessage(msg), onClose() */
export async function joinRoom(code, hello, handlers) {
  await loadPeer();
  const peer = new window.Peer();
  await new Promise((resolve, reject) => { peer.on("open", resolve); peer.on("error", reject); });
  const conn = peer.connect(PREFIX + code.toUpperCase(), { reliable: true });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Couldn't reach that room. Check the code, and make sure the host still has the game open.")), 12000);
    conn.on("open", () => { clearTimeout(t); resolve(); });
    peer.on("error", (e) => { clearTimeout(t); reject(e.type === "peer-unavailable" ? new Error("No room with that code. Double-check it with the host.") : e); });
  });
  conn.on("data", (msg) => handlers.onMessage(msg));
  conn.on("close", () => handlers.onClose && handlers.onClose());
  conn.send({ t: "hello", ...hello });
  return { send: (msg) => conn.open && conn.send(msg), close: () => peer.destroy() };
}
