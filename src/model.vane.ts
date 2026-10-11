// Vane owns schema, constraints, Events, Views and durable Saga execution.
// Cart items use { lines: [...] } and purchase snapshots use a JSON object.
// The REST facade presents cart items as an array. No application SQL domain writes.
import {
  Column,
  Entity,
  Event,
  Module,
  View,
  Saga,
  create,
  update,
  upsert,
  field,
  input,
  eq,
  asc,
  reference,
  event,
} from "@lilka/vane";

@Entity()
export class User {
  id = Column({ type: "uuid", identity: true });
  name = Column({ type: "string", minLength: 1, maxLength: 100 });
  Create = Event({
    input: { id: "uuid", name: "string" },
    operation: create({ id: input("id"), name: input("name") }),
  });
}

@View({
  input: { id: "uuid" },
  output: { id: field(User, "id"), name: field(User, "name") },
  query: {
    root: User,
    where: eq(field(User, "id"), input("id")),
    orderBy: [asc(field(User, "id"))],
  },
})
export class UserDetails {}

@View({
  input: {},
  output: { id: field(User, "id"), name: field(User, "name") },
  query: { root: User, orderBy: [asc(field(User, "id"))] },
})
export class UserList {}

@Saga({
  input: { id: "uuid", name: "string" },
  steps: { apply: event(User, "Create") },
  terminal: { step: "apply", view: UserDetails },
})
class UserCreate {}

@Entity()
export class Market {
  id = Column({ type: "uuid", identity: true });
  name = Column({ type: "string", minLength: 1, maxLength: 100 });
  Create = Event({
    input: { id: "uuid", name: "string" },
    operation: create({ id: input("id"), name: input("name") }),
  });
}

@View({
  input: { id: "uuid" },
  output: { id: field(Market, "id"), name: field(Market, "name") },
  query: {
    root: Market,
    where: eq(field(Market, "id"), input("id")),
    orderBy: [asc(field(Market, "id"))],
  },
})
export class MarketDetails {}

@View({
  input: {},
  output: { id: field(Market, "id"), name: field(Market, "name") },
  query: { root: Market, orderBy: [asc(field(Market, "id"))] },
})
export class MarketList {}

@Saga({
  input: { id: "uuid", name: "string" },
  steps: { apply: event(Market, "Create") },
  terminal: { step: "apply", view: MarketDetails },
})
class MarketCreate {}

@Entity()
export class Product {
  id = Column({ type: "uuid", identity: true });
  sku = Column({ type: "string", unique: true, minLength: 1, maxLength: 80 });
  name = Column({ type: "string", minLength: 1, maxLength: 100 });
  unit = Column({ type: "string", minLength: 1, maxLength: 40 });
  Create = Event({
    input: { id: "uuid", sku: "string", name: "string", unit: "string" },
    operation: create({
      id: input("id"),
      sku: input("sku"),
      name: input("name"),
      unit: input("unit"),
    }),
  });
}

@View({
  input: { id: "uuid" },
  output: {
    id: field(Product, "id"),
    sku: field(Product, "sku"),
    name: field(Product, "name"),
    unit: field(Product, "unit"),
  },
  query: {
    root: Product,
    where: eq(field(Product, "id"), input("id")),
    orderBy: [asc(field(Product, "id"))],
  },
})
export class ProductDetails {}

@View({
  input: {},
  output: {
    id: field(Product, "id"),
    sku: field(Product, "sku"),
    name: field(Product, "name"),
    unit: field(Product, "unit"),
  },
  query: { root: Product, orderBy: [asc(field(Product, "id"))] },
})
export class ProductList {}

@Saga({
  input: { id: "uuid", sku: "string", name: "string", unit: "string" },
  steps: { apply: event(Product, "Create") },
  terminal: { step: "apply", view: ProductDetails },
})
class ProductCreate {}

@Entity()
export class Offer {
  id = Column({ type: "uuid", identity: true });
  marketId = Column({ type: "uuid", references: reference(Market, "id") });
  productId = Column({ type: "uuid", references: reference(Product, "id") });
  priceCents = Column({ type: "integer", minimum: 1, maximum: 100000000 });
  Save = Event({
    input: {
      id: "uuid",
      marketId: "uuid",
      productId: "uuid",
      priceCents: "integer",
    },
    operation: upsert(input("id"), {
      marketId: input("marketId"),
      productId: input("productId"),
      priceCents: input("priceCents"),
    }),
  });
}

@View({
  input: { id: "uuid" },
  output: {
    id: field(Offer, "id"),
    marketId: field(Offer, "marketId"),
    productId: field(Offer, "productId"),
    priceCents: field(Offer, "priceCents"),
  },
  query: {
    root: Offer,
    where: eq(field(Offer, "id"), input("id")),
    orderBy: [asc(field(Offer, "id"))],
  },
})
export class OfferDetails {}

@View({
  input: {},
  output: {
    id: field(Offer, "id"),
    marketId: field(Offer, "marketId"),
    productId: field(Offer, "productId"),
    priceCents: field(Offer, "priceCents"),
  },
  query: { root: Offer, orderBy: [asc(field(Offer, "id"))] },
})
export class OfferList {}

