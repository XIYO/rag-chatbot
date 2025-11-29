# Repository Guidelines

## Project Structure & Module Organization
- `src/routes` holds SvelteKit pages plus remote function handlers (`*.remote.ts`) for chat, embeddings, and file uploads; `layout.css` carries shared Tailwind styles.
- `src/lib/server` contains chat/file/embedding services and Supabase/LangChain integration; `src/lib/client` has browser helpers (for example, upload hashing); `src/lib/assets` stores shared SVGs.
- `supabase/` tracks config and migrations; apply SQL changes there. `static/` serves public assets.
- Tests live in `tests/` (helpers/scripts) and `e2e/` (Playwright specs). Build output lands in `build/`.

## Build, Test, and Development Commands
- `npm run dev` — start the SvelteKit dev server (Vite).
- `npm run check` — SvelteKit sync + type checks; run before commits.
- `npm run lint` — Prettier check then ESLint (TS + Svelte rules).
- `npm run format` — auto-format via Prettier (Tailwind plugin enabled).
- `npm run test:unit` — Vitest suite; `npm run test:e2e` — Playwright; `npm test` runs both (unit with `--run`).
- `npm run build` — production bundle; `npm run preview` — serve built app.

## Coding Style & Naming Conventions
- TypeScript + Svelte 5; keep UI lean and push business logic into `src/lib/server`.
- Prettier: tabs for indent, single quotes, width 100, no trailing commas; Tailwind classes auto-sorted.
- ESLint extends TS/Svelte recommended sets; `no-undef` is off for TS. Keep imports typed and tidy.
- Components use PascalCase filenames (`Component.svelte`); utilities camelCase; tests mirror targets with `*.spec.ts` or `*.test.ts`.

## Testing Guidelines
- Use Vitest for unit/logic in `src/**/?*.spec.ts`; Playwright for end-to-end flows in `e2e/`.
- Add lean fixtures; mock Supabase/LLM clients instead of hitting real services. Avoid flaky timing-based assertions.
- Run `npm test` before PRs; include any failing repro or new cases in the MR description.

## Commit & Pull Request Guidelines
- Prefer Conventional Commits as seen in history (`feat: ...`, `fix: ...`, `chore: ...`); keep scopes short.
- PRs should list a concise summary, linked issues, screenshots for UI changes, and a test plan (`npm run check`, `npm test`, plus any manual steps).
- Keep changesets focused; call out schema or Supabase updates and attach the relevant migration SQL.

## Environment & Data
- Store secrets in `.env` (Supabase keys, LLM API keys); never commit them. Align local settings with `supabase/config.toml` and migrations under `supabase/migrations/`.
- For file uploads/RAG ingestion, keep hashed duplicate checks intact (`src/lib/client/hash.ts`); avoid PII in test fixtures and Playwright uploads.
