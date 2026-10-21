import type { ImportKind } from "@/utils/importDetect";
import type { PrincipalIndex, RowFilter } from "@/utils/importAssignments";

/**
 * The state of the Import view (spec 7): lives in `ConfigureView`, so the review and "Back to changes" keep the file
 * and the admin's ticks. The file itself is its text; everything else is derived from it on every render.
 */
export interface ImportSession {
    /** One per chosen file: a look-up is asked once per file, and again when the same file is chosen again */
    id: number;
    fileName: string;
    text: string;
    /** "Not right? Read it as": the admin's own choice, else the detection */
    chosenKind: ImportKind | null;
    /** Lines the admin unticked (assignment files) */
    unchecked: number[];
    /** The values the admin unticked (settings and access model files), by the key of the row */
    uncheckedKeys: string[];
    filter: RowFilter;
    /** The ids of the changes the last "Review" put in the basket: the next press replaces them */
    addedIds: string[];
    /** People Graph was asked for, merged over the loaded ones */
    lookups: PrincipalIndex | null;
    /** Administrative unit id (lower case) to name, read when a row names a unit */
    units: ReadonlyMap<string, string> | null;
}

let counter = 0;
export const newImportSession = (fileName: string, text: string): ImportSession => ({
    id: ++counter, fileName, text, chosenKind: null, unchecked: [], uncheckedKeys: [], filter: "all", addedIds: [], lookups: null, units: null,
});

/** What the page hands the Import view besides the tenant data: Graph reads and the bundled examples (the fixture passes its own) */
export interface ImportIo {
    lookupPrincipals: (query: { ids: string[]; upns: string[] }) => Promise<PrincipalIndex>;
    loadExample: (fileName: string) => Promise<string>;
}

/** The examples of "Or try an example"; the files are in `public/examples` */
export const IMPORT_EXAMPLES: ReadonlyArray<{ file: string }> = [
    { file: "pim-bulk-role-assignments.csv" },
    { file: "pim-bulk-group-assignments.csv" },
    { file: "pim-bulk-role-policies.csv" },
    { file: "pim-bulk-group-policies.csv" },
    { file: "pim-access-model.json" },
];
