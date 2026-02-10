# Architecture

Deep dive into how `react-compiler-unmemo` works under the hood.

## Overview

The tool is a two-step pipeline:

```
react-compiler-unmemo.mjs
  ├── Step 1: src/remove-hooks.mjs   → strip useMemo/useCallback
  └── Step 2: src/fix-type-annotations.mjs → restore lost type annotations
```

Each script exports a `run(targetDir, options)` function and can also run standalone via CLI.

---

## Step 1: Hook Removal (`src/remove-hooks.mjs`)

### Phase 1: Strip Generic Type Parameters

Before removing the hook call itself, we strip any TypeScript generic type parameters:

```
useMemo<ColumnsType<TaxArea>>(  →  useMemo(
```

This is done with a character scanner that counts nested `<>` brackets, since a simple regex like `<[^>]*>` fails on nested generics like `ColumnsType<TaxArea>`.

### Phase 2: Remove Hook Calls

For each occurrence of `useMemo(` or `useCallback(` (including `React.` prefixed variants):

1. **Find the matching closing paren** using a depth-counting parser that tracks `()`, `[]`, `{}` while respecting strings, template literals, and escape sequences.

2. **Strip the dependency array** by scanning for the last `, [` at depth 0 inside the call.

3. **Unwrap the arrow function** by finding `=>` at depth 0.

4. **Generate the replacement:**

   | Pattern | Replacement |
   |---------|-------------|
   | `useMemo(() => expr, [deps])` | `expr` |
   | `useMemo(() => { return expr; }, [deps])` | `expr` |
   | `useMemo(() => { complex; body; }, [deps])` | `(() => { complex; body; })()` |
   | `useCallback((a, b) => body, [deps])` | `(a, b) => body` |

5. **Loop** — since indices shift after each replacement, we restart the search after every successful replacement. A safety counter (200 max) prevents infinite loops.

### Phase 3: Clean Imports

After all hooks are removed, we clean up the import statements:

```typescript
// Before
import { useMemo, useCallback, useState } from "react";

// After
import { useState } from "react";
```

Handles both `import { ... }` and `import React, { ... }` styles. Empty imports are removed entirely.

---

## Step 2: Fix Type Annotations (`src/fix-type-annotations.mjs`)

When `useMemo<ColumnsType<Foo>>(...)` is stripped, the generic type annotation is lost. This step scans for known patterns and restores the annotation on the variable:

```typescript
// Lost annotation
const columns = [...]

// Restored
const columns: ColumnsType<Foo> = [...]
```

### Type Inference

The script infers the correct type parameter `T` from surrounding code context:

- **`ColumnsType<T>`** — looks for `SorterResult<T>`, `Table<T>`, or `ColumnType<T>` in the same file
- **`FormFieldProps[]`** — applied to any `formFields` array

Each pattern has an `alreadyTyped` regex to skip files that already have the annotation (idempotent).

---

## Parser Design

The core parser is character-by-character rather than regex-based. This is critical because:

1. **Nested brackets** — `useMemo<ColumnsType<TaxArea>>()` has nested `<>` that regex can't match
2. **Multi-line constructs** — hooks often span 20+ lines with complex nested objects
3. **Strings containing brackets** — `"some (text)"` inside a hook body would confuse regex
4. **Template literals** — `` `${expr}` `` with nested expressions

### String/Template Tracking

The parser tracks three states:
- **Normal** — counting brackets
- **In string** — `'...'` or `"..."`, respecting `\\` escapes
- **In template** — `` `...` ``, tracking `${...}` expression depth

### Comment Awareness

Before processing any match, `isInsideComment()` checks if the position is inside a `//` line comment or `/* */` block comment.

---

## File Structure

```
react-compiler-unmemo/
├── react-compiler-unmemo.mjs      # Entry point / runner
├── src/
│   ├── remove-hooks.mjs           # Core hook removal
│   └── fix-type-annotations.mjs   # Type annotation fixer
├── docs/
│   ├── architecture.md            # This file
│   └── edge-cases.md              # Known edge cases
├── package.json
├── .gitignore
└── README.md
```

## Exported API

Both scripts export their `run()` function for programmatic use:

```javascript
import { run as removeHooks } from "./src/remove-hooks.mjs";
import { run as fixTypes } from "./src/fix-type-annotations.mjs";  // in react-compiler-unmemo.mjs

// Remove hooks from a directory
const result = removeHooks("/path/to/project", {
  fileGlob: "src/**/*.{tsx,ts}",
  dryRun: false,
  verbose: true,
});
// result: { changedCount, totalTransformations, errors, remaining }

// Fix type annotations
const fixResult = fixTypes("/path/to/project", {
  fileGlob: "src/**/*.{tsx,ts}",
  dryRun: false,
});
// fixResult: { fixCount, errors }
```

## Limitations

- **Does not use an AST parser** — the character-by-character approach is simpler and has no dependencies beyond `glob`, but it could theoretically be confused by extremely unusual code patterns
- **Type inference is heuristic** — the fix-type-annotations step only handles known patterns (`ColumnsType`, `FormFieldProps`). Other lost generics need manual annotation
- **IIFE fallback** — complex `useMemo` bodies with multiple statements become `(() => { ... })()` which works but isn't the prettiest
