# Next.js / React / TypeScript Style Guide

**Draft: Work in Progress**
Modeled on the _"C++ Style Guide"_ (NASA GSFC / GMAT Project, Jun & Shoan, Code 583).
Retargeted for Next.js (App Router) + React + TypeScript web projects.
Last Updated: 2026/07/19

---

## Table of Contents

1. Introduction
   - 1.1 Purpose
   - 1.2 Audience
   - 1.3 Interpretation
2. Names
   - 2.1 Component Names
   - 2.2 Module / Package Names
   - 2.3 Component Instance & Element Names
   - 2.4 Function Names
   - 2.5 Function Parameter Names
   - 2.6 Namespace / Module Names
   - 2.7 Variables
     - 2.7.1 Ref Variables (`useRef`)
     - 2.7.2 Boolean Variables
     - 2.7.3 Module-Scope ("Global") Variables
   - 2.8 Type Names (Interfaces & Aliases)
   - 2.9 Enum Types and Union-Literal Types
   - 2.10 Constants
   - 2.11 Object-Shape (Struct) Types
   - 2.12 Utility Function Names
   - 2.13 File Names
   - 2.14 Generated Code File Names
3. Formatting
   - 3.1 Variable Declarations
   - 3.2 Braces `{}`
   - 3.3 Parentheses `()`
   - 3.4 Indentation
   - 3.5 Tab / Space
   - 3.6 Blank Lines
   - 3.7 Function Arguments
   - 3.8 If / If-else
   - 3.9 Switch
   - 3.10 For / While / Iteration
   - 3.11 Break / Early Exit
   - 3.12 Use of `goto` (Prohibited Analogs)
   - 3.13 Use of the Ternary `?:`
   - 3.14 Return Statement
   - 3.15 Maximum Characters per Line
   - 3.16 Semicolons, Quotes, and Trailing Commas
   - 3.17 JSX Formatting
4. Documentation
   - 4.1 File Prolog (Header Comment)
   - 4.2 Exported / Public API Prolog
   - 4.3 Implementation Prolog
   - 4.4 Function / Method Prolog
   - 4.5 Comments in General
5. Components (the "Class" of React)
   - 5.1 Component Declaration (Interface)
   - 5.2 Component Definition (Implementation)
6. Generics (the "Templates" of TypeScript)
7. Project Files & Structure
8. Portability & Compatibility
9. Efficiency & Performance
10. Miscellaneous
    - 10.1 Imports & Module Boundaries
    - 10.2 Environment Variables
    - 10.3 Interop with JavaScript
    - 10.4 Version Control Keywords
    - 10.5 README file
    - 10.6 Build Scripts (`package.json`)
    - 10.7 Standard Libraries & Dependencies
    - 10.8 Use of Modules / Namespaces
    - 10.9 Utility Types & the Standard Library
    - 10.10 Object Creation & Immutability
11. TypeScript-Specific Standards
12. React-Specific Standards
13. Next.js-Specific Standards (App Router)

- Appendix A — Code Examples
- Appendix B — TSDoc / JSDoc Commands

---

## 1 Introduction

This document is based on the _"C++ Style Guide"_ (SEL/GMAT, Code 583), which in turn built on the _"C Style Guide"_ (SEL-94-003). It contains recommendations for **Next.js + React + TypeScript** web implementations that build on, or in some cases replace, the style described in those guides. Style guidelines on topics not covered here can be found in the official framework documentation. An attempt has been made to indicate when these recommendations are guidelines or suggestions versus when they are more strongly encouraged.

Using coding standards makes code easier to read and maintain. The general principles that maximize the readability and maintainability of a TypeScript/React codebase are:

- Organize UI using composition and information hiding (small components, narrow props).
- Enhance readability through consistent indentation, blank lines, and automated formatting.
- Add comments to exported/public modules to help _consumers_ of a component or hook.
- Add comments to implementation files to help _maintainers_.
- Create names that are meaningful and readable.
- Let the type system carry as much intent as the comments do.

### 1.1 Purpose

This document describes the recommended style for writing Next.js/React/TypeScript programs, where code with "good style" is defined as that which is:

- Organized
- Easy to read
- Easy to understand
- Maintainable
- Efficient (both runtime and bundle size)
- Type-safe

### 1.2 Audience

This document was written for web application developers, although the majority of these standards are generally applicable to any TypeScript front-end environment. It is intended to help developers produce better-quality applications by presenting specific guidelines for using language and framework features.

### 1.3 Interpretation

This document provides guidelines for organizing the content of TypeScript, React, and Next.js files so that code can be easily read, understood, and maintained, and discusses how it can be written more efficiently.

Terminology used throughout:

- **Component** — a React function that returns JSX; the closest analog to a C++ _class_.
- **Props** — the typed input contract of a component; the analog of a _class interface_.
- **Hook** — a reusable function beginning with `use` that hooks into React state/lifecycle.
- **Server Component** — a component that renders only on the server (the default in the App Router).
- **Client Component** — a component marked with `'use client'` that ships to and hydrates in the browser.
- **Module** — a single `.ts`/`.tsx` file and its exports; the analog of a C++ _translation unit_.

