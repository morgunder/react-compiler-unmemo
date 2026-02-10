# Edge Cases & Post-Migration Fixes

After running `remove-hooks.mjs`, the following edge cases required manual fixes.
These are pre-existing type issues that were **hidden** by `useMemo`/`useCallback`'s
looser type inference and only surfaced once the wrappers were removed.

---

## 1. Lost Generic Type Annotations on `columns` Arrays

**Problem:** When `useMemo<ColumnsType<T>>(...)` is removed, the generic type
annotation `ColumnsType<T>` is stripped along with it. Without the annotation,
TypeScript infers a loose object literal type instead of `ColumnsType<T>`, causing
type mismatches with table `onChange` handlers.

**Error example:**
```
Type '(sorter: SorterResult<TaxArea>[] | SorterResult<TaxArea>) => void'
is not assignable to type '(sorter: SorterResult<{ id: any; ... }>) => void'.
```

**Fix:** Add the type annotation directly to the variable:
```typescript
// Before (script output)
const columns = [
  { title: "Name", dataIndex: "name", ... },
];

// After (manual fix)
const columns: ColumnsType<TaxArea> = [
  { title: "Name", dataIndex: "name", ... },
];
```

---

## 2. Lost Type Annotations on `formFields` Arrays

**Problem:** `FormFieldProps` has a union type for the `type` field
(`"text" | "select" | "switch" | ...`). When `useMemo` wraps the array,
TypeScript doesn't strictly check the object literal. Once removed,
`type: "text"` is inferred as `string`, which doesn't satisfy the union.

**Error example:**
```
Type 'string' is not assignable to type '"number" | "text" | "switch" | "select" | ...'
```

**Fix:** Add `FormFieldProps[]` type annotation to the `formFields` variable:
```typescript
// Before
const formFields = [
  { label: "Name", name: "name", type: "text", span: 12 },
];

// After
const formFields: FormFieldProps[] = [
  { label: "Name", name: "name", type: "text", span: 12 },
];
```

---

## 3. Invalid Properties on Typed Objects (Pre-existing Bugs)

**Problem:** Some object literals contained properties that don't exist on
their target type. `useMemo`'s loose inference hid these errors.

### 3a. `scrollable` property on column definitions
```typescript
// Invalid — 'scrollable' doesn't exist on ColumnType<Manifest>
{ title: "PO", scrollable: true, ... }

// Fix: remove the invalid property
{ title: "PO", ... }
```
### 3b. `sorterIndex` typo (should be `sortIndex`)
```typescript
// Invalid
{ sorterIndex: "name" }

// Fix
{ sortIndex: "name" }
```
### 3c. `required` and `addonAfter` on `FormFieldProps`
```typescript
// Invalid — these properties don't exist on FormFieldProps
{ required: false, addonAfter: <UserOutlined /> }

// Fix: remove the invalid properties
```

### 3d. Method name typos exposed by stricter inference
```typescript
// Invalid
form.setFieldsValues({ finalAim: newFinalAimType });

// Fix
form.setFieldsValue({ finalAim: newFinalAimType });
```
---

## 4. Implicit `any` Parameters

**Problem:** When `useCallback` wraps a function, TypeScript can sometimes
infer parameter types from context. Once the wrapper is removed, parameters
may lose their inferred types and become implicit `any`.

**Error example:**
```
Parameter '_' implicitly has an 'any' type.
```

**Fix:** Add explicit type annotations to the parameters:
```typescript
// Before
render: (_, record) => record.customer?.comment || "",

// After
render: (_: unknown, record: CustomerRouteFrequency) => record.customer?.comment || "",
```

---

## 5. `useMemo` Returning a Value vs. Function

**Problem:** The script converts `useMemo(() => expr, [deps])` to just `expr`.
But if `expr` is an object or complex expression, the result may need parens
to avoid parsing ambiguity.

**Example:**
```typescript
// useMemo(() => ({ key: value }), [deps])
// Correctly becomes:
const obj = ({ key: value });

// useMemo(() => { return entity || DEFAULT; }, [entity])
// Correctly becomes (IIFE for complex bodies):
const item = (() => { ... })();
// Or for simple return:
const item = (entity || DEFAULT);
```

The script handles both cases automatically.

---

## 6. Hooks with Embedded Comments (Script Limitation)

**Problem:** The script's comment detection can cause it to skip hooks that contain
`//` comments inside their body. The script sees the `//` and thinks the entire
hook call is inside a comment.

**Symptom:** The hook is left untouched after running the script, or is partially
transformed (e.g. the wrapper is removed but the dependency array is left behind).

**Example — skipped entirely:**
```typescript
// Script cannot process this because of the // comments inside
const findOption = useCallback(
  (value: number) => {
    // No dependencies since we're using a ref
    return optionsRef.current.find((opt) => opt.value === value);
  },
  [],
);

// Fix: manually remove the wrapper
const findOption = (value: number) => {
    // No dependencies since we're using a ref
    return optionsRef.current.find((opt) => opt.value === value);
  };
```

**Example — broken IIFE with leftover dependency array:**
```typescript
// Script partially transforms, leaving ", [deps])" behind
const orderBy = (() => {
    // Default ordering
    return { name: "AscNullsLast" };
  }, [order]);   // <-- broken: should be "})();"

// Fix:
const orderBy = (() => {
    // Default ordering
    return { name: "AscNullsLast" };
  })();
```

---

## 7. `as Type` Casts on Function Expressions

**Problem:** When `useCallback` wraps a function that has an `as Type` cast at
the end, removing the wrapper leaves a bare function expression with a dangling
cast that may not parse correctly.

**Example:**
```typescript
// Before
const Toggle = useCallback(() => {
  return React.createElement(Button, { onClick: handleToggle });
}, [handleToggle]) as React.FC;

// Script output (broken)
const Toggle: React.FC = () => {
  return React.createElement(Button, { onClick: handleToggle });
} as React.FC;

// Fix: remove the dangling cast (the variable already has the type)
const Toggle: React.FC = () => {
  return React.createElement(Button, { onClick: handleToggle });
};
```

---

## 8. Missing `ColumnsType` Import

**Problem:** The fix-type-annotations step adds `ColumnsType<T>` annotations to
`columns` arrays, but does not add the corresponding import. If the file didn't
already import `ColumnsType`, you'll get a "Cannot find name" error.

**Error example:**
```
Cannot find name 'ColumnsType'.
```

**Fix:** Add the import:
```typescript
import type { ColumnsType } from "antd/es/table";
```

---

## Summary Checklist

After running the script, run `npx tsc --noEmit` (or your build command) and check for:

1. **`ColumnsType<T>` annotations** — any file that had `useMemo<ColumnsType<T>>`
2. **Missing `ColumnsType` import** — add `import type { ColumnsType } from "antd/es/table"`
3. **`FormFieldProps[]` annotations** — any file with `formFields` arrays
4. **Implicit `any` errors** — render functions in column definitions
5. **Invalid properties** — properties that were silently ignored before
6. **Hooks with embedded comments** — may be skipped or partially transformed
7. **Dangling `as Type` casts** — remove if the variable already has the type
8. **Broken IIFEs** — leftover `, [deps])` instead of `)()`
