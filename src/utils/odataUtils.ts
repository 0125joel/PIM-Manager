/**
 * OData query helpers.
 *
 * Single-quotes in OData string literals must be escaped by doubling them.
 * Without this, values like `o'connor@contoso.com` break the filter expression
 * and at worst allow filter injection from untrusted input.
 */
export function escapeODataString(value: string): string {
    return value.replace(/'/g, "''");
}
