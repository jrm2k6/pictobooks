import { resolve } from "node:path";
import { rebuildCatalogIndexes } from "./review/catalog.js";

const invocationCwd = process.env.INIT_CWD ?? process.cwd();
const args = process.argv.slice(2).filter(value => value !== "--");
const catalogRoot = resolve(invocationCwd, args[0] ?? "catalog");
const stylePackVersion = args[1] ?? "pictobook-preschool-v0.1";

await rebuildCatalogIndexes(catalogRoot, stylePackVersion);
console.log(
  `[catalog] refreshed ${stylePackVersion} indexes with source run labels`
);
