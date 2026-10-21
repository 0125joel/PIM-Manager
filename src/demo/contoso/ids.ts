/**
 * Stable ids for the demo tenant. Every object gets a GUID that looks like a real one but is derived from a fixed
 * seed (FNV-1a), so the tenant is the same on every load and in every test.
 */
function fnv1a(input: string, seed: number): number {
    let hash = 0x811c9dc5 ^ seed;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

/** A version 4 shaped GUID for `seed`. */
export function demoGuid(seed: string): string {
    const hex = [0, 1, 2, 3].map((i) => fnv1a(seed, i * 0x9e3779b1).toString(16).padStart(8, "0")).join("");
    const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** The demo tenant's id: also the tenant id of the demo account and the emergency account storage key. */
export const CONTOSO_TENANT_ID = demoGuid("contoso-tenant");
