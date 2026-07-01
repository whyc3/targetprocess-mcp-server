# Targetprocess Search Spec Notes

Scope: search-related behavior verified from Targetprocess / IBM docs and current repo behavior.

## 1. Search model

- No dedicated REST search endpoint confirmed from docs reviewed.
- Documented search pattern is entity collection querying with filters.
- v1 shape: `/api/v1/{Entities}?where=...&include=...&take=...&skip=...`
- v2 shape: `/api/v2/{entity}?where=...&select=...&take=...&skip=...&orderBy=...&filter=...`
- Closest thing to cross-entity search in v1 is `Generals`.

## 2. v1 search/filter behavior

Supported operators relevant to search:
- `eq`
- `ne`
- `gt`
- `gte`
- `lt`
- `lte`
- `in`
- `contains`
- `not contains`
- `is null`
- `is not null`

Known limitations:
- `or` not supported.
- `not in` not supported.
- Calculated custom fields cannot be filtered.
- Single quotes inside values must be escaped.

Typical text search examples:
- `Name contains 'Text Element'`
- `Description contains 'Font field'`
- `EntityState.Name eq 'Done'`
- `Project.Id eq 12345`
- `Owner.Id eq 67890`

Nested fields are supported in `where`.

## 3. Entity scope

Entity-specific search can target collections such as:
- `UserStories`
- `Bugs`
- `Features`
- other entity collections if they expose searched fields

Cross-entity scope:
- `Generals` covers many resource types and is best documented cross-entity option.

## 4. Pagination

- Default first page is 25 items.
- Use `take` and `skip`.
- Max `take` documented as 1000.
- Response contains `Items` and paging links such as `Next` / `Prev`.

Implication for MCP:
- Search tool should expose `take` and `skip`.
- Search tool should preserve paging metadata or at least enough info for next-page calls.

## 5. Response shaping

v1:
- Use `include=[FieldA, FieldB, Nested.Field]` for partial payloads.
- Nested includes supported.
- `innerTake` may be needed for nested collections.

v2:
- Use `select={...}` for rich projections.
- Supports nested projections, renaming, filtered nested collections, aggregations.
- `result=` can produce root aggregations.

Implication for MCP:
- Search result payload should be explicitly projected rather than returning arbitrary entity payloads.

## 6. Sorting

v1:
- `orderBy=Field`
- `orderByDesc=Field`
- Only one sort criterion documented.

v2:
- Multi-sort supported, e.g. `orderBy=effort desc,name`.

Implication for MCP:
- If strict v1 compatibility is enough, one sort field is sufficient.
- If richer sorting is needed, add a v2-backed path.

## 7. Useful filters for search tool

Documented filters that fit search use cases:
- state: `EntityState.Name`, `EntityState.IsFinal`
- project: `Project.Id`
- owner: `Owner.Id`
- release / iteration: `Release.Id`, `Release.IsCurrent`, `Iteration.IsCurrent`
- dates: `CreateDate`, `ModifyDate`, `LastCommentDate`, `EndDate`
- tags with wildcard caveats

Team filtering note:
- docs emphasize team assignments for some assignable entities rather than direct team field usage.

## 8. Current repo deviations from spec-friendly behavior

Current implementation:
- `src/index.ts` registers `search_tp_cards`
- `src/tp.ts` does `Name contains ...`
- `src/tp.ts` does `Description contains ... and EntityState.Name eq 'Done'`

Main mismatches:
- hardcoded `Done` filter excludes active cards
- no `take` / `skip` inputs
- no escaped quotes
- no sort options
- no structured filter inputs
- no `Features` exposure in tool schema
- no paging metadata in response
- no documented support for broader `Generals` search behavior

## 9. Recommended compatibility target

Minimum spec-aligned MCP search should support:
- explicit entity scope, including `Generals`
- explicit fields to search, at least `Name` and `Description`
- structured filters for state / project / owner / dates
- `take` / `skip`
- sort selection
- deduped results with entity type metadata
- safe escaping for string values in `where`

Optional advanced target:
- v2-backed projection path for normalized output and richer sorting
- compatibility wrapper that preserves legacy `search_tp_cards`