---

## 2 Names

In general, choose names that are meaningful and readable. If a name is appropriate, everything fits together naturally, relationships are clear, meaning is derivable, and reasoning from common human expectations works as expected.

Prefer `camelCase` and `PascalCase` over abbreviations. When an abbreviation is unavoidable, treat multi-letter acronyms as words (`HttpClient`, `parseJson`, `userId`) rather than screaming caps embedded mid-name (`HTTPClient`, `parseJSON`, `userID`). Be consistent.

```tsx
class-free: use function components
function FovPanel() { ... }
function UtcDate() { ... }
openMediaPlayer();
exportHtmlSource();
const inertialReferenceUnit = ...;
```

**Avoid underscores** in ordinary identifiers. Reserve `UPPER_SNAKE_CASE` for constants (§2.10) and a leading underscore only for the deliberate "intentionally unused" convention when a linter requires it.

### 2.1 Component Names

Use `PascalCase`. Capitalize the first letter of each word. React _requires_ this — lowercase names are treated as DOM tags.

```tsx
function MainFrame() { ... }
function DisplayPanel() { ... }
```

A component's file name should match the component name (§2.13). A component that specializes another may be suffixed with the base concept (`UserAvatarButton`, `PrimaryNavLink`). Error boundary components should be suffixed with `Boundary` (`RouteErrorBoundary`) and provider components with `Provider` (`ThemeProvider`).

### 2.2 Module / Package Names

Prevent name clashes by using ES modules and path aliases rather than global identifiers. Internal packages in a monorepo use lowercase, hyphen-delimited names (`@acme/ui`, `@acme/data-access`).

When only a few members of a module are used in a file, import them by name; when many are used, a namespace import (`import * as z from 'zod'`) is preferable to avoid clutter. This mirrors the C++ guidance on `using` vs. the scope operator.

### 2.3 Component Instance & Element Names

For rendered instances stored in variables (element handles, memoized nodes), follow the conventions for variables (§2.7). The JSX usage itself uses the `PascalCase` component name directly.

### 2.4 Function Names

Every function performs an action, so the name should make clear what it does. Names should be verbs in `camelCase`.

Useful prefixes:

- `is` / `has` / `can` / `should` — ask a question and return `boolean` (`isLoading`, `hasAccess`).
- `set` / `get` — set or read a value.
- `handle` / `on` — event handlers (`handleSubmit`; props that accept them are named `onSubmit`).
- `use` — **reserved for React hooks only.** Never prefix a non-hook with `use`.
- `create` / `build` / `compute` / `fetch` / `parse` — construction, derivation, retrieval.

Do not duplicate the module or type name in a function name:

```ts
vector.normalize(); // NOT: vector.normalizeVector()
```

### 2.5 Function Parameter Names

Use the same guidelines as for variables. When passing an object whose type is a named model, a parameter may share the lowercased type name (`forceModel: ForceModel`); this is not required and may be shortened where cumbersome (`fm: ForceModel`). Prefer a single typed "options object" over long positional lists (§3.7).

### 2.6 Namespace / Module Names

TypeScript `namespace` blocks are discouraged in application code — ES modules are the namespacing mechanism. Where a namespace-like grouping genuinely helps (e.g. co-locating helpers under one symbol), use `PascalCase` and prefer the project name as a prefix (`GmatTimeUtil`). Prefer a plain module of named exports.

### 2.7 Variables

Variables begin with a lowercase letter, first letter of each subsequent word capitalized (`camelCase`).

```ts
const flatteningCoefficient = 0.0033528;
const initialPosition: Vec3 = [0, 0, 0];
```

Add a comment to a declaration if the meaning is not clear from the name. Declare variables at the narrowest scope at which they are needed. Prefer `const`; use `let` only when reassignment is genuinely required; **never use `var`**. Comment units when not encoded in the name (`const initialPositionKm = ...`).

Loop indices may be declared inside the loop header. If the value is needed after the loop, declare it above.

```ts
for (let i = 0; i < MAX_SIZE && !done; i++) { ... }
```

Prefer project-defined types over primitives where a semantic type exists (use `Integer`/branded types over bare `number` when the domain calls for it), analogous to preferring `Integer` over `int`.

#### 2.7.1 Ref Variables (`useRef`)

Refs are the closest analog to C++ pointer/reference variables. Name them by intent and suffix with `Ref`:

```tsx
const inputRef = useRef<HTMLInputElement>(null); // may be null until mounted
const timerRef = useRef<number | null>(null);
```

Take care with the initial `null`: treat `ref.current` as possibly `null` on first render (the analog of a null-pointer check). Never mutate `ref.current` during render.

#### 2.7.2 Boolean Variables

Name booleans as assertions using the `is` / `has` / `can` / `should` prefixes so that call sites read as questions:

```ts
const isVisible = true;
const hasPermission = user.roles.includes("admin");
```

