require("dotenv").config();
const argon2 = require("argon2");
const { z } = require("zod");
const { pool } = require("./db");

async function main() {
  const input = z.object({
    name: z.string().min(2).max(120),
    email: z.string().email().max(254).transform(v => v.toLowerCase()),
    password: z.string().min(14).max(128)
  }).parse({ name: process.argv[2], email: process.argv[3], password: process.argv[4] });
  const hash = await argon2.hash(input.password, { type: argon2.argon2id });
  await pool.query(
    `INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'admin')
     ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name,password_hash=EXCLUDED.password_hash,role='admin'`,
    [input.name, input.email, hash]
  );
  console.log(`Admin account configured for ${input.email}.`);
  await pool.end();
}
main().catch(async e => { console.error(e.message); await pool.end(); process.exit(1); });
