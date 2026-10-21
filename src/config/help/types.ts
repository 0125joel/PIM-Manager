export type HelpPageId = "dashboard" | "report" | "configure" | "settings";

export interface HelpBlock {
    title: string;
    text: string;
}

export interface HelpTerm {
    term: string;
    text: string;
}

export interface GuideSection {
    title: string;
    paragraphs?: string[];
    items?: { label: string; text: string }[];
}

/** One page of help: what the panel shows (intro, blocks, terms) and what the full guide adds (guide). */
export interface HelpPage {
    id: HelpPageId;
    title: string;
    intro: string;
    blocks: HelpBlock[];
    terms: HelpTerm[];
    guide: GuideSection[];
}