#### 2.7.3 Module-Scope ("Global") Variables

Use of mutable module-scope variables should be avoided; prefer React state, context, or an explicit store. Where a module needs shared constant data, export a `const` (immutable) value. This mirrors the C++ guidance to avoid globals in favor of namespaces.

### 2.8 Type Names (Interfaces & Aliases)

Type names have the first letter of each word capitalized (`PascalCase`).

```ts
type SystemType = number;
type RealType = number;
type RealArray = ReadonlyArray<RealType>;
interface UserProfile { ... }
```

Do **not** prefix interfaces with `I` (`IUser`) or suffix types with `T` — this is a discouraged legacy convention in TypeScript. Prefer `interface` for object shapes that may be extended/implemented and `type` for unions, intersections, tuples, and mapped/utility compositions (see §11).

### 2.9 Enum Types and Union-Literal Types

Prefer **union of string literals** over `enum` in application code — they are erasable, tree-shakeable, and require no runtime object:

```ts
type DayName =
  | "SUNDAY"
  | "MONDAY"
  | "TUESDAY"
  | "WEDNESDAY"
  | "THURSDAY"
  | "FRIDAY"
  | "SATURDAY";
```

If an `enum` is genuinely warranted (numeric flags, interop with a generated schema), the enum _type_ follows Component/Type naming (`PascalCase`) and its _members_ use `UPPER_SNAKE_CASE`:

```ts
enum Color {
  RED = 3,
  BLUE,
  DARK_BLUE,
  GREEN,
  DARK_GREEN,
  YELLOW = 7,
}
```

Prefer `const enum` only when you understand its bundling implications; otherwise avoid.

### 2.10 Constants

Module-level true constants use `UPPER_SNAKE_CASE`:

```ts
const MINIMUM_NUMBER_OF_BYTES = 4;
const MAX_NUMBER_OF_FILES = 4;
```

There is no `#define` in TypeScript; use `const` (with `as const` for literal narrowing) instead of macro-like patterns. Locally-scoped constants that are simply "not reassigned" use ordinary `camelCase` `const` — reserve `UPPER_SNAKE_CASE` for genuine, shared, compile-time constants.

### 2.11 Object-Shape (Struct) Types

The C++ "struct with a `Type` suffix" maps to a TypeScript `interface` or `type`. Do not add a `Type` suffix by default; name the concept directly.

```ts
interface Time {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}
```

Prefer classes only when you need identity, private state, or inheritance; for plain data, an `interface` (all fields public by nature) is preferred — the analog of "use a struct when all data is public."

### 2.12 Utility Function Names

Pure, framework-free helpers use ordinary `camelCase` verb names and live in a `lib/` or `utils/` module. There should be relatively few of these mixed into UI files — keep them separated so the boundary between "pure logic" and "React" is clear (the analog of using C functions only to interface between C and C++).

### 2.13 File Names

- React component files: `PascalCase.tsx` matching the component (`AnalyticalModel.tsx`), **or** the project's chosen kebab convention applied consistently. Pick one and enforce it via lint.
- Hooks: `useThing.ts` (`useForceModel.ts`).
- Non-component TypeScript modules: `camelCase.ts` or `kebab-case.ts` — again, one convention, enforced.
- Type-only modules: `types.ts` or `thing.types.ts`.
- Tests: `Thing.test.tsx` / `thing.test.ts`.
- Barrels: `index.ts` (use sparingly; see §10.1).

With the exception of the suffix, the file name should match, as closely as possible, the primary component/hook/type declared within it. **One component per file** (see §7).

### 2.14 Generated Code File Names

Do not hand-edit or rename files produced by other tools (Prisma client, GraphQL codegen, `next-env.d.ts`, route types, OpenAPI clients). Keep them in a clearly-labeled directory and add them to lint/format ignore lists.

---

## 3 Formatting

Use of standard formatting makes code easier to read. In practice, **delegate mechanical formatting to Prettier and enforce rules with ESLint** — the following describes the intended result. General principles:

- Use blank lines to group related statements into paragraphs.
- Limit statement complexity; break a complex expression into several simple ones if it reads more clearly.
- Indent to show logical structure.

### 3.1 Variable Declarations

Declare one variable per `const`/`let` statement. Prefer object/array destructuring to pull several related values in one readable statement:

```ts
const { data, error, isLoading } = useQuery(...);
```

### 3.2 Braces `{}`

Use braces for all multi-statement blocks. The **opening brace goes on the same line as the keyword** (K&R / "1TBS"), which is the JavaScript community norm — this is the one deliberate departure from the C++ guide's next-line brace:

```ts
function solarSystemBody() {
  statement1;
  statement2;
}
```

### 3.3 Parentheses `()`

Always parenthesize conditions. Put a space between a keyword and its parenthesis (`if (...)`, `while (...)`), and **no** space between a function name and its call parenthesis (`compute(x)`).

### 3.4 Indentation

