// Money is always integer centavos. A product denotes the same SKU/package in all markets.
export function compareCart(cart, products, markets, offers) {
  const productById = new Map(products.map((product) => [product.id, product]));
  const offerByPair = new Map(
    offers.map((offer) => [`${offer.marketId}:${offer.productId}`, offer]),
  );
  const available = [],
    unavailable = [];
  for (const market of markets) {
    const missingProductIds = cart.items
      .filter((item) => !offerByPair.has(`${market.id}:${item.productId}`))
      .map((item) => item.productId);
    if (missingProductIds.length) {
      unavailable.push({
        marketId: market.id,
        marketName: market.name,
        missingProductIds,
      });
      continue;
    }
    const items = cart.items.map((item) => {
      const product = productById.get(item.productId);
      const offer = offerByPair.get(`${market.id}:${item.productId}`);
      return {
        productId: item.productId,
        sku: product.sku,
        name: product.name,
        unit: product.unit,
        quantity: item.quantity,
        unitPriceCents: offer.priceCents,
        totalCents: item.quantity * offer.priceCents,
      };
    });
    available.push({
      marketId: market.id,
      marketName: market.name,
      totalCents: items.reduce((sum, item) => sum + item.totalCents, 0),
      items,
    });
  }
  available.sort(
    (a, b) =>
      a.totalCents - b.totalCents || a.marketId.localeCompare(b.marketId),
  );
  unavailable.sort((a, b) => a.marketId.localeCompare(b.marketId));
  return {
    cartId: cart.id,
    currency: "BRL",
    cheapest: available[0] ?? null,
    markets: available,
    unavailableMarkets: unavailable,
  };
}
