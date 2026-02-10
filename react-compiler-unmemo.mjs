#!/usr/bin/env node

/**
 * react-compiler-unmemo.mjs
 *
 * Runner that executes the full React Compiler hook removal pipeline:
 *   1. Remove useMemo/useCallback hooks
 *   2. Fix type annotations lost during removal
 *
 * Usage:
 *   npx react-compiler-unmemo <directory> [options]
 *
 * Options:
 *   --write         Apply changes to files (default is dry-run / preview)
 *   --verbose       Show detailed output for each transformation
 *   --files <glob>  File glob pattern (default: src/**\/*.{tsx,ts})
 *   --skip-fix      Skip the type annotation fix step
 *
 * Examples:
 *   npx react-compiler-unmemo ./my-react-app                    # preview (dry-run)
 *   npx react-compiler-unmemo ./my-react-app --write             # apply changes
 *   npx react-compiler-unmemo ./my-react-app --write --verbose
 *   npx react-compiler-unmemo /absolute/path/to/project --files "app/**\/*.tsx"
 */

import path from "path";
import { run as fixTypes } from "./src/fix-type-annotations.mjs";
import { run as removeHooks } from "./src/remove-hooks.mjs";

// ─── CLI ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const write = args.includes("--write");
const dryRun = !write;
const verbose = args.includes("--verbose");
const skipFix = args.includes("--skip-fix");

const filesIdx = args.indexOf("--files");
const fileGlob = filesIdx !== -1 && args[filesIdx + 1] ? args[filesIdx + 1] : undefined;

// First positional arg is the directory
const positionalArgs = args.filter(
  (a) => !a.startsWith("--") && (args.indexOf(a) === 0 || !["--files", "--dir"].includes(args[args.indexOf(a) - 1])),
);
const targetDir = positionalArgs[0] ? path.resolve(positionalArgs[0]) : null;

if (!targetDir) {
  console.log("Usage: npx react-compiler-unmemo <directory> [options]");
  console.log();
  console.log("Options:");
  console.log("  --write         Apply changes to files (default is preview/dry-run)");
  console.log("  --verbose       Show detailed output per transformation");
  console.log("  --files <glob>  File glob pattern (default: src/**/*.{tsx,ts})");
  console.log("  --skip-fix      Skip the type annotation fix step");
  console.log();
  console.log("Examples:");
  console.log("  npx react-compiler-unmemo ./my-react-app                # preview (safe default)");
  console.log("  npx react-compiler-unmemo ./my-react-app --write        # apply changes");
  console.log("  npx react-compiler-unmemo ./my-react-app --write --verbose");
  console.log('  npx react-compiler-unmemo /path/to/project --files "app/**/*.tsx"');
  process.exit(1);
}

// ─── Step 1: Remove hooks ────────────────────────────────────────────────────

console.log("━".repeat(60));
console.log("  Step 1/2: Remove useMemo & useCallback");
console.log("━".repeat(60));
console.log();

const hookResult = removeHooks(targetDir, { fileGlob, dryRun, verbose });

// ─── Step 2: Fix type annotations ────────────────────────────────────────────

if (!skipFix) {
  console.log();
  console.log("━".repeat(60));
  console.log("  Step 2/2: Fix type annotations");
  console.log("━".repeat(60));
  console.log();

  const fixResult = fixTypes(targetDir, { fileGlob, dryRun });

  // ─── Summary ─────────────────────────────────────────────────────────────

  console.log();
  console.log("═".repeat(60));
  console.log("  Summary");
  console.log("═".repeat(60));
  console.log();
  console.log(`  Files modified:      ${hookResult.changedCount}`);
  console.log(`  Hooks removed:       ${hookResult.totalTransformations}`);
  console.log(`  Types fixed:         ${fixResult.fixCount}`);
  console.log(`  Errors:              ${hookResult.errors.length + fixResult.errors.length}`);
  if (hookResult.remaining.length > 0) {
    console.log(`  Remaining refs:      ${hookResult.remaining.length} files`);
  }
  if (dryRun) {
    console.log();
    console.log("  (dry run — no files were written)");
    console.log("  Run with --write to apply changes.");
  } else {
    console.log();
    console.log("  Next steps:");
    console.log("    1. Run your build tool to check for type errors");
    console.log("    2. Review docs/edge-cases.md for known manual fixes");
    console.log("    3. Run again if new files are added");
  }
  console.log();

  const hasErrors = hookResult.errors.length + fixResult.errors.length > 0;
  process.exit(hasErrors ? 1 : 0);
} else {
  console.log();
  console.log("═".repeat(60));
  console.log("  Summary (type fix skipped)");
  console.log("═".repeat(60));
  console.log();
  console.log(`  Files modified:      ${hookResult.changedCount}`);
  console.log(`  Hooks removed:       ${hookResult.totalTransformations}`);
  console.log(`  Errors:              ${hookResult.errors.length}`);
  if (hookResult.remaining.length > 0) {
    console.log(`  Remaining refs:      ${hookResult.remaining.length} files`);
  }
  console.log();

  process.exit(hookResult.errors.length > 0 ? 1 : 0);
}