Use **2 spaces** per level (the prevailing web convention; the C++ guide's "3 spaces" does not apply here). Keep it consistent via Prettier. Line up multi-line destructuring and object literals logically.

### 3.5 Tab / Space

Do not use tabs — use spaces, since tabs render differently across editors. Put one space after commas and semicolons; one space around binary and assignment operators; a space between a keyword and its parenthesis; and no space around member/access operators (`.`, `?.`, `[]`) or between a unary operator and its operand.

```ts
sum(2, x);
for (let i = 0; i < n; i++) { ... }
const z = a > b ? a : b;
```

### 3.6 Blank Lines

Use blank lines to create paragraphs in code and comments. A single blank line between logical groups is enough; avoid runs of multiple blank lines.

### 3.7 Function Arguments

Prefer a single, typed **options object** over long positional parameter lists — it is self-documenting at the call site and order-independent:

```ts
function someFunction(options: {
  count: number;
  scaleFactor: number;
  body: SolarSystemBody;
}) { ... }
```

When positional arguments genuinely fit better but overflow the line, put each on its own line, aligned. Booleans as positional args are discouraged (unclear at the call site) — prefer named options.

### 3.8 If / If-else

Prefer braces even for single statements (guards against edit-time bugs). Use explicit comparisons and early returns to keep nesting shallow.

```ts
if (condition) {
  statement;
} else if (otherCondition) {
  statement;
} else {
  statement;
}

// Prefer explicit:
if (thePile.isEndOfData() !== true) { ... }
// or simply:
if (!thePile.isEndOfData()) { ... }
```

Always brace nested `if`s.

### 3.9 Switch

Every `switch` should have a `default` case (which may throw for exhaustiveness). Place `default` last; include a `break` (or `return`) for consistency. Fall-through is permitted only with a comment. Wrap case-local variables in a block. Prefer exhaustiveness checking on discriminated unions (§11):

```ts
switch (shape.kind) {
  case 'circle':
    return area;
  case 'square': // fall through
  case 'rect': {
    const s = ...;
    return s;
  }
  default: {
    const _exhaustive: never = shape;
    throw new Error(`Unhandled: ${_exhaustive}`);
  }
}
```

### 3.10 For / While / Iteration

Prefer declarative array methods (`map`, `filter`, `reduce`, `some`, `every`) and `for...of` over index-based `for` where they read more clearly. Brace all loop bodies. Never mutate an array while mapping over it.

### 3.11 Break / Early Exit

`break` may exit an inner loop at a logical point rather than the loop test. Prefer **early `return`/guard clauses** over deep nesting; this is the idiomatic JS analog of the C++ break guidance.

### 3.12 Use of `goto` (Prohibited Analogs)

There is no `goto`. The equivalent prohibitions: **do not** abuse labeled `break`/`continue`, throw-as-control-flow, or deeply nested callback pyramids in place of `async`/`await`.

### 3.13 Use of the Ternary `?:`

Conditional (ternary) expressions are fine when not too complex. Parenthesize the condition to set it off. Do not nest ternaries deeply; extract a helper or use `if`/early return instead.

```ts
const label = isActive ? "On" : "Off";
```

### 3.14 Return Statement

Multiple returns (guard clauses) are encouraged where they make code clearer. Returning an expression directly is preferred to declaring a throwaway local — the JS analog of avoiding an unnecessary copy:

```ts
return new Vec3(
  cosArgPer * cosRa - sinArgPer * sinRa * cosI,
  cosArgPer * sinRa + sinArgPer * cosRa * cosI,
  sinArgPer * sinI,
);
```

### 3.15 Maximum Characters per Line

Target **100 characters** per line (a common modern default; the C++ guide's 80 is acceptable if the team prefers it). Set the Prettier `printWidth` and enforce it.

### 3.16 Semicolons, Quotes, and Trailing Commas

Pick one policy each and enforce with Prettier: terminate statements with semicolons; use single quotes for strings and double quotes only inside JSX attributes when preferred; use trailing commas in multi-line literals (cleaner diffs). Consistency matters more than the specific choice.

### 3.17 JSX Formatting

- One attribute per line when a tag has more than two or three props; the closing `>` (or `/>`) aligns under the opening tag.
- Wrap multi-line JSX returns in parentheses.
- Use self-closing tags for elements with no children (`<Icon />`).
- Boolean props are passed bare (`disabled`, not `disabled={true}`).
- Keep conditional rendering readable: prefer early returns, `&&` for simple presence, and a ternary for either/or; avoid nested ternaries in JSX.

```tsx
return (
  <Button variant="primary" disabled={isSubmitting} onClick={handleSubmit}>
    Save
  </Button>
);
```

---

## 4 Documentation

There are two main audiences for documentation:

- **Consumers** — developers who import and use a component, hook, or utility.
- **Maintainers** — developers who change its implementation.

Judiciously placed comments provide information that cannot be discerned from the code alone. Use the JSDoc/TSDoc convention (`/** ... */`) for anything that should surface in editor tooltips and generated docs; use line comments (`//`) for inline maintainer notes. A one-line brief description ends at the first period. Because TypeScript types already document shape and contract, **do not restate types in prose** — comment the _why_, the units, the invariants, and the gotchas. (See Appendix B for common TSDoc tags.)

```ts
/**
 * Brief description.
 *
 * Detailed description.
 */
```

### 4.1 File Prolog (Header Comment)

Non-trivial modules may begin with a short file prolog. Do **not** duplicate information the version-control system already tracks (authors, change history) — the C++ guide's "no CVS-duplicated history" rule applies equally to Git. Keep it to purpose and any consumer-facing assumptions:

```ts
/**
 * Project: GMAT — General Mission Analysis Tool
 * Legal: **Legal** (postprocessor inserts the license before release)
 *
 * Provides conversions among representations of A.1 calendar dates and times.
 *
 * @remarks Any notes for consumers here.
 */
```

### 4.2 Exported / Public API Prolog

Every exported component, hook, type, and utility should carry a TSDoc block focused on what consumers need: purpose, params/props, return value, thrown errors, and examples.

### 4.3 Implementation Prolog

Internal (non-exported) modules focus commentary on development and maintenance concerns rather than usage.

### 4.4 Function / Method Prolog

Each non-trivial function should describe its purpose, inputs, return value, and possible errors clearly and concisely. Note ownership/cleanup responsibilities (e.g. "caller must call the returned unsubscribe function") in the parameter or return description.

```ts
/**
 * Constructs a date from split calendar fields.
 *
 * @param year - input year
 * @param month - input month of year
 * @param day - input day of month
 * @throws {TimeRangeError} when a date or time is out of range
 */
```

### 4.5 Comments in General

Use `//` for ordinary comments and `/** */` only where documentation extraction is intended. Do not include pseudocode/PDL; comment clearly but succinctly — a block comment before each major section, notes on non-obvious declarations, and references to specs where appropriate. Include units when not in the name. When implementing a published algorithm, cite the source in the function prolog.

```ts
// Compute precession (Vallado, Eq. 3-56)
const zeta =
  (2306.2181 * tTDB + 0.30188 * tTDB2 + 0.017998 * tTDB3) * RAD_PER_ARCSEC;
```

Comments beginning with `//` do not appear in generated documentation.

---

## 5 Components (the "Class" of React)

A React component is the analog of a C++ class: **props are its interface, the function body is its implementation.**

### 5.1 Component Declaration (Interface)

- Public data (props) should be as narrow as possible; do not expose internal state through props without justification.
- Provide typed props via an `interface` named `<Component>Props`.
- Prefer **function declarations** for top-level components (better stack traces and hoisting) and default the export at the bottom or inline.
- Put the return type as `JSX.Element`/`React.ReactNode` implicitly (inference is fine); annotate hook return types explicitly when non-obvious.
- Mark a component `'use client'` **only** when it needs interactivity, state, effects, or browser APIs — otherwise it stays a Server Component (§13).

```tsx
interface DisplayPanelProps {
  title: string;
  items: readonly Item[];
  onSelect?: (id: string) => void;
}
```

**Required conventions for every component** (the analog of "required methods for a class"):

- A single, explicit `Props` interface (even if empty, prefer explicit).
- Sensible defaults for optional props (via default parameters/destructuring defaults).
- A stable, named export matching the file.
- Keys on every list-rendered element (stable, not the array index where order can change).

### 5.2 Component Definition (Implementation)

- **Do not do real work at module top level or during render.** Initialize with `useState`/`useReducer`; perform side effects in `useEffect`/event handlers or on the server. This mirrors "do no real work in the constructor."
- Initialize all state; never leave it `undefined` by accident.
- Keep the render pure — no mutation of props, refs, or external state during render.
- Order inside a component: `'use client'` (if any) → imports → props destructure → hooks (in stable order) → derived values → handlers → early returns → `return` JSX. This mirrors "methods in declaration order."
- Handle errors with Error Boundaries / `error.tsx` rather than throwing for control flow (§11, §13); catch async errors by rejection, the analog of "catch exceptions by reference."

```tsx
function DisplayPanel({ title, items, onSelect }: DisplayPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.order - b.order),
    [items],
  );

  function handleSelect(id: string) {
    setSelectedId(id);
    onSelect?.(id);
  }

  if (items.length === 0) {
    return <EmptyState label={title} />;
  }

  return (
    <section>
      <h2>{title}</h2>
      <ul>
        {sortedItems.map((item) => (
          <li key={item.id}>
            <button onClick={() => handleSelect(item.id)}>{item.name}</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

---

## 6 Generics (the "Templates" of TypeScript)

TypeScript generics are the analog of C++ templates: no runtime code is specialized; they exist purely for type-checking and are erased at compile time.

- Type parameters use single uppercase letters or `PascalCase` descriptive names (`T`, `TItem`, `TResponse`).
- Place the type-parameter list immediately after the function/type name.
- Constrain type parameters (`<T extends object>`) rather than leaving them open when the body assumes structure.
- Provide sensible defaults (`<T = unknown>`) where helpful.
- Unlike C++ templates, there is **no separate definition file and no portability/linker problem** — generics live in the same module. Keep them close to what they generalize.

```ts
interface ListProps<TItem> {
  items: readonly TItem[];
  renderItem: (item: TItem) => React.ReactNode;
  getKey: (item: TItem) => string;
}

function List<TItem>({ items, renderItem, getKey }: ListProps<TItem>) {
  return <ul>{items.map((it) => <li key={getKey(it)}>{renderItem(it)}</li>)}</ul>;
}
```

---

## 7 Project Files & Structure

Every non-trivial module should begin with a file prolog where one adds value (§4.1). Organize a project (App Router) around a small set of conventions:

- **One component per file**; the file is named for it.
- Co-locate a component with its styles, tests, and small sub-parts in a folder when it grows.
- Separate concerns into clear top-level areas: `app/` (routes), `components/` (shared UI), `lib/`/`utils/` (framework-free logic), `hooks/`, `types/`, `server/` (server-only code), `styles/`, `public/` (static assets).
- Route segments live under `app/` and use fixed file conventions: `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, `route.ts`, plus `sitemap.ts`, `robots.ts`, `opengraph-image.tsx` for SEO.
- Do not use rows of decorative characters to separate sections. Group related utilities in a meaningfully ordered module.
- Keep the "main" concern of a file singular: a page file exports one page; a hook file exports one hook.

---

## 8 Portability & Compatibility

- Target current, supported language and runtime features; avoid proposals not yet stabilized unless a documented polyfill/transpile step covers them.
- Enable TypeScript `strict` mode from the start — retrofitting strictness later is far harder (the analog of "consider optimizations from the start").
- Do not hard-code environment-specific paths or assume Node vs. browser globals; guard with feature checks or the Server/Client boundary.
- Centralize shared types in a `types/` module for easier evolution, the analog of centralizing `typedef`s.
- Never rely on non-standard or absolute import paths; use configured path aliases (`@/…`) with `/` separators only.

---

## 9 Efficiency & Performance

- **Default to Server Components; push `'use client'` to the leaves.** The less JavaScript shipped and hydrated, the faster the app — this is the single highest-leverage performance rule in Next.js.
- Minimize re-renders: memoize expensive derived values with `useMemo`, stabilize callbacks with `useCallback`, and wrap pure presentational components in `React.memo` **only when profiling shows a benefit** — premature memoization adds noise (the analog of "minimize constructor/destructor calls, but don't over-optimize").
- Prefer keys that are stable identities, not array indices, to avoid needless reconciliation.
- Fetch data on the server, in parallel where independent; stream with `loading.tsx`/Suspense rather than blocking.
- Lazy-load heavy, below-the-fold, or rarely-used client components with `next/dynamic`.
- Use `next/image` and `next/font` for automatic optimization; avoid shipping unoptimized assets.
- Avoid creating new object/array/function literals in props on every render where it forces children to re-render.

---

## 10 Miscellaneous

### 10.1 Imports & Module Boundaries

Place all imports at the top of the file, grouped and ordered: (1) React/Next, (2) third-party, (3) internal aliases (`@/…`), (4) relative, (5) styles/types. Prefer named imports. Use path aliases over long relative chains. Use barrel `index.ts` files sparingly — they can hurt tree-shaking and create import cycles.

### 10.2 Environment Variables

Access environment variables through a single validated module (e.g. a `zod`-parsed `env.ts`), never scattered `process.env.X` reads. Only variables prefixed `NEXT_PUBLIC_` are exposed to the browser; **never** put secrets behind that prefix. Never place secrets in client components or in URLs.

### 10.3 Interop with JavaScript

When consuming plain JS or untyped packages, add or install type declarations (`@types/*`) rather than sprinkling `any`. Wrap untyped boundaries in a thin typed adapter — the analog of fixing a C header to support C++ rather than `extern "C"`-wrapping blindly.

### 10.4 Version Control Keywords

Do not embed change history or author banners in files — Git tracks this. Keep file prologs to purpose and assumptions only (§4.1).

### 10.5 README file

A `README.md` should explain what the app does, how it is organized, and project-wide concerns: setup/run/build commands, required environment variables and their meaning, architecture notes, deployment targets, known issues, and a changelog pointer.

### 10.6 Build Scripts (`package.json`)

Define standard scripts (`dev`, `build`, `start`, `lint`, `typecheck`, `test`, `format`) so long tool invocations are abbreviated and consistent — the modern analog of Makefiles. Pin dependency versions with a lockfile and document any codegen steps.

### 10.7 Standard Libraries & Dependencies

Prefer the platform (Fetch API, `Intl`, `URL`, `structuredClone`) and framework primitives before adding a dependency. When adding one, prefer well-maintained, typed, tree-shakeable libraries and import only what you use. Audit for bundle-size impact.

### 10.8 Use of Modules / Namespaces

ES modules eliminate the need for global types, variables, and functions. Do not use TypeScript `namespace` for app code, and never place `using`-style side-effectful global imports at the top of a shared module in a way that leaks to all consumers. Prefer explicit named exports.

### 10.9 Utility Types & the Standard Library

Use built-in utility types (`Partial`, `Required`, `Readonly`, `Pick`, `Omit`, `Record`, `ReturnType`, `Awaited`, `NonNullable`) instead of hand-rolling equivalents — the analog of "use the STL when available."

### 10.10 Object Creation & Immutability

Treat props and state as immutable; produce new objects/arrays rather than mutating (`{ ...prev, x }`, `[...list, item]`). Handle possible-`null`/`undefined` explicitly rather than assuming success — the analog of catching `bad_alloc` from `new` rather than checking for `NULL`.

---

## 11 TypeScript-Specific Standards

- **Enable `strict` mode** (and `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` where feasible). Strictness is not optional in a well-styled codebase.
- **Avoid `any`.** Prefer `unknown` at untyped boundaries and narrow before use. Reserve `any` for genuinely unavoidable escape hatches and comment why. Never disable the compiler with blanket `// @ts-ignore` — use `// @ts-expect-error` with a reason so it fails loudly when the underlying issue is fixed.
- **Prefer inference; annotate contracts.** Let TypeScript infer local variables; explicitly annotate exported function signatures, props, and public return types so the API is stable and self-documenting.
- **`interface` vs `type`.** Use `interface` for extensible object shapes; use `type` for unions, intersections, tuples, mapped, and conditional types.
- **Discriminated unions + exhaustiveness.** Model variant data with a literal discriminant (`kind`) and enforce a `never` exhaustiveness check in `switch` (§3.9).
- **`as const` and `satisfies`.** Use `as const` to freeze literal shapes; use `satisfies` to check a value against a type without widening it.
- **Avoid unsafe assertions.** Prefer type guards and narrowing over `as` casts; a cast silences the compiler without proving anything.
- **Model absence explicitly.** Prefer `T | null` / `T | undefined` and optional (`?`) fields over sentinel values; handle both branches.
- **Brand domain primitives** where mixing them is dangerous (`type UserId = string & { readonly __brand: 'UserId' }`).

## 12 React-Specific Standards

- **Rules of Hooks.** Call hooks only at the top level of a component or custom hook, never in conditions, loops, or nested functions; only React functions call hooks. Keep hook call order stable across renders.
- **Custom hooks** start with `use`, return a stable, typed shape, and encapsulate one concern. Extract shared stateful logic into a hook rather than duplicating effects.
- **Keys.** Every element in a list needs a stable, unique `key`; do not use the array index when items can reorder, insert, or delete.
- **Effects are for synchronization, not derivation.** Do not use `useEffect` to compute values you can derive during render, or to respond to events (use handlers). Every effect declares complete, honest dependencies and cleans up subscriptions/timers it creates.
- **Lift state only as high as needed;** colocate state with the component that owns it. Reach for Context for genuinely cross-cutting values (theme, auth) and a dedicated store for complex global state — not for everything.
- **Controlled vs uncontrolled.** Prefer controlled inputs for validated forms; be consistent within a form.
- **Composition over configuration.** Prefer `children` and slot props over large boolean/enum prop matrices. Keep components small and single-purpose.
- **Error boundaries.** Wrap fallible subtrees; do not use exceptions as control flow in render.
- **Never mutate state directly;** always go through the setter with a new value/updater function.

## 13 Next.js-Specific Standards (App Router)

- **Server Components by default.** A component is a Server Component unless it declares `'use client'`. Add `'use client'` only for interactivity, state, effects, refs, or browser-only APIs, and place it at the **leaf** of the tree so the interactive island is as small as possible.
- **Data fetching.** Fetch on the server directly in async Server Components (direct `fetch`/DB calls) rather than client-side effects where possible. Fetch independent data in parallel; stream slow sections behind `loading.tsx`/`<Suspense>`.
- **Mutations.** Use **Server Actions** for form mutations (create/update/delete) and **Route Handlers** (`route.ts`) for webhooks, uploads, and endpoints consumed by external clients or client-side `fetch`.
- **File conventions carry meaning.** Use each special file for its fixed role: `page.tsx` (route UI), `layout.tsx` (shared, state-preserving wrapper), `loading.tsx` (Suspense skeleton), `error.tsx` (segment error boundary, must be a Client Component), `not-found.tsx`, `route.ts` (API). Folders define URL segments; nesting nests segments.
- **Route organization.** Use route groups `(group)` to organize without affecting the URL, dynamic segments `[param]`, parallel routes `@slot` for independently-loading regions, and intercepting routes for modal patterns.
- **Metadata & SEO.** Export `metadata` or `generateMetadata` for titles/OG data; use `sitemap.ts`, `robots.ts`, and `opengraph-image.tsx` conventions rather than third-party plugins.
- **Static params.** Use `generateStaticParams` for known dynamic routes to pre-render at build time.
- **Server-only secrets.** Keep secrets and privileged logic in Server Components/Actions/Route Handlers; guard modules with `server-only` where accidental client import would leak them. Only `NEXT_PUBLIC_`-prefixed env vars reach the browser.
- **Assets.** Use `next/image`, `next/font`, and `next/link` for built-in optimization and client-side navigation.
- **Do not mix routers** (App and Pages) in one project without a clear migration reason — the two rendering models create friction.

---

## Appendix A — Code Examples

### A.1 Example of a component + props "interface" file (`AnalyticalModel.tsx`)

```tsx
/**
 * Project: GMAT — General Mission Analysis Tool
 * **Legal**
 *
 * Renders and configures an analytical model panel.
 */
"use client";

import { useMemo, useState } from "react";
import type { ForceModel } from "@/types/force-model";
import { computeInverse } from "@/lib/matrix";

export interface AnalyticalModelProps {
  /** Human-readable model title. */
  title: string;
  /** Force model to visualize; read-only. */
  forceModel: ForceModel;
  /** Called when the user selects a body. */
  onSelectBody?: (bodyId: string) => void;
}

/**
 * Displays an analytical model and lets the user inspect its bodies.
 *
 * @remarks Client Component: owns selection state and handles clicks.
 */
export function AnalyticalModel({
  title,
  forceModel,
  onSelectBody,
}: AnalyticalModelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const inverse = useMemo(
    () => computeInverse(forceModel.matrix),
    [forceModel],
  );

  function handleSelect(id: string) {
    setSelectedId(id);
    onSelectBody?.(id);
  }

  if (forceModel.bodies.length === 0) {
    return <p>No bodies in this model.</p>;
  }

  return (
    <section aria-label={title}>
      <h2>{title}</h2>
      <ul>
        {forceModel.bodies.map((body) => (
          <li key={body.id}>
            <button
              aria-pressed={body.id === selectedId}
              onClick={() => handleSelect(body.id)}
            >
              {body.name}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

### A.2 Example of a Server Component route (`app/models/[id]/page.tsx`)

```tsx
/**
 * Project: GMAT — General Mission Analysis Tool
 * **Legal**
 *
 * Route: /models/[id] — server-rendered model detail page.
 */
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AnalyticalModel } from "@/components/AnalyticalModel";
import { getForceModel } from "@/server/force-models";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const model = await getForceModel(id);
  return { title: model ? `Model — ${model.name}` : "Model not found" };
}

