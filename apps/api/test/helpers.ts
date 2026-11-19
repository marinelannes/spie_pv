import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Role, SessionResponse } from "@spie/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig, type AppConfig } from "../src/config.js";
import { openDatabase, type Db } from "../src/db/client.js";
import { utilisateurs } from "../src/db/schema.js";
import { REFRESH_COOKIE } from "../src/routes/auth.js";
import { createUser } from "../src/services/users.js";
import { createSharePointClient } from "../src/sharepoint/index.js";

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  config: AppConfig;
  dir: string;
  clock: { now: () => Date; advance: (ms: number) => void };
  close: () => Promise<void>;
}

export async function createTestApp(env: Record<string, string> = {}): Promise<TestApp> {
  const dir = await mkdtemp(join(tmpdir(), "spie-pv-test-"));
  const config = loadConfig({
    NODE_ENV: "test",
    SHAREPOINT_MODE: "fake",
    FAKE_SHAREPOINT_DIR: join(dir, "sharepoint"),
    LOGIN_RATE_LIMIT_PER_MINUTE: "1000",
    ...env,
  });
  const database = await openDatabase("pglite://memory");
  await database.migrate();
  let current = new Date("2026-11-19T13:32:05Z");
  const clock = {
    now: () => current,
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
  };
  const app = await buildApp({
    config,
    db: database.db,
    sharepoint: createSharePointClient(config.sharepoint),
    now: clock.now,
    version: "test",
  });
  return {
    app,
    db: database.db,
    config,
    dir,
    clock,
    close: async () => {
      await app.close();
      await database.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export const PASSWORD = "MotDePasse-Solide-2026";

export async function seedUser(
  db: Db,
  input: { email: string; nom?: string; role: Role; password?: string; mustChangePassword?: boolean },
) {
  const { user } = await createUser(db, {
    email: input.email,
    nom: input.nom ?? input.email.split("@")[0]!,
    role: input.role,
    password: input.password ?? PASSWORD,
  });
  const [updated] = await db
    .update(utilisateurs)
    .set({ mustChangePassword: input.mustChangePassword ?? false })
    .where(eq(utilisateurs.id, user.id))
    .returning();
  return updated!;
}

export function refreshCookieOf(res: LightMyRequestResponse): string | undefined {
  return res.cookies.find((c) => c.name === REFRESH_COOKIE)?.value || undefined;
}

export async function login(app: FastifyInstance, email: string, password = PASSWORD) {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login ${email} : ${res.statusCode} ${res.body}`);
  const body = res.json<SessionResponse>();
  return { accessToken: body.accessToken, refreshToken: refreshCookieOf(res)!, body, res };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
