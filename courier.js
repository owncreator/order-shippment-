const { pool } = require("./db");

// Optional AfterShip v4 adapter. Keep API keys server-side only.
// Docs: https://www.aftership.com/docs/tracking/2025-07
async function syncAfterShip(order) {
  const key = process.env.AFTERSHIP_API_KEY;
  if (!key) throw new Error("AfterShip is not configured. Set AFTERSHIP_API_KEY.");
  if (!order.carrier_tracking_id || !order.carrier) throw new Error("Order needs a carrier slug and carrier tracking ID.");
  const base = "https://api.aftership.com/tracking/2025-07";
  const headers = { "as-api-key": key, "Content-Type": "application/json" };
  let res = await fetch(`${base}/trackings/${encodeURIComponent(order.carrier)}/${encodeURIComponent(order.carrier_tracking_id)}`, { headers });
  if (res.status === 404) {
    res = await fetch(`${base}/trackings`, {
      method: "POST", headers,
      body: JSON.stringify({ tracking: { slug: order.carrier, tracking_number: order.carrier_tracking_id } })
    });
  }
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.meta?.message || `Courier provider returned ${res.status}`);
  const tracking = payload?.data?.tracking || payload?.data;
  const checkpoint = tracking?.checkpoints?.[tracking.checkpoints.length - 1];
  const map = {
    Pending: "confirmed", InfoReceived: "confirmed", InTransit: "in_transit",
    OutForDelivery: "out_for_delivery", Delivered: "delivered",
    Exception: "exception", Expired: "exception", AvailableForPickup: "out_for_delivery",
    FailedAttempt: "exception", ReturnedToSender: "returned"
  };
  const normalized = map[tracking?.tag] || null;
  if (normalized) {
    const title = checkpoint?.message || `Courier update: ${tracking?.tag || normalized}`;
    await pool.query(
      `INSERT INTO tracking_events(order_id,status,title,description,location,source,event_time)
       VALUES($1,$2,$3,$4,$5,'courier',COALESCE($6::timestamptz,NOW()))`,
      [order.id, normalized, String(title).slice(0,120), String(checkpoint?.message || "").slice(0,500),
       checkpoint?.location || null, checkpoint?.checkpoint_time || null]
    );
    await pool.query("UPDATE orders SET status=$1, updated_at=NOW() WHERE id=$2", [normalized, order.id]);
  }
  return { status: normalized || order.status, providerStatus: tracking?.tag || "unknown" };
}

module.exports = { syncAfterShip };
