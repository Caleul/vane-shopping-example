import pg from "pg";
import {
  createServiceRuntime,
  createPostgreSqlMigrationPlan,
  applyPostgreSqlMigrationPlan,
} from "@lilka/vane";
import { configuration, result } from "./configuration.mjs";

export async function migrate(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) throw new Error("Set DATABASE_URL before migrating.");
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    // This example has a fixed initial model. Schema evolution needs an explicit previous IR.
    await applyPostgreSqlMigrationPlan(
      pool,
      createPostgreSqlMigrationPlan({
        previous: null,
        next: result.plan.storage,
      }),
    );
  } finally {
    await pool.end();
  }
}

export async function startVane(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) throw new Error("Set DATABASE_URL before starting.");
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  let runtime;
  try {
    runtime = await createServiceRuntime(configuration, "development", {
      pool,
    });
    await runtime.start();
  } catch (error) {
    await pool.end();
    throw error;
  }
  const worker = runtime.runWorkers();
  // Invoke the configured contract in-process, preserving admission and input validation.
  // The REST facade does not expose raw generated Events or accept purchase totals from clients.
  const contract = runtime.modules[0].http;
  // node-postgres treats a bare JS array as a PostgreSQL array parameter.
  // Keep cart items in a JSON object at the storage boundary; the API uses an array.
  const publicRow = (name, row) =>
    name.startsWith("Cart") && row ? { ...row, items: row.items.lines } : row;
  let workerError;
  worker.catch((error) => {
    workerError = error;
  });
  const ensureWorkers = () => {
    if (workerError) throw new Error("Vane workers unavailable");
  };
  return {
    async view(name, input = {}) {
      ensureWorkers();
      const reply = await contract.handle({
        method: "POST",
        path: `/shopping/views/${name}`,
        body: input,
      });
      if (reply.status !== 200) throw new Error("Vane View failed");
      return JSON.parse(reply.body).map((row) => publicRow(name, row));
    },
    async event(name, input) {
      ensureWorkers();
      const payload = name.startsWith("Cart.")
        ? { ...input, items: { lines: input.items } }
        : input;
      const admitted = await contract.handle({
        method: "POST",
        path: `/shopping/events/${name}`,
        body: payload,
      });
      if (admitted.status !== 202)
        throw new Error("Vane Event admission failed");
      const { sagaId } = JSON.parse(admitted.body);
      const terminal = await contract.handle({
        method: "GET",
        path: `/shopping/sagas/${sagaId}`,
        signal: AbortSignal.timeout(15000),
      });
      if (terminal.status !== 200) throw new Error("Vane terminal unavailable");
      const data = JSON.parse(terminal.body.split("\ndata: ")[1].trim());
      if (!terminal.body.startsWith("event: view\n")) {
        const error = new Error("The change could not be saved.");
        error.status = 409;
        error.code = "WRITE_CONFLICT";
        throw error;
      }
      return publicRow(name, data.data[0]);
    },
    async close() {
      await runtime.stop();
      await worker.catch(() => {});
      await pool.end();
    },
  };
}
