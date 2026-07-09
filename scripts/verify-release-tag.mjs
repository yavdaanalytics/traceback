#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rawTag = process.argv[2] ?? process.env.GITHUB_REF_NAME ?? "";
const tag = rawTag.trim();
if (!tag) {
  throw new Error("release tag is required (argument or GITHUB_REF_NAME)");
}
if (!/^v\d+\.\d+\.\d+(?:[-+].+)?$/.test(tag)) {
  throw new Error(`release tag "${tag}" must follow v<semver> format`);
}

const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf-8"));
const expected = `v${pkg.version}`;
if (tag !== expected) {
  throw new Error(`tag ${tag} does not match package.json version ${expected}`);
}

process.stdout.write(`release tag ${tag} matches package.json version ${pkg.version}\n`);
