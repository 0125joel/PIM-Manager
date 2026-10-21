"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@/components/icons/Icon";
import { Button } from "@/components/ui/Button";
import type { EmergencyProps } from "./settingsTypes";
import { SettingsSection } from "./SettingsSection";

export function EmergencyAccountsSection({ tenantLabel, accounts, search, status, onAdd, onRemove, onExport, onImportFile }: EmergencyProps) {
    const [activeIndex, setActiveIndex] = useState(-1);
    const [isListClosed, setIsListClosed] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);
    const hasTerm = search.term.trim().length >= search.minLength;
    const isListOpen = hasTerm && !isListClosed && search.results.length > 0;

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            setIsListClosed(false);
            setActiveIndex((i) => (search.results.length === 0 ? -1 : (i + 1) % search.results.length));
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((i) => (search.results.length === 0 ? -1 : (i - 1 + search.results.length) % search.results.length));
        } else if (event.key === "Enter" && isListOpen && activeIndex >= 0) {
            event.preventDefault();
            onAdd(search.results[activeIndex]);
            setActiveIndex(-1);
        } else if (event.key === "Escape" && isListOpen) {
            event.stopPropagation();
            setIsListClosed(true);
        }
    };

    const resultsText = !hasTerm
        ? ""
        : search.error
          ? "The search failed."
          : search.isSearching
            ? "Searching"
            : `${search.results.length} ${search.results.length === 1 ? "user" : "users"} found`;

    return (
        <SettingsSection
            id="emergency"
            title="Emergency access accounts"
            subline={`Marked accounts are labelled everywhere and counted apart, never left out. Stored in this browser${tenantLabel ? ` for tenant ${tenantLabel}` : ""}; clearing site data removes the list, export keeps a copy.`}
        >
            {accounts.length === 0 ? (
                <p className="text-[13px] text-muted">No accounts marked yet.</p>
            ) : (
                <ul>
                    {accounts.map((account) => (
                        <li key={account.id} className="flex items-center gap-3 border-t border-line py-3 first:border-t-0">
                            <Icon name="emergency-access" size={20} className="shrink-0 text-ink" />
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm leading-5 font-semibold text-ink">{account.displayName}</p>
                                <p className="truncate font-mono text-xs text-muted">{account.userPrincipalName}</p>
                            </div>
                            <Button iconOnly icon="close" label={`Remove ${account.displayName}`} variant="secondary" className="border-transparent" onClick={() => onRemove(account)} />
                        </li>
                    ))}
                </ul>
            )}

            <div className="mt-4 flex flex-wrap items-start gap-3 border-t border-line pt-4">
                <div className="relative min-w-[220px] flex-1">
                    <label htmlFor="emergency-search" className="sr-only">Find a user to mark</label>
                    <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input
                        id="emergency-search"
                        role="combobox"
                        aria-expanded={isListOpen}
                        aria-controls="emergency-search-results"
                        aria-activedescendant={isListOpen && activeIndex >= 0 ? `emergency-option-${activeIndex}` : undefined}
                        aria-autocomplete="list"
                        autoComplete="off"
                        placeholder="Find a user to mark"
                        value={search.term}
                        onChange={(event) => {
                            search.setTerm(event.target.value);
                            setActiveIndex(-1);
                            setIsListClosed(false);
                        }}
                        onKeyDown={handleKeyDown}
                        className="h-[34px] w-full rounded-md border border-line bg-surface pl-9 pr-3 text-[13px] text-ink placeholder:text-muted max-sm:h-11"
                    />
                    {isListOpen && (
                        <ul id="emergency-search-results" role="listbox" aria-label="Users found" className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-[10px] border border-line bg-surface p-1 shadow-menu">
                            {search.results.map((user, index) => (
                                <li
                                    key={user.id}
                                    id={`emergency-option-${index}`}
                                    role="option"
                                    aria-selected={index === activeIndex}
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => onAdd(user)}
                                    className={`cursor-pointer rounded-md px-3 py-2 max-sm:min-h-11 ${index === activeIndex ? "bg-page" : "hover:bg-page"}`}
                                >
                                    <p className="text-[13px] leading-[18px] font-medium text-ink">{user.displayName}</p>
                                    <p className="font-mono text-xs text-muted">{user.userPrincipalName}</p>
                                </li>
                            ))}
                        </ul>
                    )}
                    <p role="status" className="sr-only">{resultsText}</p>
                    {hasTerm && search.error && <p className="mt-1 text-xs text-danger-text">{search.error}</p>}
                    {hasTerm && !search.isSearching && !search.error && search.results.length === 0 && <p className="mt-1 text-xs text-muted">No users found that are not already marked.</p>}
                    {!hasTerm && search.term.trim().length > 0 && <p className="mt-1 text-xs text-muted">Type at least {search.minLength} characters.</p>}
                </div>
                <Button onClick={onExport} disabled={accounts.length === 0}>Export list</Button>
                <Button onClick={() => fileInput.current?.click()}>Import list</Button>
                <input
                    ref={fileInput}
                    type="file"
                    accept="application/json,.json"
                    className="sr-only"
                    tabIndex={-1}
                    aria-label="Import emergency access accounts from a JSON file"
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) onImportFile(file);
                    }}
                />
            </div>
            <div role="status" className="mt-3 min-h-5">
                {status && <p className={`text-[13px] ${status.kind === "error" ? "text-danger-text" : "text-success-text"}`}>{status.text}</p>}
            </div>
        </SettingsSection>
    );
}
