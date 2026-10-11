// Black-box tests: this process imports no application code and has no DB access.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const base = process.env.API_URL;
const phase = process.env.E2E_PHASE;
const evidence = process.env.E2E_EVIDENCE;
assert.ok(base && evidence, "API_URL and E2E_EVIDENCE are required.");
assert.ok(["before", "after-crash", "after-recreate"].includes(phase));
const cases = [],
  requests = [];
let completed = false;
async function request(method, path, body, headers = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  requests.push({ method, path, status: response.status, data });
  return { status: response.status, data };
}
async function create(resource, body) {
  const response = await request("POST", `/api/${resource}`, body);
  assert.equal(response.status, 201, JSON.stringify(response));
  return response.data;
}
async function scenario(t, name, run) {
  await t.test(name, async () => {
    try {
      await run();
      cases.push({ name, status: "PASS" });
    } catch (error) {
      cases.push({ name, status: "FAIL", message: error.message });
      throw error;
    }
  });
}

test(`Docker HTTP E2E: ${phase}`, { timeout: 120000 }, async (t) => {
  await mkdir(evidence, { recursive: true });
  t.after(async () => {
    await writeFile(
      join(evidence, `${phase}.json`),
      JSON.stringify(
        {
          phase,
          status:
            completed &&
            cases.length &&
            cases.every((entry) => entry.status === "PASS")
              ? "PASS"
              : "FAIL",
          generatedAt: new Date().toISOString(),
          cases,
          requests,
        },
        null,
        2,
      ),
    );
  });
  let state;
  if (phase === "before") {
    state = {};
    await scenario(
      t,
      "register users, markets, products and prices through HTTP",
      async () => {
        assert.equal((await request("GET", "/health")).status, 200);
        state.user = await create("users", { name: "Ana" });
        state.a = await create("markets", { name: "Mercado A" });
        state.b = await create("markets", { name: "Mercado B" });
        state.missing = await create("markets", { name: "Mercado incompleto" });
        state.rice = await create("products", {
          sku: "arroz-1kg",
          name: "Arroz",
          unit: "pacote 1 kg",
        });
        state.beans = await create("products", {
          sku: "feijao-1kg",
          name: "Feijão",
          unit: "pacote 1 kg",
        });
        for (const [market, product, priceCents] of [
          [state.a, state.rice, 500],
          [state.a, state.beans, 800],
          [state.b, state.rice, 600],
          [state.b, state.beans, 300],
          [state.missing, state.rice, 1],
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
        state.cart = await create("carts", {
          userId: state.user.id,
          name: "Semana",
          items: [
            { productId: state.rice.id, quantity: 2 },
            { productId: state.beans.id, quantity: 1 },
          ],
        });
      },
    );
    await scenario(
      t,
      "saved cart selects the cheapest complete market using quantities",
      async () => {
        assert.deepEqual(
          (await request("GET", `/api/carts/${state.cart.id}`)).data,
          state.cart,
        );
        const response = await request(
          "GET",
          `/api/carts/${state.cart.id}/quote`,
        );
        assert.equal(response.status, 200);
        assert.equal(response.data.cheapest.marketId, state.b.id);
        assert.deepEqual(
          response.data.markets.map((market) => market.totalCents),
          [1500, 1800],
        );
        assert.deepEqual(
          response.data.unavailableMarkets[0].missingProductIds,
          [state.beans.id],
        );
        assert.equal(
          (await request("GET", `/api/carts?userId=${state.user.id}`)).data[0]
            .id,
          state.cart.id,
        );
      },
    );
    await scenario(
      t,
      "reject invalid input, missing entities and duplicate SKU without altering the cart",
      async () => {
        assert.equal(
          (
            await request("PUT", `/api/carts/${state.cart.id}`, {
              items: [{ productId: state.rice.id, quantity: 0 }],
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request("PUT", `/api/carts/${state.cart.id}`, {
              items: [{ productId: randomUUID(), quantity: 1 }],
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await request(
              "PUT",
              `/api/markets/${state.a.id}/products/${state.rice.id}`,
              { priceCents: 0 },
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request("POST", "/api/products", {
              sku: "arroz-1kg",
              name: "Duplicado",
              unit: "pacote 1 kg",
            })
          ).status,
          409,
        );
        const malformed = await fetch(`${base}/api/users`, {
          method: "POST",
          body: "{",
          headers: { "content-type": "application/json" },
        });
        assert.equal(malformed.status, 400);
        assert.equal((await malformed.json()).code, "INVALID_JSON");
        assert.equal((await request("POST", "/api/users", [])).status, 400);
        assert.deepEqual(
          (await request("GET", `/api/carts/${state.cart.id}`)).data,
          state.cart,
        );
      },
    );
    await scenario(
      t,
      "reject empty carts, missing offers, incomplete markets and client-supplied totals",
      async () => {
        const empty = await create("carts", {
          userId: state.user.id,
          name: "Vazio",
        });
        assert.equal(
          (await request("POST", `/api/carts/${empty.id}/purchase`, {})).data
            .code,
          "EMPTY_CART",
        );
        const unavailable = await create("products", {
          sku: "sem-oferta",
          name: "Sem oferta",
          unit: "unidade",
        });
        const noOffers = await create("carts", {
          userId: state.user.id,
          name: "Sem oferta",
          items: [{ productId: unavailable.id, quantity: 1 }],
        });
        assert.equal(
          (await request("GET", `/api/carts/${noOffers.id}/quote`)).data
            .cheapest,
          null,
        );
        assert.equal(
          (await request("POST", `/api/carts/${noOffers.id}/purchase`, {}))
            .status,
          409,
        );
        assert.equal(
          (
            await request("POST", `/api/carts/${state.cart.id}/purchase`, {
              marketId: state.missing.id,
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await request("POST", `/api/carts/${state.cart.id}/purchase`, {
              totalCents: 1,
            })
          ).status,
          400,
        );
        assert.equal(
          (await request("GET", `/api/purchases?userId=${state.user.id}`)).data
            .length,
          0,
        );
      },
    );
    await scenario(
      t,
      "concurrent checkout retries create a single persisted purchase",
      async () => {
        state.key = randomUUID();
        const replies = await Promise.all(
          [1, 2].map(() =>
            request(
              "POST",
              `/api/carts/${state.cart.id}/purchase`,
              {},
              { "idempotency-key": state.key },
            ),
          ),
        );
        assert.deepEqual(
          replies.map((reply) => reply.status).sort(),
          [200, 201],
        );
        assert.deepEqual(replies[0].data, replies[1].data);
        state.purchase = replies[0].data;
        assert.equal(state.purchase.marketId, state.b.id);
        assert.equal(state.purchase.totalCents, 1500);
        assert.equal(
          (await request("GET", `/api/purchases?userId=${state.user.id}`)).data
            .length,
          1,
        );
        assert.equal(
          (
            await request(
              "POST",
              `/api/carts/${state.cart.id}/purchase`,
              { marketId: state.a.id },
              { "idempotency-key": state.key },
            )
          ).status,
          409,
        );
      },
    );
    await scenario(
      t,
      "price and cart changes update the ranking while the purchase snapshot remains frozen",
      async () => {
        assert.equal(
          (
            await request(
              "PUT",
              `/api/markets/${state.a.id}/products/${state.beans.id}`,
              { priceCents: 100 },
            )
          ).status,
          200,
        );
        assert.equal(
          (await request("GET", `/api/markets/${state.a.id}/products`)).data
            .length,
          2,
        );
        const updated = await request("PUT", `/api/carts/${state.cart.id}`, {
          items: [
            { productId: state.rice.id, quantity: 3 },
            { productId: state.beans.id, quantity: 1 },
          ],
        });
        assert.equal(updated.status, 200);
        state.cart = updated.data;
        const quote = (
          await request("GET", `/api/carts/${state.cart.id}/quote`)
        ).data;
        assert.equal(quote.cheapest.marketId, state.a.id);
        assert.equal(quote.cheapest.totalCents, 1600);
        assert.deepEqual(
          (await request("GET", `/api/purchases/${state.key}`)).data,
          state.purchase,
        );
      },
    );
    await scenario(
      t,
      "allow an explicit complete market and preserve both purchases",
      async () => {
        const response = await request(
          "POST",
          `/api/carts/${state.cart.id}/purchase`,
          { marketId: state.b.id },
        );
        assert.equal(response.status, 201);
        assert.equal(response.data.totalCents, 2100);
        state.explicitPurchase = response.data;
        assert.equal(
          (await request("GET", `/api/purchases?userId=${state.user.id}`)).data
            .length,
          2,
        );
      },
    );
    assert.ok(
      cases.every((entry) => entry.status === "PASS"),
      "Do not save a failed fixture as recovery evidence.",
    );
    await writeFile(
      join(evidence, "state.json"),
      JSON.stringify(state, null, 2),
    );
  } else {
    state = JSON.parse(await readFile(join(evidence, "state.json"), "utf8"));
    await scenario(
      t,
      "recover the saved cart and user after container restart",
      async () => {
        assert.equal((await request("GET", "/health")).status, 200);
        assert.deepEqual(
          (await request("GET", `/api/carts/${state.cart.id}`)).data,
          state.cart,
        );
        assert.equal(
          (await request("GET", "/api/users")).data[0].id,
          state.user.id,
        );
      },
    );
    await scenario(
      t,
      "recover the current catalog and cheapest-market calculation",
      async () => {
        const response = await request(
          "GET",
          `/api/carts/${state.cart.id}/quote`,
        );
        assert.equal(response.status, 200);
        assert.equal(response.data.cheapest.marketId, state.a.id);
        assert.equal(response.data.cheapest.totalCents, 1600);
      },
    );
    await scenario(
      t,
      "recover immutable purchase receipts exactly",
      async () => {
        assert.deepEqual(
          (await request("GET", `/api/purchases/${state.key}`)).data,
          state.purchase,
        );
        assert.deepEqual(
          (await request("GET", `/api/purchases/${state.explicitPurchase.id}`))
            .data,
          state.explicitPurchase,
        );
      },
    );
    await scenario(
      t,
      "retain checkout idempotency across a crash and full container recreation",
      async () => {
        const response = await request(
          "POST",
          `/api/carts/${state.cart.id}/purchase`,
          {},
          { "idempotency-key": state.key },
        );
        assert.equal(response.status, 200);
        assert.deepEqual(response.data, state.purchase);
        assert.equal(
          (await request("GET", `/api/purchases?userId=${state.user.id}`)).data
            .length,
          2,
        );
      },
    );
    await scenario(t, "execute new Vane events after recovery", async () => {
      const response = await request("PUT", `/api/carts/${state.cart.id}`, {
        name: state.cart.name,
        items: state.cart.items,
      });
      assert.equal(response.status, 200);
      assert.deepEqual(response.data, state.cart);
    });
  }
  completed = true;
});