/** Fetches the model on the server and renders the detail view. */
export default async function ModelPage({ params }: PageProps) {
  const { id } = await params;
  const forceModel = await getForceModel(id);

  if (!forceModel) {
    notFound();
  }

  return <AnalyticalModel title={forceModel.name} forceModel={forceModel} />;
}
```

### A.3 Example of a custom hook (`hooks/useForceModel.ts`)

```ts
/**
 * Subscribes to live updates for a force model.
 *
 * @param id - model identifier
 * @returns the current model, or `null` while loading
 * @remarks Cleans up its subscription on unmount.
 */
import { useEffect, useState } from "react";
import type { ForceModel } from "@/types/force-model";
import { subscribeToModel } from "@/lib/realtime";

export function useForceModel(id: string): ForceModel | null {
  const [model, setModel] = useState<ForceModel | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToModel(id, setModel);
    return unsubscribe; // cleanup, analogous to a destructor
  }, [id]);

  return model;
}
```

---

## Appendix B — TSDoc / JSDoc Commands

The analog of the C++ guide's Doxygen appendix. Common tags recognized by TypeScript editors and TypeDoc:

- `@param <name> <description>` — describes a function/component parameter (prop).
- `@returns <description>` — describes the return value.
- `@throws {ErrorType} <description>` — documents an error the function may throw.
- `@remarks <text>` — detailed notes following the brief line.
- `@example` — a usage example block.
- `@see <reference>` — a cross-reference to a related symbol.
- `@deprecated <reason>` — marks an API as deprecated; editors strike it through.
- `@defaultValue <value>` — documents a prop/parameter default.
- `@typeParam <T> <description>` — documents a generic type parameter.
- `@public` / `@internal` / `@beta` — release/visibility tags for API extractors.
- `@link <symbol>` — inline link to another documented symbol.
- `@packageDocumentation` — marks a module-level doc block.

```ts
/**
 * Computes days elapsed since 0h of the UTC reference Julian date.
 *
 * @param jdBias - offset between modified Julian days and Julian days
 * @returns A.1 modified Julian days
 * @see {@link toUtcDate}
 */
```

---

## References

1. _"C++ Style Guide,"_ Jun, L. & Shoan, W., GMAT Project, Code 583, NASA GSFC.
2. _"C Style Guide,"_ Doland, J. et al., SEL-94-003, NASA GSFC, August 1994.
3. Next.js Documentation — Project Structure & App Router conventions, nextjs.org.
4. React Documentation — Rules of Hooks, Server Components, react.dev.
5. TypeScript Handbook & TSDoc specification.
