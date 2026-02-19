import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, afterEach } from "node:test";

import { processFile } from "../helpers/remove-hooks.mjs";

// ─── Helpers ────────────────────────────────────────────────────────────────

let tmpFiles = [];

function transform(input) {
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `unmemo-test-${Date.now()}-${Math.random().toString(36).slice(2)}.tsx`);
  fs.writeFileSync(tmpFile, input);
  tmpFiles.push(tmpFile);
  const { result } = processFile(tmpFile, { dryRun: true });
  return result;
}

afterEach(() => {
  for (const f of tmpFiles) {
    try { fs.unlinkSync(f); } catch {}
  }
  tmpFiles = [];
});

// ─── useMemo: simple expression ─────────────────────────────────────────────

describe("useMemo removal", () => {
  it("simple expression body", () => {
    const input = `import { useMemo, useState } from "react";
const value = useMemo(() => computeExpensiveValue(a, b), [a, b]);`;
    const expected = `import { useState } from "react";
const value = computeExpensiveValue(a, b);`;
    assert.equal(transform(input), expected);
  });

  it("single return statement body", () => {
    const input = `import { useMemo } from "react";
const value = useMemo(() => {
  return a + b;
}, [a, b]);`;
    const expected = `
const value = a + b;`;
    assert.equal(transform(input), expected);
  });

  it("complex multi-statement body becomes IIFE", () => {
    const input = `import { useMemo } from "react";
const value = useMemo(() => {
  const x = compute();
  const y = transform(x);
  return y;
}, [compute, transform]);`;
    const expected = `
const value = (() => {
  const x = compute();
  const y = transform(x);
  return y;
})();`;
    assert.equal(transform(input), expected);
  });

  it("object expression body preserves parens", () => {
    const input = `import { useMemo } from "react";
const obj = useMemo(() => ({ key: value }), [value]);`;
    const expected = `
const obj = ({ key: value });`;
    assert.equal(transform(input), expected);
  });

  it("array expression body", () => {
    const input = `import { useMemo } from "react";
const items = useMemo(() => [1, 2, 3], []);`;
    const expected = `
const items = [1, 2, 3];`;
    assert.equal(transform(input), expected);
  });

  it("no dependency array", () => {
    const input = `import { useMemo } from "react";
const value = useMemo(() => expensive());`;
    const expected = `
const value = expensive();`;
    assert.equal(transform(input), expected);
  });

  it("empty dependency array", () => {
    const input = `import { useMemo } from "react";
const value = useMemo(() => expensive(), []);`;
    const expected = `
const value = expensive();`;
    assert.equal(transform(input), expected);
  });
});

// ─── useCallback ────────────────────────────────────────────────────────────

describe("useCallback removal", () => {
  it("simple arrow function", () => {
    const input = `import { useCallback } from "react";
const handler = useCallback((e) => doSomething(e), [doSomething]);`;
    const expected = `
const handler = (e) => doSomething(e);`;
    assert.equal(transform(input), expected);
  });

  it("multi-param arrow function", () => {
    const input = `import { useCallback } from "react";
const handler = useCallback((a, b, c) => a + b + c, []);`;
    const expected = `
const handler = (a, b, c) => a + b + c;`;
    assert.equal(transform(input), expected);
  });

  it("block body arrow function", () => {
    const input = `import { useCallback } from "react";
const handler = useCallback((e) => {
  e.preventDefault();
  doSomething(e);
}, [doSomething]);`;
    const expected = `
const handler = (e) => {
  e.preventDefault();
  doSomething(e);
};`;
    assert.equal(transform(input), expected);
  });

  it("no params arrow function", () => {
    const input = `import { useCallback } from "react";
const handler = useCallback(() => doSomething(), [doSomething]);`;
    const expected = `
const handler = () => doSomething();`;
    assert.equal(transform(input), expected);
  });
});

// ─── React.useMemo / React.useCallback ─────────────────────────────────────

describe("React.* prefixed variants", () => {
  it("React.useMemo", () => {
    const input = `import React from "react";
const value = React.useMemo(() => compute(a), [a]);`;
    const expected = `import React from "react";
const value = compute(a);`;
    assert.equal(transform(input), expected);
  });

  it("React.useCallback", () => {
    const input = `import React from "react";
const handler = React.useCallback((e) => handle(e), [handle]);`;
    const expected = `import React from "react";
const handler = (e) => handle(e);`;
    assert.equal(transform(input), expected);
  });
});

// ─── Generic type parameter stripping ───────────────────────────────────────

