#!/usr/bin/env node

/**
 * remove-hooks.mjs
 *
 * Removes useMemo and useCallback hooks from React/TypeScript files
 * to leverage React Compiler automatic optimization.
 *
 * Can be used standalone or imported by run.mjs.
 *
 * Standalone usage:
 *   node remove-hooks.mjs --dir <path> [options]
 *
 * Options:
 *   --dir <path>    Target directory (required when run standalone)
 *   --files <glob>  File glob pattern (default: src/**\/*.{tsx,ts})
 *   --dry-run       Show what would change without writing files
 *   --verbose       Show detailed output for each transformation
 */

import fs from "fs";
import { glob } from "glob";
import path from "path";

// ─── Core Parsing Helpers ────────────────────────────────────────────────────

/**
 * Check if the character at idx is escaped by counting consecutive
 * backslashes before it. Odd count means escaped, even means not.
 */
export function isEscaped(str, idx) {
  let count = 0;
  let pos = idx - 1;
  while (pos >= 0 && str[pos] === "\\") {
    count++;
    pos--;
  }
  return count % 2 === 1;
}

/**
 * Find the matching closing paren for an opening paren at startIdx.
 * Counts nested parens/brackets/braces and respects strings and template literals.
 */
export function findClosingParen(content, startIdx) {
  let depth = 0;
  let inString = false;
  let stringChar = "";
  let inTemplate = false;
  let templateDepth = 0;

  for (let i = startIdx; i < content.length; i++) {
    const ch = content[i];

    // Handle escape sequences
    if ((inString || inTemplate) && ch === "\\" && !isEscaped(content, i)) {
      i++; // skip next char
      continue;
    }

    // Handle string boundaries
    if (!inTemplate && (ch === '"' || ch === "'" || ch === "`")) {
      if (ch === "`") {
        if (!inTemplate && !inString) {
          inTemplate = true;
          templateDepth = 0;
          continue;
        }
      } else if (!inTemplate) {
        if (!inString) {
          inString = true;
          stringChar = ch;
          continue;
        } else if (ch === stringChar) {
          inString = false;
          continue;
        }
      }
    }

    // Handle template literal end
    if (inTemplate && ch === "`" && templateDepth === 0) {
      inTemplate = false;
      continue;
    }

    // Handle template literal expressions ${...}
    if (inTemplate && ch === "$" && content[i + 1] === "{") {
      templateDepth++;
      i++;
      continue;
    }
    if (inTemplate && templateDepth > 0 && ch === "}") {
      templateDepth--;
      continue;
    }

    if (inString || inTemplate) continue;

    // Skip line comments
    if (ch === "/" && content[i + 1] === "/") {
      const eol = content.indexOf("\n", i + 2);
      if (eol === -1) return -1;
      i = eol;
      continue;
    }

    // Skip block comments
    if (ch === "/" && content[i + 1] === "*") {
      const close = content.indexOf("*/", i + 2);
      if (close === -1) return -1;
      i = close + 1;
      continue;
    }

    if (ch === "(") depth++;
    if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Strip the trailing dependency array from the inner content of useMemo/useCallback.
 * e.g. "() => foo, [a, b]" -> "() => foo"
 * Handles nested brackets/parens at depth 0.
 */
export function stripDepsArray(inner) {
  let depth = 0;
  let lastCommaIdx = -1;
  let inString = false;
  let stringChar = "";

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];

    // Simple string tracking
    if ((ch === '"' || ch === "'" || ch === "`") && !isEscaped(inner, i)) {
      if (!inString) {
        inString = true;
        stringChar = ch;
        continue;
      } else if (ch === stringChar) {
        inString = false;
        continue;
      }
    }
    if (inString) continue;

    // Skip line comments
    if (ch === "/" && inner[i + 1] === "/") {
      const eol = inner.indexOf("\n", i + 2);
      if (eol === -1) break;
      i = eol;
      continue;
    }

    // Skip block comments
    if (ch === "/" && inner[i + 1] === "*") {
      const close = inner.indexOf("*/", i + 2);
      if (close === -1) break;
      i = close + 1;
      continue;
    }

    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      // Check if what follows (after whitespace/newlines) is "["
      const rest = inner.slice(i + 1).trimStart();
      if (rest.startsWith("[")) {
        lastCommaIdx = i;
      }
    }
  }
  if (lastCommaIdx === -1) return inner;
  return inner.slice(0, lastCommaIdx);
}