@Saga({
  input: {
    id: "uuid",
    marketId: "uuid",
    productId: "uuid",
    priceCents: "integer",
  },
  steps: { apply: event(Offer, "Save") },
  terminal: { step: "apply", view: OfferDetails },
})
class OfferSave {}

@Entity()
export class Cart {
  id = Column({ type: "uuid", identity: true });
  userId = Column({ type: "uuid", references: reference(User, "id") });
  name = Column({ type: "string", minLength: 1, maxLength: 100 });
  items = Column({ type: "json" });
  Create = Event({
    input: { id: "uuid", userId: "uuid", name: "string", items: "json" },
    operation: create({
      id: input("id"),
      userId: input("userId"),
      name: input("name"),
      items: input("items"),
    }),
  });
  Update = Event({
    input: { id: "uuid", name: "string", items: "json" },
    operation: update(input("id"), {
      name: input("name"),
      items: input("items"),
    }),
  });
}

@View({
  input: { id: "uuid" },
  output: {
    id: field(Cart, "id"),
    userId: field(Cart, "userId"),
    name: field(Cart, "name"),
    items: field(Cart, "items"),
  },
  query: {
    root: Cart,
    where: eq(field(Cart, "id"), input("id")),
    orderBy: [asc(field(Cart, "id"))],
  },
})
export class CartDetails {}

@View({
  input: { userId: "uuid" },
  output: {
    id: field(Cart, "id"),
    userId: field(Cart, "userId"),
    name: field(Cart, "name"),
    items: field(Cart, "items"),
  },
  query: {
    root: Cart,
    where: eq(field(Cart, "userId"), input("userId")),
    orderBy: [asc(field(Cart, "id"))],
  },
})
export class CartList {}

@Saga({
  input: { id: "uuid", userId: "uuid", name: "string", items: "json" },
  steps: { apply: event(Cart, "Create") },
  terminal: { step: "apply", view: CartDetails },
})
class CartCreate {}

@Saga({
  input: { id: "uuid", name: "string", items: "json" },
  steps: { apply: event(Cart, "Update") },
  terminal: { step: "apply", view: CartDetails },
})
class CartUpdate {}

@Entity()
export class Purchase {
  id = Column({ type: "uuid", identity: true });
  userId = Column({ type: "uuid", references: reference(User, "id") });
  cartId = Column({ type: "uuid", references: reference(Cart, "id") });
  marketId = Column({ type: "uuid", references: reference(Market, "id") });
  totalCents = Column({ type: "integer", minimum: 1, maximum: 2147483647 });
  snapshot = Column({ type: "json" });
  createdAt = Column({ type: "string" });
  Create = Event({
    input: {
      id: "uuid",
      userId: "uuid",
      cartId: "uuid",
      marketId: "uuid",
      totalCents: "integer",
      snapshot: "json",
      createdAt: "string",
    },
    operation: create({
      id: input("id"),
      userId: input("userId"),
      cartId: input("cartId"),
      marketId: input("marketId"),
      totalCents: input("totalCents"),
      snapshot: input("snapshot"),
      createdAt: input("createdAt"),
    }),
  });
}

@View({
  input: { id: "uuid" },
  output: {
    id: field(Purchase, "id"),
    userId: field(Purchase, "userId"),
    cartId: field(Purchase, "cartId"),
    marketId: field(Purchase, "marketId"),
    totalCents: field(Purchase, "totalCents"),
    snapshot: field(Purchase, "snapshot"),
    createdAt: field(Purchase, "createdAt"),
  },
  query: {
    root: Purchase,
    where: eq(field(Purchase, "id"), input("id")),
    orderBy: [asc(field(Purchase, "id"))],
  },
})
export class PurchaseDetails {}

@View({
  input: { userId: "uuid" },
  output: {
    id: field(Purchase, "id"),
    userId: field(Purchase, "userId"),
    cartId: field(Purchase, "cartId"),
    marketId: field(Purchase, "marketId"),
    totalCents: field(Purchase, "totalCents"),
    snapshot: field(Purchase, "snapshot"),
    createdAt: field(Purchase, "createdAt"),
  },
  query: {
    root: Purchase,
    where: eq(field(Purchase, "userId"), input("userId")),
    orderBy: [asc(field(Purchase, "id"))],
  },
})
export class PurchaseList {}

@Saga({
  input: {
    id: "uuid",
    userId: "uuid",
    cartId: "uuid",
    marketId: "uuid",
    totalCents: "integer",
    snapshot: "json",
    createdAt: "string",
  },
  steps: { apply: event(Purchase, "Create") },
  terminal: { step: "apply", view: PurchaseDetails },
})
class PurchaseCreate {}

@Module({
  entities: [User, Market, Product, Offer, Cart, Purchase],
  views: [
    UserDetails,
    UserList,
    MarketDetails,
    MarketList,
    ProductDetails,
    ProductList,
    OfferDetails,
    OfferList,
    CartDetails,
    CartList,
    PurchaseDetails,
    PurchaseList,
  ],
  sagas: [
    UserCreate,
    MarketCreate,
    ProductCreate,
    OfferSave,
    CartCreate,
    CartUpdate,
    PurchaseCreate,
  ],
})
export class Shopping {}