describe("generic type parameter stripping", () => {
  it("simple generic: useMemo<Type>", () => {
    const input = `import { useMemo } from "react";
const columns = useMemo<ColumnsType>(() => [col1, col2], [col1, col2]);`;
    const expected = `
const columns = [col1, col2];`;
    assert.equal(transform(input), expected);
  });

  it("nested generic: useMemo<ColumnsType<TaxArea>>", () => {
    const input = `import { useMemo } from "react";
const columns = useMemo<ColumnsType<TaxArea>>(() => [col1, col2], [col1, col2]);`;
    const expected = `
const columns = [col1, col2];`;
    assert.equal(transform(input), expected);
  });

  it("deeply nested generic: useMemo<ColumnsType<Foo<Bar>>>", () => {
    const input = `import { useMemo } from "react";
const columns = useMemo<ColumnsType<Foo<Bar>>>(() => [col1], []);`;
    const expected = `
const columns = [col1];`;
    assert.equal(transform(input), expected);
  });

  it("React.useMemo<Type>", () => {
    const input = `import React from "react";
const columns = React.useMemo<ColumnsType<TaxArea>>(() => [col1], []);`;
    const expected = `import React from "react";
const columns = [col1];`;
    assert.equal(transform(input), expected);
  });
});

// ─── Import cleanup ─────────────────────────────────────────────────────────

describe("import cleanup", () => {
  it("removes useMemo from named imports, keeps others", () => {
    const input = `import { useMemo, useState, useEffect } from "react";
const value = useMemo(() => 1, []);`;
    const expected = `import { useState, useEffect } from "react";
const value = 1;`;
    assert.equal(transform(input), expected);
  });

  it("removes useCallback from named imports, keeps others", () => {
    const input = `import { useCallback, useRef } from "react";
const fn = useCallback(() => doIt(), []);`;
    const expected = `import { useRef } from "react";
const fn = () => doIt();`;
    assert.equal(transform(input), expected);
  });

  it("removes both useMemo and useCallback", () => {
    const input = `import { useMemo, useCallback, useState } from "react";
const a = useMemo(() => 1, []);
const b = useCallback(() => 2, []);`;
    const expected = `import { useState } from "react";
const a = 1;
const b = () => 2;`;
    assert.equal(transform(input), expected);
  });

  it("removes entire import when only useMemo/useCallback", () => {
    const input = `import { useMemo, useCallback } from "react";
const a = useMemo(() => 1, []);`;
    const expected = `
const a = 1;`;
    assert.equal(transform(input), expected);
  });

  it("handles import React, { useMemo, ... } style", () => {
    const input = `import React, { useMemo, useState } from "react";
const a = useMemo(() => 1, []);`;
    const expected = `import React, { useState } from "react";
const a = 1;`;
    assert.equal(transform(input), expected);
  });

  it("import React, { useMemo } collapses to import React", () => {
    const input = `import React, { useMemo } from "react";
const a = useMemo(() => 1, []);`;
    const expected = `import React from "react";
const a = 1;`;
    assert.equal(transform(input), expected);
  });

  it("handles single-quote imports", () => {
    const input = `import { useMemo, useState } from 'react';
const a = useMemo(() => 1, []);`;
    const expected = `import { useState } from 'react';
const a = 1;`;
    assert.equal(transform(input), expected);
  });

  it("handles whitespace before semicolon in named import", () => {
    const input = `import { useMemo, useState } from "react" ;
const a = useMemo(() => 1, []);`;
    const expected = `import { useState } from "react";
const a = 1;`;
    assert.equal(transform(input), expected);
  });

  it("handles multiple spaces before semicolon in named import", () => {
    const input = `import { useMemo } from "react"  ;
const a = useMemo(() => 1, []);`;
    const expected = `
const a = 1;`;
    assert.equal(transform(input), expected);
  });

  it("handles whitespace before semicolon in import React, { ... } style", () => {
    const input = `import React, { useMemo, useState } from "react" ;
const a = useMemo(() => 1, []);`;
    const expected = `import React, { useState } from "react";
const a = 1;`;
    assert.equal(transform(input), expected);
  });

  it("handles whitespace before semicolon with single quotes", () => {
    const input = `import { useMemo, useEffect } from 'react' ;
const a = useMemo(() => 1, []);`;
    const expected = `import { useEffect } from 'react';
const a = 1;`;
    assert.equal(transform(input), expected);
  });
});

// ─── Multi-line hooks ───────────────────────────────────────────────────────

describe("multi-line hooks", () => {
  it("multi-line useMemo with single return", () => {
    const input = `import { useMemo } from "react";
const data = useMemo(
  () => {
    return items.filter((i) => i.active);
  },
  [items],
);`;
    const expected = `
const data = items.filter((i) => i.active);`;
    assert.equal(transform(input), expected);
  });

  it("multi-line useCallback", () => {
    const input = `import { useCallback } from "react";
const handleClick = useCallback(
  (event) => {
    event.preventDefault();
    navigate(event.target.href);
  },
  [navigate],
);`;
    const expected = `
const handleClick = (event) => {
    event.preventDefault();
    navigate(event.target.href);
  };`;
    assert.equal(transform(input), expected);
  });

  it("multi-line useMemo with complex body becomes IIFE", () => {
    const input = `import { useMemo } from "react";
const result = useMemo(() => {
  const filtered = items.filter((i) => i.active);
  const sorted = filtered.sort((a, b) => a.name.localeCompare(b.name));
  return sorted;
}, [items]);`;
    const expected = `
const result = (() => {
  const filtered = items.filter((i) => i.active);
  const sorted = filtered.sort((a, b) => a.name.localeCompare(b.name));
  return sorted;
})();`;
    assert.equal(transform(input), expected);
  });
});

