import { DEMO_STORAGE_PREFIX, nativeStorage } from "./session";

/**
 * Gives the demo its own storage, so it never sees or changes what the real app keeps in the same browser (the session
 * cache of a real tenant, consent flags, emergency accounts, preferences). Both localStorage and sessionStorage of a demo
 * tab are kept in the tab's real sessionStorage under `pim-demo:`, so the demo forgets everything when the tab closes or
 * on "Exit demo". The theme is shared with the real app.
 *
 * It patches `Storage.prototype` for this page only: a demo tab never navigates to the real app without a full page
 * load (`exitDemo`), and a full load starts without the patch.
 */

const LOCAL = `${DEMO_STORAGE_PREFIX}local:`;
const SESSION = `${DEMO_STORAGE_PREFIX}session:`;
/** Keys the demo shares with the real app */
const SHARED_KEYS = new Set(["theme", "LOG_LEVEL"]);

let installed = false;

export function installDemoStorage(seedLocal: Record<string, string>): void {
    if (installed || typeof window === "undefined") return;
    const { getItem, setItem, removeItem, key, length } = nativeStorage;
    if (!getItem || !setItem || !removeItem || !key || !length) return;
    installed = true;

    const backing = window.sessionStorage;
    const prefixOf = (storage: Storage) => (storage === window.localStorage ? LOCAL : SESSION);
    const ownKeys = (prefix: string): string[] => {
        const keys: string[] = [];
        const count = length.call(backing) as number;
        for (let i = 0; i < count; i++) {
            const k = key.call(backing, i);
            if (k?.startsWith(prefix)) keys.push(k.slice(prefix.length));
        }
        return keys;
    };

    for (const [k, value] of Object.entries(seedLocal)) {
        if (getItem.call(backing, `${LOCAL}${k}`) === null) setItem.call(backing, `${LOCAL}${k}`, value);
    }

    Storage.prototype.getItem = function (this: Storage, k: string) {
        return SHARED_KEYS.has(k) ? getItem.call(this, k) : getItem.call(backing, `${prefixOf(this)}${k}`);
    };
    Storage.prototype.setItem = function (this: Storage, k: string, value: string) {
        if (SHARED_KEYS.has(k)) setItem.call(this, k, value);
        else setItem.call(backing, `${prefixOf(this)}${k}`, value);
    };
    Storage.prototype.removeItem = function (this: Storage, k: string) {
        if (SHARED_KEYS.has(k)) removeItem.call(this, k);
        else removeItem.call(backing, `${prefixOf(this)}${k}`);
    };
    Storage.prototype.clear = function (this: Storage) {
        const prefix = prefixOf(this);
        for (const k of ownKeys(prefix)) removeItem.call(backing, `${prefix}${k}`);
    };
    Storage.prototype.key = function (this: Storage, index: number) {
        return ownKeys(prefixOf(this))[index] ?? null;
    };
    Object.defineProperty(Storage.prototype, "length", {
        configurable: true,
        get(this: Storage) {
            return ownKeys(prefixOf(this)).length;
        },
    });
}
