/**
 * The part of OData the app sends to Microsoft Graph, for the demo's fake Graph: `$filter` (eq, ne, in, and, or, not,
 * startswith, endswith, contains), `$select`, `$expand` (with nested options), `$top` and `$search`. String comparisons
 * ignore case, as Graph does for directory properties.
 */

type Token =
    | { type: "string"; value: string }
    | { type: "number"; value: number }
    | { type: "word"; value: string }
    | { type: "("; value: string }
    | { type: ")"; value: string }
    | { type: ","; value: string };

function tokenize(input: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    while (i < input.length) {
        const c = input[i];
        if (/\s/.test(c)) { i++; continue; }
        if (c === "(" || c === ")" || c === ",") { tokens.push({ type: c, value: c }); i++; continue; }
        if (c === "'") {
            let value = "";
            i++;
            while (i < input.length) {
                if (input[i] === "'" && input[i + 1] === "'") { value += "'"; i += 2; continue; }
                if (input[i] === "'") break;
                value += input[i++];
            }
            if (i >= input.length) throw new Error(`Unterminated string in filter: ${input}`);
            i++;
            tokens.push({ type: "string", value });
            continue;
        }
        if (/[0-9-]/.test(c) && /^-?\d+(\.\d+)?(?![\w-])/.test(input.slice(i))) {
            const match = /^-?\d+(\.\d+)?/.exec(input.slice(i))!;
            tokens.push({ type: "number", value: Number(match[0]) });
            i += match[0].length;
            continue;
        }
        const match = /^[A-Za-z_$@][\w$@./:-]*/.exec(input.slice(i));
        if (!match) throw new Error(`Unexpected "${c}" in filter: ${input}`);
        tokens.push({ type: "word", value: match[0] });
        i += match[0].length;
    }
    return tokens;
}

export type Predicate = (item: Record<string, unknown>) => boolean;
type Literal = string | number | boolean | null;

function read(item: Record<string, unknown>, path: string): unknown {
    return path.split("/").reduce<unknown>((value, key) => (value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined), item);
}

function same(a: unknown, b: Literal): boolean {
    if (typeof a === "string" && typeof b === "string") return a.toLowerCase() === b.toLowerCase();
    if (b === null) return a === null || a === undefined;
    return a === b;
}

function compare(a: unknown, b: Literal): number | null {
    if (typeof a === "number" && typeof b === "number") return a - b;
    if (typeof a === "string" && typeof b === "string") return a.localeCompare(b);
    return null;
}