// ─── Strings and template literals inside hooks ─────────────────────────────

describe("strings and template literals", () => {
  it("string containing parens inside useMemo", () => {
    const input = `import { useMemo } from "react";
const msg = useMemo(() => "hello (world)", []);`;
    const expected = `
const msg = "hello (world)";`;
    assert.equal(transform(input), expected);
  });

  it("template literal inside useMemo", () => {
    const input = `import { useMemo } from "react";
const msg = useMemo(() => \`hello \${name}\`, [name]);`;
    const expected = `
const msg = \`hello \${name}\`;`;
    assert.equal(transform(input), expected);
  });

  it("string containing brackets inside dependency array", () => {
    const input = `import { useMemo } from "react";
const val = useMemo(() => parse("[test]"), [parse]);`;
    const expected = `
const val = parse("[test]");`;
    assert.equal(transform(input), expected);
  });
});

// ─── Comment awareness ──────────────────────────────────────────────────────

describe("comment awareness", () => {
  it("skips useMemo inside a line comment", () => {
    const input = `import { useMemo } from "react";
// const old = useMemo(() => 1, []);
const active = true;`;
    assert.equal(transform(input), input);
  });

  it("skips useMemo inside a block comment", () => {
    const input = `import { useMemo } from "react";
/* const old = useMemo(() => 1, []); */
const active = true;`;
    assert.equal(transform(input), input);
  });
});

// ─── Multiple hooks in one file ─────────────────────────────────────────────

describe("multiple hooks in one file", () => {
  it("removes multiple useMemo calls", () => {
    const input = `import { useMemo, useState } from "react";
const a = useMemo(() => compute(x), [x]);
const b = useMemo(() => compute(y), [y]);
const c = useMemo(() => compute(z), [z]);`;
    const expected = `import { useState } from "react";
const a = compute(x);
const b = compute(y);
const c = compute(z);`;
    assert.equal(transform(input), expected);
  });

  it("removes mixed useMemo and useCallback", () => {
    const input = `import { useMemo, useCallback, useState } from "react";
const value = useMemo(() => compute(a), [a]);
const handler = useCallback((e) => handle(e), [handle]);`;
    const expected = `import { useState } from "react";
const value = compute(a);
const handler = (e) => handle(e);`;
    assert.equal(transform(input), expected);
  });
});

// ─── Edge: identifier boundary ──────────────────────────────────────────────

describe("identifier boundary checks", () => {
  it("does not transform myUseMemo", () => {
    const input = `const value = myUseMemo(() => 1, []);`;
    assert.equal(transform(input), input);
  });

  it("does not transform customUseCallback", () => {
    const input = `const fn = customUseCallback(() => 1, []);`;
    assert.equal(transform(input), input);
  });
});

// ─── Nested structures inside hook bodies ───────────────────────────────────

describe("nested structures", () => {
  it("nested objects in useMemo", () => {
    const input = `import { useMemo } from "react";
const config = useMemo(() => ({
  a: { b: { c: 1 } },
  d: [1, 2, 3],
}), []);`;
    const expected = `
const config = ({
  a: { b: { c: 1 } },
  d: [1, 2, 3],
});`;
    assert.equal(transform(input), expected);
  });

  it("nested function calls in useMemo", () => {
    const input = `import { useMemo } from "react";
const value = useMemo(() => outer(inner(a, b), c), [a, b, c]);`;
    const expected = `
const value = outer(inner(a, b), c);`;
    assert.equal(transform(input), expected);
  });

  it("arrow function returning arrow function in useCallback", () => {
    const input = `import { useCallback } from "react";
const curried = useCallback((a) => (b) => a + b, []);`;
    const expected = `
const curried = (a) => (b) => a + b;`;
    assert.equal(transform(input), expected);
  });
});

// ─── No-op: file without hooks ──────────────────────────────────────────────

describe("no-op cases", () => {
  it("file without any hooks is unchanged", () => {
    const input = `import { useState } from "react";
const [count, setCount] = useState(0);`;
    assert.equal(transform(input), input);
  });

  it("empty file is unchanged", () => {
    assert.equal(transform(""), "");
  });
});

// ─── Return value with ternary / logical expressions ────────────────────────

describe("expression patterns", () => {
  it("ternary expression in useMemo", () => {
    const input = `import { useMemo } from "react";
const label = useMemo(() => isActive ? "Active" : "Inactive", [isActive]);`;
    const expected = `
const label = isActive ? "Active" : "Inactive";`;
    assert.equal(transform(input), expected);
  });

  it("logical OR fallback in useMemo return", () => {
    const input = `import { useMemo } from "react";
const item = useMemo(() => {
  return entity || DEFAULT;
}, [entity]);`;
    const expected = `
const item = entity || DEFAULT;`;
    assert.equal(transform(input), expected);
  });
});
