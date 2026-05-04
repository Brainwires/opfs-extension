// Quoting strategy for dynamic SQL identifiers (table/column names).
//
// rsqlite-wasm has a planner bug where `name.to_string()` on a sqlparser
// ObjectName preserves the AST's quote_style, so `FROM "messages"` is looked
// up in the catalog literally as `"messages"` (with the quote characters as
// part of the key) and fails with `table not found: "messages"`. The same
// idiom in standard SQLite / sql.js works fine.
//
// Workaround: quote only when strictly necessary. Plain alphanumeric+underscore
// identifiers go in unquoted, which both engines accept. Reserved keywords
// and names containing odd characters still get quoted — those would fail to
// parse anyway as bare identifiers.

const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

const SQLITE_KEYWORDS = new Set([
  'abort', 'action', 'add', 'after', 'all', 'alter', 'always', 'analyze',
  'and', 'as', 'asc', 'attach', 'autoincrement', 'before', 'begin', 'between',
  'by', 'cascade', 'case', 'cast', 'check', 'collate', 'column', 'commit',
  'conflict', 'constraint', 'create', 'cross', 'current', 'current_date',
  'current_time', 'current_timestamp', 'database', 'default', 'deferrable',
  'deferred', 'delete', 'desc', 'detach', 'distinct', 'do', 'drop', 'each',
  'else', 'end', 'escape', 'except', 'exclude', 'exclusive', 'exists',
  'explain', 'fail', 'filter', 'first', 'following', 'for', 'foreign',
  'from', 'full', 'generated', 'glob', 'group', 'groups', 'having', 'if',
  'ignore', 'immediate', 'in', 'index', 'indexed', 'initially', 'inner',
  'insert', 'instead', 'intersect', 'into', 'is', 'isnull', 'join', 'key',
  'last', 'left', 'like', 'limit', 'match', 'materialized', 'natural', 'no',
  'not', 'nothing', 'notnull', 'null', 'nulls', 'of', 'offset', 'on', 'or',
  'order', 'others', 'outer', 'over', 'partition', 'plan', 'pragma',
  'preceding', 'primary', 'query', 'raise', 'range', 'recursive',
  'references', 'regexp', 'reindex', 'release', 'rename', 'replace',
  'restrict', 'returning', 'right', 'rollback', 'row', 'rows', 'savepoint',
  'select', 'set', 'table', 'temp', 'temporary', 'then', 'ties', 'to',
  'transaction', 'trigger', 'unbounded', 'union', 'unique', 'update',
  'using', 'vacuum', 'values', 'view', 'virtual', 'when', 'where', 'window',
  'with', 'without',
]);

export function qident(name: string): string {
  if (SAFE_IDENT.test(name) && !SQLITE_KEYWORDS.has(name.toLowerCase())) return name;
  return `"${name.replace(/"/g, '""')}"`;
}