/**
 * Find the arrow "=>" at depth 0 in the inner content.
 * Returns { params, body } or null.
 */
export function unwrapArrowFn(inner) {
  let depth = 0;
  let inString = false;
  let stringChar = "";

  for (let i = 0; i < inner.length - 1; i++) {
    const ch = inner[i];

    if ((ch === '"' || ch === "'" || ch === "`") && !isEscaped(inner, i)) {
      if (!inString) {
        inString = true;
        stringChar = ch;
        continue;
      } else if (ch === stringChar) {
        inString = false;
        continue;
      }
    }
    if (inString) continue;

    // Skip line comments
    if (ch === "/" && inner[i + 1] === "/") {
      const eol = inner.indexOf("\n", i + 2);
      if (eol === -1) break;
      i = eol;
      continue;
    }

    // Skip block comments
    if (ch === "/" && inner[i + 1] === "*") {
      const close = inner.indexOf("*/", i + 2);
      if (close === -1) break;
      i = close + 1;
      continue;
    }

    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "=" && inner[i + 1] === ">" && depth === 0) {
      const params = inner.slice(0, i).trim();
      const body = inner.slice(i + 2).trim();
      return { params, body };
    }
  }
  return null;
}

/**
 * Check if a position in the content is inside a comment (line or block).
 */
export function isInsideComment(content, idx) {
  // Check for line comment: find the start of the line
  const lineStart = content.lastIndexOf("\n", idx) + 1;
  const linePrefix = content.slice(lineStart, idx);
  if (linePrefix.includes("//")) return true;

  // Check for block comment: find the last /* before idx
  let lastBlockOpen = content.lastIndexOf("/*", idx);
  if (lastBlockOpen !== -1) {
    let lastBlockClose = content.lastIndexOf("*/", idx);
    if (lastBlockClose < lastBlockOpen) return true;
  }

  return false;
}

/**
 * Check if a position in the content is inside a string literal, template
 * literal, or comment. Scans from the start of the content to correctly
 * track nested context.
 */
export function isInsideStringOrComment(content, idx) {
  let i = 0;
  while (i < idx) {
    const ch = content[i];

    // Line comment — skip to end of line
    if (ch === "/" && content[i + 1] === "/") {
      const eol = content.indexOf("\n", i + 2);
      if (eol === -1) return true; // idx is in this comment (rest of file)
      if (idx < eol) return true;
      i = eol + 1;
      continue;
    }

    // Block comment — skip to closing */
    if (ch === "/" && content[i + 1] === "*") {
      const close = content.indexOf("*/", i + 2);
      if (close === -1) return true; // unclosed block comment
      if (idx < close + 2) return true;
      i = close + 2;
      continue;
    }

    // Template literal
    if (ch === "`") {
      i++;
      let templateDepth = 0;
      while (i < content.length) {
        if (content[i] === "\\" ) {
          if (idx === i || idx === i + 1) return true;
          i += 2; continue;
        }
        if (content[i] === "`" && templateDepth === 0) { i++; break; }
        if (content[i] === "$" && content[i + 1] === "{") { templateDepth++; i += 2; continue; }
        if (content[i] === "}" && templateDepth > 0) { templateDepth--; i++; continue; }
        if (i === idx) return true;
        i++;
      }
      continue;
    }

    // String literals
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      while (i < content.length) {
        if (content[i] === "\\" ) {
          if (idx === i || idx === i + 1) return true;
          i += 2; continue;
        }
        if (content[i] === quote) { i++; break; }
        if (i === idx) return true;
        i++;
      }
      continue;
    }

    i++;
  }
  return false;
}

