# react-compiler-unmemo

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square)](https://nodejs.org)

A codemod that removes `useMemo` and `useCallback` from your React codebase so you can adopt [React Compiler](https://react.dev/learn/react-compiler) without the manual cleanup.

> **Note:** React Compiler works fine with existing manual memoization — it preserves and layers on top of it. Removing hooks is optional for cleanliness and readability, but **not required for performance**. Use this tool to declutter legacy code. Always preview with `--dry-run` and type-check afterward.

## Quick Start

```bash
npx react-compiler-unmemo ./my-react-app
```

This previews all changes without modifying any files (dry-run is the safe default). When you're ready to apply:

```bash
npx react-compiler-unmemo ./my-react-app --write
```

Or clone and run locally:

```bash
git clone https://github.com/thinksharpe/react-compiler-unmemo.git
cd react-compiler-unmemo
npm install
node react-compiler-unmemo.mjs ./path/to/your/project
```

## Origin

I tried using Claude Opus 4.5 to write a script that would remove `useMemo` and `useCallback` from my codebase, but it kept failing. Claude noticed that `sed` couldn't handle this kind of complex pattern matching — the nested parentheses, arrow functions, and dependency arrays made it impossible with simple text replacement. So it wrote this script instead.

I like to keep my code as readable as possible, and all those `useMemo` and `useCallback` hooks were adding extra complexity. I'm glad they're gone from my codebase now. Hope it helps someone else too.

## Before / After

```diff
- const value = useMemo(() => computeExpensiveValue(a, b), [a, b]);
+ const value = computeExpensiveValue(a, b);

- const handler = useCallback((e) => doSomething(e), [doSomething]);
+ const handler = (e) => doSomething(e);

- import { useMemo, useCallback, useState } from "react";
+ import { useState } from "react";
```

## Why

- **Cleaner code** — less boilerplate, easier to read and maintain
- **Aligns with modern React** — React Compiler handles memoization automatically
- **Smaller bundles** — unused hook imports are removed
- **Safe to re-run** — idempotent, won't touch already-processed files

## Usage

```bash
# 1. Preview changes (safe default — no files modified)
node react-compiler-unmemo.mjs ./my-app

# 2. Apply changes
node react-compiler-unmemo.mjs ./my-app --write

# 3. Type-check your project
cd ./my-app && npx tsc --noEmit
```

## Options

| Flag | Description | Default |
|------|-------------|--------|
| *(no flag)* | Preview changes without writing files | **dry-run** |
| `--write` | Apply changes to files | off |
| `--verbose` | Log every transformation | off |
| `--files <glob>` | Limit to specific file patterns | `src/**/*.{tsx,ts}` |
| `--skip-fix` | Skip type annotation repair step | off |

```bash
# Only process hooks directory
node react-compiler-unmemo.mjs ./my-app --files "src/hooks/**/*.ts" --write

# app directory
node react-compiler-unmemo.mjs ./my-app --files "app/**/*.{tsx,ts}"

# See every change in detail
node react-compiler-unmemo.mjs ./my-app --verbose
```

## What It Handles

- `useMemo(() => expr, [deps])` → `expr`
- `useMemo(() => { return expr; }, [deps])` → `expr`
- `useMemo<Type>(...)` → strips the generic, restores the type annotation
- `useCallback((params) => body, [deps])` → `(params) => body`
- `React.useMemo` / `React.useCallback` variants
- Multi-line hooks spanning dozens of lines
- Nested generics like `useMemo<ColumnsType<MyType>>()`
- Import cleanup (removes unused `useMemo`/`useCallback` from imports)

## When NOT to Use

- **You haven't enabled React Compiler yet** — without the compiler, removing `useMemo`/`useCallback` may cause performance regressions
- **Intentional escape hatches** — some hooks are used deliberately to control referential identity for third-party libraries
- **Class component interop** — if memoized values are passed to class components that rely on shallow comparison

When in doubt, use `--dry-run` and review the output.

## Post-Migration

**Always run your type checker after the migration:**

```bash
npx tsc --noEmit
# or your project's build command
```

The tool handles the most common cases automatically, but some things need manual attention:

- **Hooks with `//` comments inside** — the parser may skip or partially transform these. Check the "remaining refs" count in the output.
- **Missing imports** — the type fixer adds `ColumnsType<T>` annotations but may not add the import statement.
- **Dangling `as Type` casts** — if a `useCallback` had an `as React.FC` cast, it may need cleanup.
- **Broken IIFEs** — complex `useMemo` bodies with comments may leave a trailing `, [deps])` instead of `})()`.

See [docs/edge-cases.md](./docs/edge-cases.md) for the full list with code examples.

## Project Structure

```
react-compiler-unmemo/
├── react-compiler-unmemo.mjs  # Entry point
├── src/
│   ├── remove-hooks.mjs # Core hook removal
│   └── fix-type-annotations.mjs
├── docs/
│   ├── architecture.md  # How it works under the hood
│   └── edge-cases.md    # Known edge cases & fixes
├── package.json
└── README.md
```

For technical details on the parser and pipeline, see [docs/architecture.md](./docs/architecture.md).

## Contributing

Issues, PRs, and edge-case examples welcome. Please open an issue first for large changes.

If you've run this on a real codebase and hit an edge case, sharing the pattern (even without proprietary code) helps improve the tool for everyone.

## Links

- [React Compiler — Official Guide](https://react.dev/learn/react-compiler)
- [React 19 — What's New](https://react.dev/blog/2024/12/05/react-19)

## License

MIT — see [LICENSE](./LICENSE)
