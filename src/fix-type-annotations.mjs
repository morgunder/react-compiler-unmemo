#!/usr/bin/env node

/**
 * fix-type-annotations.mjs
 *
 * Post-migration helper that attempts to restore type annotations
 * that were lost when useMemo<Type>() generics were stripped.
 *
 * Scans for common patterns (untyped `columns` arrays, `formFields` arrays)
 * and infers the correct type annotation from surrounding code context.
 *
 * Can be used standalone or imported by run.mjs.
 *
 * Standalone usage:
 *   node fix-type-annotations.mjs --dir <path> [--dry-run]
 */

import fs from "fs";
import { glob } from "glob";
import path from "path";

// ─── Fix Patterns ────────────────────────────────────────────────────────────

// Each pattern describes a variable that may have lost its type annotation
// when useMemo<Type>() was stripped. The script tries to infer the correct
// type from surrounding code context.
const fixPatterns = [
  {
    // const columns = [ -> const columns: ColumnsType<T> = [
    description: "ColumnsType on columns arrays",
    filePattern: /\.(tsx|ts)$/,
    search: /^(\s*const columns)\s*=\s*\[/m,
    alreadyTyped: /const columns\s*:\s*ColumnsType/,
    getType: (content) => {
      // Infer T from SorterResult<T>, Table<T>, or ColumnType<T> usage
      const sorterMatch = content.match(/SorterResult<(\w+)>/);
      if (sorterMatch) return `ColumnsType<${sorterMatch[1]}>`;
      const tableMatch = content.match(/Table<(\w+)>/);
      if (tableMatch) return `ColumnsType<${tableMatch[1]}>`;
      const colMatch = content.match(/ColumnType<(\w+)>/);
      if (colMatch) return `ColumnsType<${colMatch[1]}>`;
      return null;
    },
    replace: (groups, type) => `${groups[1]}: ${type} = [`,
  },
  {
    // const formFields = [ -> const formFields: FormFieldProps[] = [
    description: "FormFieldProps[] on formFields arrays",
    filePattern: /\.(tsx|ts)$/,
    search: /^(\s*const formFields)\s*=\s*\[/m,
    alreadyTyped: /const formFields\s*:\s*FormFieldProps/,
    getType: () => "FormFieldProps[]",
    replace: (groups, type) => `${groups[1]}: ${type} = [`,
  },
];

// ─── Processing ──────────────────────────────────────────────────────────────

function processFile(filePath, targetDir, { dryRun = false } = {}) {
  let content = fs.readFileSync(filePath, "utf8");
  let changed = false;
  const fixes = [];

  for (const pattern of fixPatterns) {
    if (!pattern.filePattern.test(filePath)) continue;
    if (pattern.alreadyTyped.test(content)) continue;

    const match = content.match(pattern.search);
    if (!match) continue;

    const type = pattern.getType(content);
    if (!type) continue;

    content = content.replace(pattern.search, (fullMatch, ...groups) => {
      return pattern.replace([fullMatch, ...groups], type);
    });
    changed = true;
    fixes.push({ type, description: pattern.description });
    console.log(`  ✓ ${path.relative(targetDir, filePath)} — added ${type}`);
  }

  if (changed && !dryRun) {
    fs.writeFileSync(filePath, content);
  }

  return { changed, fixes };
}

// ─── Run ─────────────────────────────────────────────────────────────────────

export function run(targetDir, { fileGlob = "src/**/*.{tsx,ts}", dryRun = false } = {}) {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  Fix Type Annotations After Hook Removal         ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log();

  if (!fs.existsSync(targetDir)) {
    console.error(`Error: Target directory not found: ${targetDir}`);
    return { fixCount: 0, errors: [] };
  }

  const files = glob.sync(fileGlob, {
    cwd: targetDir,
    absolute: true,
  });

  let fixCount = 0;
  const errors = [];

  for (const file of files) {
    try {
      const { fixes } = processFile(file, targetDir, { dryRun });
      fixCount += fixes.length;
    } catch (err) {
      errors.push({ file: path.relative(targetDir, file), error: err.message });
      console.error(`  ✗ ${path.relative(targetDir, file)}: ${err.message}`);
    }
  }

  console.log();
  console.log(`Fixed ${fixCount} type annotations${dryRun ? " (dry run)" : ""}.`);

  return { fixCount, errors };
}

// ─── Standalone CLI ──────────────────────────────────────────────────────────

const isMain = process.argv[1] && (process.argv[1].endsWith("fix-type-annotations.mjs") || process.argv[1].endsWith("fix-type-annotations"));

if (isMain) {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const dryRun = !write;

  const dirIdx = args.indexOf("--dir");
  const targetDir = dirIdx !== -1 && args[dirIdx + 1] ? path.resolve(args[dirIdx + 1]) : null;

  const filesIdx = args.indexOf("--files");
  const fileGlob = filesIdx !== -1 && args[filesIdx + 1] ? args[filesIdx + 1] : undefined;

  if (!targetDir) {
    console.error("Usage: node fix-type-annotations.mjs --dir <path> [--write] [--files <glob>]");
    process.exit(1);
  }

  const result = run(targetDir, { fileGlob, dryRun });
  if (dryRun) {
    console.log("Dry run complete. Run with --write to apply changes.");
  } else {
    console.log("Run your build tool to check for remaining type errors.");
  }
  process.exit(result.errors.length > 0 ? 1 : 0);
}
