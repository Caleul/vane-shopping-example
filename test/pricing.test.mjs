import test from "node:test";
import assert from "node:assert/strict";
import { compareCart } from "../src/pricing.mjs";

const products = [
  { id: "rice", sku: "rice-1kg", name: "Arroz", unit: "pacote 1 kg" },
  { id: "beans", sku: "beans-1kg", name: "Feijão", unit: "pacote 1 kg" },
];
const markets = [
  { id: "a", name: "Mercado A" },
  { id: "b", name: "Mercado B" },
  { id: "c", name: "Incompleto" },
];
const cart = {
  id: "cart",
  items: [
    { productId: "rice", quantity: 2 },
    { productId: "beans", quantity: 1 },
  ],
};
const offers = [
  { marketId: "a", productId: "rice", priceCents: 500 },
  { marketId: "a", productId: "beans", priceCents: 800 },
  { marketId: "b", productId: "rice", priceCents: 600 },
  { marketId: "b", productId: "beans", priceCents: 300 },
  { marketId: "c", productId: "rice", priceCents: 1 },
];

test("chooses the cheapest complete basket, accounting for quantities", () => {
  const result = compareCart(cart, products, markets, offers);
  assert.equal(result.cheapest.marketId, "b");
  assert.equal(result.cheapest.totalCents, 1500);
  assert.deepEqual(
    result.markets.map((market) => market.totalCents),
    [1500, 1800],
  );
  assert.equal(result.cheapest.items[0].totalCents, 1200);
});
test("excludes a cheaper but incomplete market and identifies missing products", () => {
  const result = compareCart(cart, products, markets, offers);
  assert.deepEqual(result.unavailableMarkets, [
    { marketId: "c", marketName: "Incompleto", missingProductIds: ["beans"] },
  ]);
  assert.equal(
    result.markets.some((market) => market.marketId === "c"),
    false,
  );
});
test("uses a deterministic market ID tie-break, independent of input order", () => {
  const tied = offers.map((offer) =>
    offer.marketId === "a" && offer.productId === "beans"
      ? { ...offer, priceCents: 500 }
      : offer,
  );
  assert.equal(
    compareCart(cart, products, [...markets].reverse(), tied).cheapest.marketId,
    "a",
  );
});
test("returns no winner when no market offers all products", () => {
  const result = compareCart(
    cart,
    products,
    markets,
    offers.filter((offer) => offer.productId === "rice"),
  );
  assert.equal(result.cheapest, null);
  assert.equal(result.markets.length, 0);
  assert.equal(result.unavailableMarkets.length, 3);
});
test("keeps centavos exact, including small unit prices", () => {
  const result = compareCart(
    { ...cart, items: [{ productId: "rice", quantity: 3 }] },
    products,
    markets,
    [{ marketId: "a", productId: "rice", priceCents: 101 }],
  );
  assert.equal(result.cheapest.totalCents, 303);
});