/** Parses a `$filter` expression into a predicate; throws on anything it does not understand, as Graph answers 400 */
export function parseFilter(filter: string): Predicate {
    const tokens = tokenize(filter);
    let pos = 0;
    const peek = () => tokens[pos];
    const next = () => tokens[pos++];
    const isWord = (word: string) => { const t = peek(); return t?.type === "word" && t.value.toLowerCase() === word; };
    const expect = (type: Token["type"]) => {
        const token = next();
        if (!token || token.type !== type) throw new Error(`Expected ${type} in filter: ${filter}`);
        return token;
    };
    const word = (): string => String(expect("word").value);
    const literal = (): Literal => {
        const token = next();
        if (!token) throw new Error(`Missing value in filter: ${filter}`);
        if (token.type === "string" || token.type === "number") return token.value;
        if (token.type === "word") {
            const value = token.value.toLowerCase();
            if (value === "true") return true;
            if (value === "false") return false;
            if (value === "null") return null;
        }
        throw new Error(`Unsupported value "${token.value}" in filter: ${filter}`);
    };

    const orExpr = (): Predicate => {
        let left = andExpr();
        while (isWord("or")) {
            next();
            const l = left, r = andExpr();
            left = (item) => l(item) || r(item);
        }
        return left;
    };
    const andExpr = (): Predicate => {
        let left = unary();
        while (isWord("and")) {
            next();
            const l = left, r = unary();
            left = (item) => l(item) && r(item);
        }
        return left;
    };
    const unary = (): Predicate => {
        if (isWord("not")) {
            next();
            const inner = unary();
            return (item) => !inner(item);
        }
        return primary();
    };
    const primary = (): Predicate => {
        if (peek()?.type === "(") {
            next();
            const inner = orExpr();
            expect(")");
            return inner;
        }
        const head = word();
        const fn = head.toLowerCase();
        if ((fn === "startswith" || fn === "endswith" || fn === "contains") && peek()?.type === "(") {
            next();
            const prop = word();
            expect(",");
            const value = String(literal()).toLowerCase();
            expect(")");
            return (item) => {
                const actual = read(item, prop);
                if (typeof actual !== "string") return false;
                const text = actual.toLowerCase();
                return fn === "startswith" ? text.startsWith(value) : fn === "endswith" ? text.endsWith(value) : text.includes(value);
            };
        }
        const op = word().toLowerCase();
        if (op === "in") {
            expect("(");
            const values: Literal[] = [literal()];
            while (peek()?.type === ",") { next(); values.push(literal()); }
            expect(")");
            return (item) => values.some((v) => same(read(item, head), v));
        }
        const value = literal();
        switch (op) {
            case "eq": return (item) => same(read(item, head), value);
            case "ne": return (item) => !same(read(item, head), value);
            case "gt": return (item) => (compare(read(item, head), value) ?? -1) > 0;
            case "ge": return (item) => (compare(read(item, head), value) ?? -1) >= 0;
            case "lt": return (item) => (compare(read(item, head), value) ?? 1) < 0;
            case "le": return (item) => (compare(read(item, head), value) ?? 1) <= 0;
            default: throw new Error(`Unsupported operator "${op}" in filter: ${filter}`);
        }
    };

    const predicate = orExpr();
    if (pos < tokens.length) throw new Error(`Unexpected "${tokens[pos].value}" in filter: ${filter}`);
    return predicate;
}

/** `$expand=a,b($expand=c)` as `{ a: "", b: "$expand=c" }` */
export function parseExpand(expand: string | null): Record<string, string> {
    const result: Record<string, string> = {};
    if (!expand) return result;
    let depth = 0, start = 0;
    const push = (part: string) => {
        const trimmed = part.trim();
        if (!trimmed) return;
        const open = trimmed.indexOf("(");
        if (open === -1) result[trimmed] = "";
        else result[trimmed.slice(0, open)] = trimmed.slice(open + 1, trimmed.lastIndexOf(")"));
    };
    for (let i = 0; i < expand.length; i++) {
        if (expand[i] === "(") depth++;
        else if (expand[i] === ")") depth--;
        else if (expand[i] === "," && depth === 0) { push(expand.slice(start, i)); start = i + 1; }
    }
    push(expand.slice(start));
    return result;
}

/**
 * Keeps the selected properties plus `id`, `@odata.type` and the expanded navigation properties (Graph returns an
 * expanded `principal` next to a `$select`); no `$select` keeps everything
 */
export function applySelect<T extends Record<string, unknown>>(item: T, select: string | null, expanded: Iterable<string> = []): Record<string, unknown> {
    if (!select) return item;
    const keep = new Set([...select.split(",").map((s) => s.trim()).filter(Boolean), ...expanded]);
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item)) {
        if (key === "id" || key === "@odata.type" || keep.has(key)) result[key] = value;
    }
    return result;
}

/** `$search="displayName:adele" OR "userPrincipalName:adele"`: a clause matches when a word of the property starts with the term */
export function parseSearch(search: string): Predicate {
    const clauses = [...search.matchAll(/"([^":]+):([^"]*)"/g)].map((m) => ({ prop: m[1], term: m[2].toLowerCase() }));
    if (clauses.length === 0) throw new Error(`Unsupported search: ${search}`);
    return (item) => clauses.some(({ prop, term }) => {
        const value = read(item, prop);
        if (typeof value !== "string") return false;
        const text = value.toLowerCase();
        return text.startsWith(term) || text.split(/[^a-z0-9]+/).some((word) => word.startsWith(term));
    });
}