// ─── Main Processing ─────────────────────────────────────────────────────────

export function processFile(filePath, { dryRun = false } = {}) {
  let content = fs.readFileSync(filePath, "utf8");
  const original = content;
  let changed = false;
  const transformations = [];

  // Phase 1: Strip generic type params like useMemo<ColumnsType<Foo>>( -> useMemo(
  // Store stripped generics so Phase 2 can apply them as type annotations
  const strippedGenerics = new Map();
  const hookNames = [
    "React.useMemo",
    "React.useCallback",
    "useMemo",
    "useCallback",
  ];
  for (const hookName of hookNames) {
    let searchFrom = 0;
    while (true) {
      const hookIdx = content.indexOf(hookName + "<", searchFrom);
      if (hookIdx === -1) break;

      // Make sure this isn't part of a larger identifier
      if (hookIdx > 0) {
        const prevChar = content[hookIdx - 1];
        if (/[a-zA-Z0-9_$.]/.test(prevChar) && !hookName.startsWith("React.")) {
          searchFrom = hookIdx + 1;
          continue;
        }
      }

      if (isInsideStringOrComment(content, hookIdx)) {
        searchFrom = hookIdx + 1;
        continue;
      }

      const angleStart = hookIdx + hookName.length;
      // Count nested angle brackets to find the matching '>'
      let depth = 0;
      let angleEnd = -1;
      for (let i = angleStart; i < content.length; i++) {
        if (content[i] === "<") depth++;
        if (content[i] === ">") {
          depth--;
          if (depth === 0) {
            angleEnd = i;
            break;
          }
        }
      }
      if (angleEnd === -1 || content[angleEnd + 1] !== "(") {
        searchFrom = hookIdx + 1;
        continue;
      }

      const genericType = content.slice(angleStart + 1, angleEnd);
      content =
        content.slice(0, angleStart) + content.slice(angleEnd + 1);
      // After stripping, the hook call starts at hookIdx — store the generic
      strippedGenerics.set(hookIdx, genericType);
      changed = true;
      transformations.push({
        type: "strip-generic",
        hook: hookName,
        genericType,
      });
    }
  }

  // Phase 2: Replace useMemo(...) and useCallback(...) calls
  const patterns = [
    "React.useMemo(",
    "React.useCallback(",
    "useMemo(",
    "useCallback(",
  ];

  let safety = 0;
  while (safety++ < 200) {
    let found = false;

    for (const pattern of patterns) {
      // Search forward, skipping occurrences inside strings/comments
      let searchFrom = 0;
      let idx = -1;
      while (true) {
        const candidate = content.indexOf(pattern, searchFrom);
        if (candidate === -1) break;

        if (isInsideStringOrComment(content, candidate)) {
          searchFrom = candidate + pattern.length;
          continue;
        }

        // Make sure this isn't part of a larger identifier (e.g. "myUseMemo(")
        if (candidate > 0 && !pattern.startsWith("React.")) {
          const prevChar = content[candidate - 1];
          if (/[a-zA-Z0-9_$]/.test(prevChar)) {
            searchFrom = candidate + pattern.length;
            continue;
          }
        }

        idx = candidate;
        break;
      }
      if (idx === -1) continue;

      const openParenIdx = idx + pattern.length - 1;
      const closeParenIdx = findClosingParen(content, openParenIdx);
      if (closeParenIdx === -1) continue;

      const inner = content.slice(openParenIdx + 1, closeParenIdx);
      const withoutDeps = stripDepsArray(inner).trim();

      const isMemo = pattern.includes("useMemo");
      const isCallback = pattern.includes("useCallback");

      const arrow = unwrapArrowFn(withoutDeps);

      let replacement;
      if (isMemo && arrow) {
        const body = arrow.body;
        if (body.startsWith("{")) {
          // Multi-statement body: check for simple { return X; } pattern
          const trimmed = body.slice(1, -1).trim();
          const returnMatch = trimmed.match(/^return\s+([\s\S]+?);?\s*$/);
          if (returnMatch) {
            replacement = returnMatch[1].trim();
            if (replacement.endsWith(";"))
              replacement = replacement.slice(0, -1);
            // Wrap in parens if it starts with ( to preserve grouping
            // or if it's a multi-line expression
            if (
              replacement.includes("\n") &&
              !replacement.startsWith("(") &&
              !replacement.startsWith("[") &&
              !replacement.startsWith("{")
            ) {
              replacement = `(\n${replacement}\n)`;
            }
          } else {
            // Complex body - wrap in IIFE
            replacement = `(() => ${body})()`;
          }
        } else {
          // Simple expression body
          replacement = body;
        }
      } else if (isCallback && arrow) {
        replacement = `${arrow.params} => ${arrow.body}`;
      } else {
        // Fallback: just remove the wrapper
        replacement = withoutDeps;
      }

      const lineNum =
        content.slice(0, idx).split("\n").length;

      // If Phase 1 stripped a generic type, inject it as a type annotation
      const genericType = strippedGenerics.get(idx);
      let prefix = content.slice(0, idx);
      if (genericType) {
        const declMatch = prefix.match(/((?:const|let|var)\s+\w+)\s*=\s*$/);
        if (declMatch) {
          const insertPos = prefix.length - declMatch[0].length + declMatch[1].length;
          prefix = prefix.slice(0, insertPos) + ": " + genericType + prefix.slice(insertPos);
        }
        strippedGenerics.delete(idx);
      }

      content =
        prefix +
        replacement +
        content.slice(closeParenIdx + 1);
      changed = true;
      found = true;

      transformations.push({
        type: isMemo ? "useMemo" : "useCallback",
        line: lineNum,
        pattern,
      });

      break; // restart since indices changed
    }

    if (!found) break;
  }

  // Phase 3: Clean up imports (always run — hooks are unnecessary with React Compiler)
  {
    const importPatterns = [
      {
        regex: /import React, \{([^}]*)\} from (["'])react\2[^\S\n]*;?/g,
        replace: (match, imports, quote) => {
          const semi = match.trimEnd().endsWith(";") ? ";" : "";
          const cleaned = imports
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s && s !== "useMemo" && s !== "useCallback")
            .join(", ");
          if (!cleaned) return `import React from ${quote}react${quote}${semi}`;
          return `import React, { ${cleaned} } from ${quote}react${quote}${semi}`;
        },
      },
      {
        regex: /import \{([^}]*)\} from (["'])react\2[^\S\n]*;?/g,
        replace: (match, imports, quote) => {
          const semi = match.trimEnd().endsWith(";") ? ";" : "";
          const cleaned = imports
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s && s !== "useMemo" && s !== "useCallback")
            .join(", ");
          if (!cleaned) return ""; // Remove empty import entirely
          return `import { ${cleaned} } from ${quote}react${quote}${semi}`;
        },
      },
    ];

    for (const { regex, replace } of importPatterns) {
      let result = "";
      let lastIndex = 0;
      let m;
      regex.lastIndex = 0;
      while ((m = regex.exec(content)) !== null) {
        if (isInsideStringOrComment(content, m.index)) {
          continue;
        }
        result += content.slice(lastIndex, m.index);
        result += replace(m[0], m[1], m[2]);
        lastIndex = m.index + m[0].length;
      }
      result += content.slice(lastIndex);
      content = result;
    }

    // Clean up any resulting blank lines from removed imports
    content = content.replace(/\n\n\n+/g, "\n\n");
  }

  // Track if imports were cleaned even without hook call changes
  if (content !== original) {
    changed = true;
  }

  if (changed && !dryRun) {
    fs.writeFileSync(filePath, content);
  }

  return { changed, transformations, original, result: content };
}

