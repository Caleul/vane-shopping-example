import { randomUUID } from "node:crypto";
const base = process.env.API_URL ?? "http://127.0.0.1:3000";
async function request(method, path, body, headers = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(`${response.status}: ${JSON.stringify(result)}`);
  return result;
}
const suffix = randomUUID().slice(0, 8);
const user = await request("POST", "/api/users", { name: "Ana" });
const a = await request("POST", "/api/markets", { name: "Mercado A" });
const b = await request("POST", "/api/markets", { name: "Mercado B" });
const rice = await request("POST", "/api/products", {
  sku: `arroz-1kg-${suffix}`,
  name: "Arroz",
  unit: "pacote 1 kg",
});
const beans = await request("POST", "/api/products", {
  sku: `feijao-1kg-${suffix}`,
  name: "Feijão",
  unit: "pacote 1 kg",
});
for (const [market, product, priceCents] of [
  [a, rice, 500],
  [a, beans, 800],
  [b, rice, 600],
  [b, beans, 300],
]) {
  await request("PUT", `/api/markets/${market.id}/products/${product.id}`, {
    priceCents,
  });
}
const cart = await request("POST", "/api/carts", {
  userId: user.id,
  name: "Compras da semana",
  items: [
    { productId: rice.id, quantity: 2 },
    { productId: beans.id, quantity: 1 },
  ],
});
const quote = await request("GET", `/api/carts/${cart.id}/quote`);
const money = (cents) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100,
  );
console.log(`Carrinho salvo: ${cart.id}`);
for (const market of quote.markets)
  console.log(`${market.marketName}: ${money(market.totalCents)}`);
console.log(`Mais barato: ${quote.cheapest.marketName}`);
const purchase = await request(
  "POST",
  `/api/carts/${cart.id}/purchase`,
  {},
  { "idempotency-key": randomUUID() },
);
console.log(
  `Compra registrada: ${purchase.id} — ${money(purchase.totalCents)}`,
);
console.log(`Consultar: ${base}/api/purchases/${purchase.id}`);
