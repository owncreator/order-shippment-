require("dotenv").config();
const express = require("express");
const session = require("express-session");
const connectPgSimple = require("connect-pg-simple");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const argon2 = require("argon2");
const crypto = require("node:crypto");
const { z } = require("zod");
const { pool } = require("./db");
const { encrypt, decrypt } = require("./crypto");
const { syncAfterShip } = require("./courier");

const app = express();
const isProd = process.env.NODE_ENV === "production";
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET must be set to a random secret of at least 32 characters.");
}
if (isProd && process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"], connectSrc: ["'self'"], objectSrc: ["'none'"],
      baseUri: ["'self'"], frameAncestors: ["'none'"], formAction: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: false, limit: "8kb" }));
const PgSession = connectPgSimple(session);
app.use(session({
  store: new PgSession({ pool, tableName: "user_sessions", createTableIfMissing: true, pruneSessionInterval: 15 * 60 }),
  name: "parcelguard.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, secure: isProd, sameSite: "lax", maxAge: 1000 * 60 * 60 * 8, path: "/" }
}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false });
app.use("/api", apiLimiter);
const statuses = ["order_placed","confirmed","packed","shipped","in_transit","out_for_delivery","delivered","exception","cancelled","returned"];
const statusInfo = {
  order_placed: ["Order placed","We received your order."], confirmed: ["Order confirmed","Your order has been confirmed."],
  packed: ["Packed","Your parcel has been packed."], shipped: ["Shipped","Your parcel has left the warehouse."],
  in_transit: ["In transit","Your parcel is moving through the delivery network."],
  out_for_delivery: ["Out for delivery","The courier is delivering your parcel today."],
  delivered: ["Delivered","Your parcel has been delivered."], exception: ["Delivery exception","The courier reported an issue."],
  cancelled: ["Cancelled","This order has been cancelled."], returned: ["Returned","This parcel is being returned."]
};
const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
function requireAuth(req,res,next) {
  if (!req.session.user) return res.status(401).json({ error: "Please sign in." });
  next();
}
function requireStaff(req,res,next) {
  if (!req.session.user || !["admin","staff"].includes(req.session.user.role)) return res.status(403).json({ error: "Owner or staff access required." });
  next();
}
function csrf(req,res,next) {
  if (["GET","HEAD","OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  if (origin && origin !== `${req.protocol}://${req.get("host")}`) return res.status(403).json({error:"Origin check failed."});
  const token = req.get("x-csrf-token");
  if (!req.session.csrfToken || !token || !crypto.timingSafeEqual(Buffer.from(String(token)), Buffer.from(String(req.session.csrfToken)))) {
    return res.status(403).json({error:"Security token expired. Refresh and try again."});
  }
  next();
}
app.use("/api", csrf);

app.get("/api/csrf", (req,res) => {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  res.json({ token: req.session.csrfToken });
});
app.post("/api/auth/register", authLimiter, wrap(async (req,res) => {
  const body = z.object({name:z.string().trim().min(2).max(120),email:z.string().trim().email().max(254),password:z.string().min(12).max(128)}).parse(req.body);
  const email = body.email.toLowerCase();
  const hash = await argon2.hash(body.password, {type:argon2.argon2id});
  try {
    const result = await pool.query("INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email,role", [body.name,email,hash]);
    req.session.regenerate(err => {
      if (err) return res.status(500).json({error:"Could not start session."});
      req.session.user = result.rows[0];
      req.session.csrfToken = crypto.randomBytes(32).toString("hex");
      req.session.save(e => e ? res.status(500).json({error:"Could not save session."}) : res.status(201).json({user:req.session.user,csrfToken:req.session.csrfToken}));
    });
  } catch(e) { if (e.code === "23505") return res.status(409).json({error:"An account with this email already exists."}); throw e; }
}));
app.post("/api/auth/login", authLimiter, wrap(async (req,res) => {
  const body = z.object({email:z.string().trim().email().max(254),password:z.string().min(1).max(128)}).parse(req.body);
  const result = await pool.query("SELECT id,name,email,password_hash,role FROM users WHERE email=$1", [body.email.toLowerCase()]);
  const user = result.rows[0];
  if (!user || !(await argon2.verify(user.password_hash, body.password))) return res.status(401).json({error:"Email or password is incorrect."});
  const safe = {id:user.id,name:user.name,email:user.email,role:user.role};
  req.session.regenerate(err => {
    if (err) return res.status(500).json({error:"Could not start session."});
    req.session.user = safe;
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
    req.session.save(e => e ? res.status(500).json({error:"Could not save session."}) : res.json({user:safe,csrfToken:req.session.csrfToken}));
  });
}));
app.post("/api/auth/logout", requireAuth, wrap(async(req,res) => {
  req.session.destroy(err => {
    res.clearCookie("parcelguard.sid", {httpOnly:true,secure:isProd,sameSite:"lax",path:"/"});
    if (err) return res.status(500).json({error:"Could not sign out."});
    res.json({ok:true});
  });
}));
app.get("/api/auth/me", (req,res) => res.json({user:req.session.user || null,csrfToken:req.session.csrfToken || null}));

function publicOrder(row, events) {
  return {
    orderNumber:row.order_number, trackingNumber:row.tracking_number, itemSummary:row.item_summary,
    status:row.status, carrier:row.carrier, estimatedDelivery:row.estimated_delivery,
    createdAt:row.created_at, updatedAt:row.updated_at,
    events:events.map(e=>({status:e.status,title:e.title,description:e.description,location:e.location,eventTime:e.event_time,source:e.source}))
  };
}
async function eventsFor(id) {
  return (await pool.query("SELECT status,title,description,location,source,event_time FROM tracking_events WHERE order_id=$1 ORDER BY event_time ASC,id ASC", [id])).rows;
}
app.get("/api/track/:trackingNumber", wrap(async(req,res) => {
  const number = String(req.params.trackingNumber).trim().toUpperCase();
  if (!/^[A-Z0-9-]{8,64}$/.test(number)) return res.status(400).json({error:"Enter a valid tracking number."});
  const result = await pool.query("SELECT * FROM orders WHERE tracking_number=$1", [number]);
  if (!result.rows[0]) return res.status(404).json({error:"No order found for that tracking number."});
  const row = result.rows[0];
  res.json({order:publicOrder(row, await eventsFor(row.id))});
}));
app.get("/api/customer/orders", requireAuth, wrap(async(req,res) => {
  const result = await pool.query("SELECT * FROM orders WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 100", [req.session.user.id]);
  const orders = await Promise.all(result.rows.map(async row=>publicOrder(row,await eventsFor(row.id))));
  res.json({orders});
}));
app.get("/api/admin/summary", requireStaff, wrap(async(req,res) => {
  const result = await pool.query(`SELECT COUNT(*)::int total,
    COUNT(*) FILTER (WHERE status NOT IN ('delivered','cancelled','returned'))::int active,
    COUNT(*) FILTER (WHERE status='delivered')::int delivered,
    COUNT(*) FILTER (WHERE status='exception')::int exceptions,
    COALESCE(SUM(amount_cents) FILTER (WHERE status='delivered'),0)::bigint delivered_revenue
    FROM orders`);
  res.json({summary:result.rows[0]});
}));
app.get("/api/admin/orders", requireStaff, wrap(async(req,res) => {
  const q = String(req.query.q || "").trim().slice(0,100);
  const result = await pool.query(
    `SELECT o.*,u.name AS account_name FROM orders o JOIN users u ON u.id=o.customer_id
     WHERE ($1='' OR o.order_number ILIKE $2 OR o.tracking_number ILIKE $2 OR o.customer_email ILIKE $2 OR o.customer_name ILIKE $2)
     ORDER BY o.created_at DESC LIMIT 200`, [q,`%${q}%`]);
  res.json({orders:result.rows.map(r=>({
    id:r.id,orderNumber:r.order_number,trackingNumber:r.tracking_number,customerName:r.customer_name,
    customerEmail:r.customer_email,itemSummary:r.item_summary,amountCents:r.amount_cents,currency:r.currency,
    status:r.status,carrier:r.carrier,carrierTrackingId:r.carrier_tracking_id,
    estimatedDelivery:r.estimated_delivery,createdAt:r.created_at,
    destination: r.destination_encrypted ? decrypt(r.destination_encrypted) : null,
    notes: r.notes_encrypted ? decrypt(r.notes_encrypted) : null
  }))});
}));
app.post("/api/admin/orders", requireStaff, wrap(async(req,res) => {
  const b = z.object({
    customerEmail:z.string().trim().email().max(254),customerName:z.string().trim().min(2).max(120),
    itemSummary:z.string().trim().min(2).max(240),amountCents:z.number().int().min(0).max(100000000),
    carrier:z.string().trim().max(80).optional().default(""),carrierTrackingId:z.string().trim().max(120).optional().default(""),
    estimatedDelivery:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
    destination:z.string().max(1000).optional().default(""),notes:z.string().max(2000).optional().default("")
  }).parse(req.body);
  const customer = await pool.query("SELECT id,name,email FROM users WHERE email=$1",[b.customerEmail.toLowerCase()]);
  if (!customer.rows[0]) return res.status(400).json({error:"Customer must create an account before an order can be assigned."});
  const orderNumber = "PG-" + crypto.randomBytes(5).toString("hex").toUpperCase();
  const trackingNumber = "TRK" + crypto.randomBytes(8).toString("hex").toUpperCase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `INSERT INTO orders(order_number,tracking_number,customer_id,customer_name,customer_email,item_summary,amount_cents,carrier,carrier_tracking_id,estimated_delivery,destination_encrypted,notes_encrypted)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [orderNumber,trackingNumber,customer.rows[0].id,b.customerName,b.customerEmail.toLowerCase(),b.itemSummary,b.amountCents,b.carrier||null,b.carrierTrackingId||null,b.estimatedDelivery||null,encrypt(b.destination),encrypt(b.notes)]);
    await client.query("INSERT INTO tracking_events(order_id,status,title,description,source,created_by) VALUES($1,'order_placed','Order placed','Order has been registered.','system',$2)",[r.rows[0].id,req.session.user.id]);
    await client.query("COMMIT");
    res.status(201).json({order:{orderNumber,trackingNumber}});
  } catch(e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}));
app.patch("/api/admin/orders/:id/status", requireStaff, wrap(async(req,res) => {
  const b = z.object({status:z.enum(statuses),description:z.string().max(500).optional().default(""),location:z.string().max(160).optional().default("")}).parse(req.body);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query("UPDATE orders SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING id",[b.status,req.params.id]);
    if (!r.rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({error:"Order not found."}); }
    const [title,defaultDescription] = statusInfo[b.status];
    await client.query("INSERT INTO tracking_events(order_id,status,title,description,location,source,created_by) VALUES($1,$2,$3,$4,$5,'manual',$6)",
      [r.rows[0].id,b.status,title,b.description||defaultDescription,b.location||null,req.session.user.id]);
    await client.query("COMMIT");
    res.json({ok:true});
  } catch(e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}));
app.post("/api/admin/orders/:id/sync", requireStaff, wrap(async(req,res) => {
  const r = await pool.query("SELECT * FROM orders WHERE id=$1",[req.params.id]);
  if (!r.rows[0]) return res.status(404).json({error:"Order not found."});
  const result = await syncAfterShip(r.rows[0]);
  res.json({ok:true,...result});
}));
app.get("/api/admin/customers", requireStaff, wrap(async(req,res) => {
  const r = await pool.query(`SELECT u.id,u.name,u.email,u.role,u.created_at,COUNT(o.id)::int orders_count
    FROM users u LEFT JOIN orders o ON o.customer_id=u.id GROUP BY u.id ORDER BY u.created_at DESC LIMIT 300`);
  res.json({customers:r.rows});
}));
app.use(express.static("public", {extensions:["html"], maxAge:isProd ? "1h" : 0}));
app.get("*", (req,res) => res.sendFile(require("node:path").join(process.cwd(),"public","index.html")));
app.use((err,req,res,next) => {
  if (err instanceof z.ZodError) return res.status(400).json({error:"Please check the submitted fields.",details:err.issues.map(i=>({field:i.path.join("."),message:i.message}))});
  if (err.code === "23505") return res.status(409).json({error:"That value is already in use."});
  console.error(err.stack || err);
  res.status(500).json({error:"Something went wrong. Please try again."});
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`ParcelGuard running on port ${port}`));