// ─── Run ─────────────────────────────────────────────────────────────────────

// Run the hook removal on a directory.
// targetDir: absolute path to the project root
// options: { fileGlob, dryRun, verbose }
export function run(targetDir, { fileGlob = "src/**/*.{tsx,ts}", dryRun = false, verbose = false } = {}) {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  React Compiler - Remove useMemo/useCallback    ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log();

  if (!fs.existsSync(targetDir)) {
    console.error(`Error: Target directory not found: ${targetDir}`);
    return { changedCount: 0, totalTransformations: 0, errors: [{ file: targetDir, error: "not found" }], remaining: [] };
  }

  const files = glob.sync(fileGlob, {
    cwd: targetDir,
    absolute: true,
  });

  console.log(`Target:     ${targetDir}`);
  console.log(`Pattern:    ${fileGlob}`);
  console.log(`Files:      ${files.length}`);
  console.log(`Mode:       ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log();

  let changedCount = 0;
  let totalTransformations = 0;
  const errors = [];

  for (const file of files) {
    try {
      const { changed, transformations } = processFile(file, { dryRun });
      if (changed) {
        changedCount++;
        totalTransformations += transformations.length;
        const rel = path.relative(targetDir, file);
        console.log(`  ✓ ${rel} (${transformations.length} changes)`);
        if (verbose) {
          for (const t of transformations) {
            if (t.type === "strip-generic") {
              console.log(`      ↳ stripped generic <${t.genericType}> from ${t.hook}`);
            } else {
              console.log(`      ↳ removed ${t.type} at line ${t.line}`);
            }
          }
        }
      }
    } catch (err) {
      const rel = path.relative(targetDir, file);
      errors.push({ file: rel, error: err.message });
      console.error(`  ✗ ${rel}: ${err.message}`);
    }
  }

  console.log();
  console.log(`Modified:   ${changedCount} files`);
  console.log(`Changes:    ${totalTransformations} transformations`);
  if (dryRun) console.log(`(dry run — no files were written)`);

  if (errors.length > 0) {
    console.log();
    console.log(`Errors:     ${errors.length}`);
    for (const e of errors) {
      console.log(`  - ${e.file}: ${e.error}`);
    }
  }

  // Report remaining
  const remaining = [];
  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    if (/\buseMemo\b/.test(content) || /\buseCallback\b/.test(content)) {
      remaining.push(path.relative(targetDir, file));
    }
  }
  if (remaining.length > 0) {
    console.log();
    console.log(`⚠ ${remaining.length} files still reference useMemo/useCallback:`);
    remaining.forEach((f) => console.log(`  - ${f}`));
  }

  return { changedCount, totalTransformations, errors, remaining };
}

// ─── Standalone CLI ──────────────────────────────────────────────────────────

const isMain = process.argv[1] && (process.argv[1].endsWith("remove-hooks.mjs") || process.argv[1].endsWith("remove-hooks"));

if (isMain) {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const dryRun = !write;
  const verbose = args.includes("--verbose");

  const dirIdx = args.indexOf("--dir");
  const targetDir = dirIdx !== -1 && args[dirIdx + 1] ? path.resolve(args[dirIdx + 1]) : null;

  const filesIdx = args.indexOf("--files");
  const fileGlob = filesIdx !== -1 && args[filesIdx + 1] ? args[filesIdx + 1] : undefined;

  if (!targetDir) {
    console.error("Usage: node remove-hooks.mjs --dir <path> [--write] [--files <glob>] [--verbose]");
    process.exit(1);
  }

  const result = run(targetDir, { fileGlob, dryRun, verbose });
  console.log();
  if (dryRun) {
    console.log("Dry run complete. Run with --write to apply changes.");
  } else {
    console.log("Done. Run your build tool to verify no type errors were introduced.");
  }
  process.exit(result.errors.length > 0 ? 1 : 0);
}
