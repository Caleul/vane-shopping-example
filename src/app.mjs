import { createHash, randomUUID } from "node:crypto";
import { compareCart } from "./pricing.mjs";

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, code, message) => {
  throw new ApiError(status, code, message);
};
export function uuid(value, label = "id") {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    fail(400, "INVALID_INPUT", `${label} must be a UUID.`);
  return value.toLowerCase();
}
function text(value, label, max = 100) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    fail(400, "INVALID_INPUT", `${label} must contain 1–${max} characters.`);
  return value.trim();
}
function integer(value, label, max) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max)
    fail(400, "INVALID_INPUT", `${label} must be an integer from 1 to ${max}.`);
  return value;
}
function offerId(marketId, productId) {
  const bytes = createHash("sha256")
    .update(`shopping-offer:${marketId}:${productId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 0x50;
  bytes[8] = (bytes[8] & 63) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function shoppingApp(vane) {
  // One monolithic example process: serialize requests so quote/checkout observes
  // a coherent catalog relative to writes through this API. No SQL domain writes.
  let tail = Promise.resolve();
  const serialized = (work) => {
    const next = tail.then(work);
    tail = next.catch(() => {});
    return next;
  };
  const details = async (entity, id) => {
    const row = (await vane.view(`${entity}Details`, { id: uuid(id) }))[0];
    if (!row) fail(404, "NOT_FOUND", `${entity} was not found.`);
    return row;
  };
  async function items(value) {
    if (!Array.isArray(value) || value.length > 100)
      fail(
        400,
        "INVALID_INPUT",
        "items must be an array of up to 100 products.",
      );
    const ids = new Set();
    const normalized = value.map((item) => {
      if (!item || typeof item !== "object")
        fail(
          400,
          "INVALID_INPUT",
          "Each item requires productId and quantity.",
        );
      const productId = uuid(item.productId, "productId");
      if (ids.has(productId))
        fail(
          400,
          "INVALID_INPUT",
          "Each product may appear only once in a cart.",
        );
      ids.add(productId);
      return { productId, quantity: integer(item.quantity, "quantity", 1000) };
    });
    for (const item of normalized) await details("Product", item.productId);
    return normalized;
  }
  async function quote(cart) {
    if (!cart.items.length)
      fail(409, "EMPTY_CART", "Add products before comparing or buying.");
    const [products, markets, offers] = await Promise.all([
      vane.view("ProductList"),
      vane.view("MarketList"),
      vane.view("OfferList"),
    ]);
    return compareCart(cart, products, markets, offers);
  }
  return async ({ method, url, body = {}, headers = {} }) =>
    serialized(async () => {
      const path = url.pathname.split("/").filter(Boolean);
      if (path[0] !== "api") fail(404, "NOT_FOUND", "Route was not found.");
      const [, resource, id, action, productId] = path;
      const respond = (data, status = 200) => ({ status, data });
      if (path.length === 2) {
        const simple = {
          users: "User",
          markets: "Market",
          products: "Product",
        }[resource];
        if (simple && method === "GET")
          return respond(await vane.view(`${simple}List`));
        if (simple && method === "POST") {
          const payload = { id: randomUUID(), name: text(body.name, "name") };
          if (simple === "Product")
            Object.assign(payload, {
              sku: text(body.sku, "sku", 80),
              unit: text(body.unit, "unit", 40),
            });
          return respond(await vane.event(`${simple}.Create`, payload), 201);
        }
        if (
          (resource === "carts" || resource === "purchases") &&
          method === "GET"
        ) {
          const userId = uuid(url.searchParams.get("userId"), "userId");
          await details("User", userId);
          return respond(
            await vane.view(
              resource === "carts" ? "CartList" : "PurchaseList",
              { userId },
            ),
          );
        }
        if (resource === "carts" && method === "POST") {
          const userId = uuid(body.userId, "userId");
          await details("User", userId);
          return respond(
            await vane.event("Cart.Create", {
              id: randomUUID(),
              userId,
              name: text(body.name, "name"),
              items: await items(body.items ?? []),
            }),
            201,
          );
        }
      }
      if (
        resource === "markets" &&
        path.length === 4 &&
        action === "products" &&
        method === "GET"
      ) {
        const market = await details("Market", id);
        const [offers, products] = await Promise.all([
          vane.view("OfferList"),
          vane.view("ProductList"),
        ]);
        return respond(
          offers
            .filter((offer) => offer.marketId === market.id)
            .map((offer) => ({
              ...offer,
              product: products.find(
                (product) => product.id === offer.productId,
              ),
            })),
        );
      }
      if (
        resource === "markets" &&
        path.length === 5 &&
        action === "products" &&
        method === "PUT"
      ) {
        const market = await details("Market", id),
          product = await details("Product", productId);
        return respond(
          await vane.event("Offer.Save", {
            id: offerId(market.id, product.id),
            marketId: market.id,
            productId: product.id,
            priceCents: integer(body.priceCents, "priceCents", 100000000),
          }),
        );
      }
      if (resource === "carts" && path.length >= 3 && path.length <= 4) {
        const cart = await details("Cart", id);
        if (path.length === 3 && method === "GET") return respond(cart);
        if (path.length === 3 && method === "PUT")
          return respond(
            await vane.event("Cart.Update", {
              id: cart.id,
              name: text(body.name ?? cart.name, "name"),
              items: await items(body.items),
            }),
          );
        if (action === "quote" && method === "GET")
          return respond(await quote(cart));
        if (action === "purchase" && method === "POST") {
          if (Object.keys(body).some((key) => key !== "marketId"))
            fail(
              400,
              "INVALID_INPUT",
              "Only marketId may be supplied; prices are calculated by the service.",
            );
          const purchaseId =
            headers["idempotency-key"] === undefined
              ? randomUUID()
              : uuid(headers["idempotency-key"], "Idempotency-Key");
          const existing = (
            await vane.view("PurchaseDetails", { id: purchaseId })
          )[0];
          const requestedMarket =
            body.marketId === undefined
              ? undefined
              : uuid(body.marketId, "marketId");
          if (existing) {
            if (
              existing.cartId !== cart.id ||
              (requestedMarket && existing.marketId !== requestedMarket)
            )
              fail(
                409,
                "IDEMPOTENCY_CONFLICT",
                "This key identifies another purchase.",
              );
            return respond(existing);
          }
          const comparison = await quote(cart);
          if (requestedMarket) await details("Market", requestedMarket);
          const selected = requestedMarket
            ? comparison.markets.find(
                (market) => market.marketId === requestedMarket,
              )
            : comparison.cheapest;
          if (!selected)
            fail(
              409,
              "INCOMPLETE_MARKET",
              "No selected market can supply the entire cart.",
            );
          if (selected.totalCents > 2147483647)
            fail(
              409,
              "TOTAL_TOO_LARGE",
              "Purchase total exceeds the supported integer centavos range.",
            );
          return respond(
            await vane.event("Purchase.Create", {
              id: purchaseId,
              userId: cart.userId,
              cartId: cart.id,
              marketId: selected.marketId,
              totalCents: selected.totalCents,
              createdAt: new Date().toISOString(),
              snapshot: {
                currency: "BRL",
                marketName: selected.marketName,
                cartName: cart.name,
                items: selected.items,
              },
            }),
            201,
          );
        }
      }
      if (resource === "purchases" && path.length === 3 && method === "GET")
        return respond(await details("Purchase", id));
      fail(404, "NOT_FOUND", "Route was not found.");
    });
}
