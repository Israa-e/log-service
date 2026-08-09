/**
 * generate-swagger.ts — exports the OpenAPI spec built in src/swagger.ts to openapi.json
 * so it can be committed to Git and served from a public raw URL (e.g. GitHub
 * raw) for SwaggerHub or other consumers that can't reach localhost.
 * Usage:  npm run generate:swagger
 */

import { writeFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";

import { swaggerSpec } from "../src/swagger.js";

const outPath = resolve(fileURLToPath(import.meta.url), "../../openapi.json");
writeFileSync(outPath, JSON.stringify(swaggerSpec, null, 2) + "\n");
console.log(`Wrote ${outPath}`);