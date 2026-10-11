import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

test(
  "real Vane/PostgreSQL shopping flow, validation, idempotency and restart persistence",
  { timeout: 120000 },
  async (t) => {
    assert.ok(
      process.env.DATABASE_URL,
      "Set DATABASE_URL (see README) to run the integration test.",
    );
    const namespace = `shopping_test_${randomUUID().replaceAll("-", "")}`;
    process.env.VANE_NAMESPACE = namespace;
    const { migrate } = await import("../src/vane.mjs");
    const { startServer } = await import("../src/server.mjs");
    let service;
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    t.after(async () => {
      if (service) await service.close();
      await pool.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
      await pool.end();
    });
    await migrate();
    await migrate(); // Reapplying the unchanged initial schema must be a no-op.
    service = await startServer({ port: 0 });
    const request = async (method, path, body, headers = {}) => {
      const response = await fetch(`${service.url}${path}`, {
        method,
        headers: { "content-type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
      return { status: response.status, data: await response.json() };
    };
    const create = async (resource, body) => {
      const response = await request("POST", `/api/${resource}`, body);
      assert.equal(response.status, 201, JSON.stringify(response));
      return response.data;
    };
    const user = await create("users", { name: "Ana" });
    const a = await create("markets", { name: "Mercado A" });
    const b = await create("markets", { name: "Mercado B" });
    const incomplete = await create("markets", { name: "Incompleto" });
    const rice = await create("products", {
      sku: "rice-1kg",
      name: "Arroz",
      unit: "pacote 1 kg",
    });
    const beans = await create("products", {
      sku: "beans-1kg",
      name: "Feijão",
      unit: "pacote 1 kg",
    });
    for (const [market, product, priceCents] of [
      [a, rice, 500],
      [a, beans, 800],
      [b, rice, 600],
      [b, beans, 300],
      [incomplete, rice, 1],
    ]) {
      assert.equal(
        (
          await request(
            "PUT",
            `/api/markets/${market.id}/products/${product.id}`,
            { priceCents },
          )
        ).status,
        200,
      );
    }
    const cart = await create("carts", {
      userId: user.id,
      name: "Compras da semana",
      items: [
        { productId: rice.id, quantity: 2 },
        { productId: beans.id, quantity: 1 },
      ],
    });
    let comparison = await request("GET", `/api/carts/${cart.id}/quote`);
    assert.equal(comparison.status, 200);
    assert.equal(comparison.data.cheapest.marketId, b.id);
    assert.equal(comparison.data.cheapest.totalCents, 1500);
    assert.equal(comparison.data.unavailableMarkets[0].marketId, incomplete.id);
    assert.equal(
      (await request("GET", `/api/carts?userId=${user.id}`)).data[0].id,
      cart.id,
    );
    assert.equal(
      (await request("GET", `/api/markets/${a.id}/products`)).data.length,
      2,
    );

    await t.test(
      "rejects malformed items, unknown products, price tampering and incomplete purchases",
      async () => {
        for (const items of [
          [{ productId: rice.id, quantity: 0 }],
          [{ productId: rice.id, quantity: 1.5 }],
          [
            { productId: rice.id, quantity: 1 },
            { productId: rice.id, quantity: 2 },
          ],
        ]) {
          assert.equal(
            (await request("PUT", `/api/carts/${cart.id}`, { items })).status,
            400,
          );
        }
        assert.equal(
          (
            await request("PUT", `/api/carts/${cart.id}`, {
              items: [{ productId: randomUUID(), quantity: 1 }],
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await request("PUT", `/api/markets/${a.id}/products/${rice.id}`, {
              priceCents: -1,
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request("POST", `/api/carts/${cart.id}/purchase`, {
              totalCents: 1,
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request("POST", `/api/carts/${cart.id}/purchase`, {
              marketId: incomplete.id,
            })
          ).status,
          409,
        );
        assert.equal(
          (await request("GET", "/api/carts/not-a-uuid")).status,
          400,
        );
        const empty = await create("carts", { userId: user.id, name: "Vazio" });
        assert.equal(
          (await request("GET", `/api/carts/${empty.id}/quote`)).data.code,
          "EMPTY_CART",
        );
      },
    );

    const key = randomUUID();
    const purchased = await request(
      "POST",
      `/api/carts/${cart.id}/purchase`,
      {},
      { "idempotency-key": key },
    );
    assert.equal(purchased.status, 201, JSON.stringify(purchased));
    assert.equal(purchased.data.totalCents, 1500);
    assert.equal(purchased.data.marketId, b.id);
    assert.equal(purchased.data.snapshot.items[0].quantity, 2);
    const repeat = await request(
      "POST",
      `/api/carts/${cart.id}/purchase`,
      {},
      { "idempotency-key": key },
    );
    assert.equal(repeat.status, 200);
    assert.deepEqual(repeat.data, purchased.data);
    assert.equal(
      (
        await request(
          "POST",
          `/api/carts/${cart.id}/purchase`,
          { marketId: a.id },
          { "idempotency-key": key },
        )
      ).status,
      409,
    );
    assert.equal(
      (await request("GET", `/api/purchases?userId=${user.id}`)).data.length,
      1,
    );
    await t.test("concurrent retries create exactly one purchase", async () => {
      const concurrentKey = randomUUID();
      const responses = await Promise.all(
        [1, 2].map(() =>
          request(
            "POST",
            `/api/carts/${cart.id}/purchase`,
            {},
            { "idempotency-key": concurrentKey },
          ),
        ),
      );
      assert.deepEqual(
        responses.map((response) => response.status).sort(),
        [200, 201],
      );
      assert.deepEqual(responses[0].data, responses[1].data);
      assert.equal(
        (await request("GET", `/api/purchases?userId=${user.id}`)).data.length,
        2,
      );
    });

    await t.test(
      "upsert changes one offer, re-ranks cart, and keeps purchase prices frozen",
      async () => {
        assert.equal(
          (
            await request("PUT", `/api/markets/${a.id}/products/${beans.id}`, {
              priceCents: 100,
            })
          ).status,
          200,
        );
        assert.equal(
          (await request("GET", `/api/markets/${a.id}/products`)).data.length,
          2,
        );
        comparison = await request("GET", `/api/carts/${cart.id}/quote`);
        assert.equal(comparison.data.cheapest.marketId, a.id);
        assert.equal(comparison.data.cheapest.totalCents, 1100);
        assert.deepEqual(
          (await request("GET", `/api/purchases/${key}`)).data,
          purchased.data,
        );
        const explicit = await request(
          "POST",
          `/api/carts/${cart.id}/purchase`,
          { marketId: b.id },
        );
        assert.equal(explicit.status, 201);
        assert.equal(explicit.data.marketId, b.id);
      },
    );

    await service.close();
    service = undefined;
    service = await startServer({ port: 0 });
    assert.deepEqual(
      (await request("GET", `/api/carts/${cart.id}`)).data,
      cart,
    );
    assert.deepEqual(
      (await request("GET", `/api/purchases/${key}`)).data,
      purchased.data,
    );
    assert.equal(
      (await request("GET", `/api/carts/${cart.id}/quote`)).data.cheapest
        .totalCents,
      1100,
    );
    const update = await request("PUT", `/api/carts/${cart.id}`, {
      items: [{ productId: rice.id, quantity: 3 }],
    });
    assert.equal(update.status, 200);
    assert.deepEqual(update.data.items, [{ productId: rice.id, quantity: 3 }]);
    assert.equal(update.data.userId, user.id);
    await t.test(
      "rejects totals outside the PostgreSQL integer range before saving",
      async () => {
        for (const market of [a, b, incomplete])
          await request(
            "PUT",
            `/api/markets/${market.id}/products/${rice.id}`,
            { priceCents: 100000000 },
          );
        await request("PUT", `/api/carts/${cart.id}`, {
          items: [{ productId: rice.id, quantity: 1000 }],
        });
        const result = await request(
          "POST",
          `/api/carts/${cart.id}/purchase`,
          {},
        );
        assert.equal(result.status, 409);
        assert.equal(result.data.code, "TOTAL_TOO_LARGE");
      },
    );
  },
);
