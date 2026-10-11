import { readFileSync } from "node:fs";
import {
  BUILTIN_PROVIDERS,
  compileProjectSources,
  compileServiceConfiguration,
  serviceConfiguration,
  monolith,
  node,
  postgres,
  env,
  postgresMailbox,
  postgresOutbox,
  postgresDeduplication,
  postgresSaga,
  postgresFailureQueue,
  http,
  sse,
} from "@lilka/vane";

const compiled = compileProjectSources([
  {
    fileName: "model.vane.ts",
    sourceText: readFileSync(
      new URL("./model.vane.ts", import.meta.url),
      "utf8",
    ),
  },
]);
if (!compiled.success) throw new Error(JSON.stringify(compiled.diagnostics));
export const namespace = process.env.VANE_NAMESPACE ?? "shopping";
if (!/^[a-z][a-z0-9_]{0,62}$/.test(namespace))
  throw new Error("Invalid VANE_NAMESPACE");
const operations = [
  "User.Create",
  "Market.Create",
  "Product.Create",
  "Offer.Save",
  "Cart.Create",
  "Cart.Update",
  "Purchase.Create",
];
export const configuration = serviceConfiguration({
  application: "shopping-example",
  project: compiled.ir,
  providers: BUILTIN_PROVIDERS,
  profiles: {
    development: {
      environment: "development",
      topology: monolith({
        name: "api",
        modules: ["Shopping"],
        runtime: node(),
        persistence: {
          provider: postgres(),
          namespace,
          targetVersion: 16,
          connection: env("DATABASE_URL"),
        },
      }),
      communication: {
        mailbox: postgresMailbox(),
        outbox: postgresOutbox(),
        deduplication: postgresDeduplication(),
        saga: postgresSaga(),
        failureQueue: postgresFailureQueue(),
      },
      http: {
        provider: http(),
        sagaStream: sse(),
        security: {
          authentication: "none",
          authorization: "allow",
          cors: [],
          rateLimit: null,
        },
      },
      telemetry: { exporter: "none" },
      contracts: {
        Shopping: {
          basePath: "/shopping",
          events: operations.map((event) => ({
            event,
            saga: event.replace(".", ""),
            terminal: {
              view: `${event.split(".")[0]}Details`,
              input: { id: { kind: "eventInput", input: "id" } },
            },
          })),
          views: [
            "User",
            "Market",
            "Product",
            "Offer",
            "Cart",
            "Purchase",
          ].flatMap((entity) => [
            { view: `${entity}Details` },
            { view: `${entity}List` },
          ]),
        },
      },
    },
  },
});
export const result = compileServiceConfiguration(configuration, "development");
if (!result.success) throw new Error(JSON.stringify(result.diagnostics));
