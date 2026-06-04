# Dark Mode

A user-toggleable dark theme for the side panel. The user presses a toggle in the
side-panel header; the panel switches to a dark palette and shows a "Dark" indicator
pill. The choice persists across reloads.

## How it works

Dark mode is **class-based and additive**. Light mode is the default and is left
completely untouched — when the `dark` class is absent, none of the dark rules apply,
so the production light theme is byte-identical to before.

### 1. The toggle and state

- The setting lives in the persisted settings store (`src/stores/settings-store.ts`),
  field `theme: 'light' | 'dark' | 'system'` (default `'system'`), persisted to
  `chrome.storage.local` under `devassist-settings`.
- `src/hooks/useTheme.ts` resolves the setting to a concrete light/dark decision,
  reflects it onto `<html>` by toggling the `dark` class, and (when `theme === 'system'`)
  live-follows the OS `prefers-color-scheme`. It exposes `{ isDark, toggle }`.
- `src/sidepanel/SidePanel.tsx` wires the header: a moon/sun toggle button and a
  "Dark" indicator pill shown only when `isDark`.

> Each Chrome extension context has its own `document`. Toggling `dark` on the side
> panel's `<html>` affects only the side panel — not the popup or content script.

### 2. The styling (`src/index.css`)

Two layers of override, both keyed off the `dark` class:

1. **Semantic CSS variables** — the `.dark { ... }` block redefines the `@theme`
   color tokens (`--color-background`, `--color-card`, `--color-foreground`,
   `--color-border`, `--color-muted-foreground`, etc.). Anything using token-based
   utilities (`bg-card`, `text-foreground`, `border-border`, …) flips automatically.

2. **Literal utility overrides** — the UI mixes brand hex literals (e.g.
   `bg-white`, `text-[#333333]`, `text-[#1B1F6B]`) with tokens. A set of
   `.dark .<class> { ... }` rules remap those specific literals. These are written
   **unlayered**, so they beat Tailwind's `utilities` layer without `!important`.

Tailwind v4 class-based `dark:` variants are enabled with:

```css
@custom-variant dark (&:where(.dark, .dark *));
```

This makes `dark:` utilities respond to the `.dark` ancestor class instead of the
default `prefers-color-scheme` media query.

### 3. The logo

The Simple.Biz logo is a single dark PNG. In dark mode it's recolored to white in CSS
rather than shipping a second asset:

```tsx
<img ... className="h-11 dark:brightness-0 dark:invert" />
```

`brightness(0)` flattens the PNG to a black silhouette; `invert(100%)` flips that
silhouette to white.

## Design notes

- **Why additive, not a token migration?** Converting ~250 literal color sites to
  tokens risked regressing the live light theme. Overriding only the literals that
  must invert is lower-risk and leaves light mode untouched.
- **Brand navy on dark.** `#1B1F6B` (and low-opacity navy tints) are nearly invisible
  on a dark background, so they're remapped to a light periwinkle (`#9aa1ff`) for
  readability.

## Files

| File | Role |
| --- | --- |
| `src/hooks/useTheme.ts` | Resolves theme, toggles `dark` class, follows system pref |
| `src/index.css` | `@custom-variant dark`, `.dark` token block, literal overrides |
| `src/sidepanel/SidePanel.tsx` | Header toggle button + "Dark" indicator pill, logo recolor |
| `src/stores/settings-store.ts` | Persisted `theme` setting (`setTheme`) |

## Releasing

This is an **extension/frontend** change, so reaching agents requires bumping
`version` in `package.json` and publishing to the Chrome Web Store (unlike backend
coaching changes, which ship via CDK only). See CLAUDE.md → Deployment.
