import * as fs from 'fs';
import { TextDocument, Range, Position, CompletionItem } from "vscode-languageserver";
import Uri from 'vscode-uri';

import { flatten, ItemKind, sleep } from "./functions";
import { Token, testIn, tokenize } from "./grammar";
import { parseRules, parseIncludes } from './parse';

let externalCache = new Map<string, ExternalCacheEntry>();
let internalCache = new Map<string, CacheEntry>();

export function cache(uri: string, entry: CacheEntry) {
    internalCache.set(uri, entry);
}

export function remove(uri: string) {
    internalCache.delete(uri);
}

export async function getCached(uri: string): Promise<CacheEntry> {
    let cached: CacheEntry | undefined;
    while ((cached = getCachedSync(uri)) === undefined) {
        await sleep(200); // Delay loop to wait for the initial parsing
    }
    return cached;
}

export function getCachedSync(uri: string): CacheEntry | undefined {
    return internalCache.get(uri);
}

async function getExternalTextDocument(uri: string): Promise<ExternalCacheEntry | undefined> {
    let entry = externalCache.get(uri);
    if (entry) {
        return entry;
    }

    let path = Uri.parse(uri).fsPath;
    if (!fs.existsSync(path)) {
        return undefined;
    }
    let text = fs.readFileSync(path).toString();
    let doc = TextDocument.create(uri, "source.tatsu", 0, text);
    let cacheEntry = new ExternalCacheEntry(await tokenize(doc), doc);
    let tokens = cacheEntry.all();

    cacheEntry.rules = parseRules(tokens, uri);
    cacheEntry.includes = parseIncludes(tokens, uri);
    
    externalCache.set(uri, cacheEntry);

    return cacheEntry;
}

export async function getCachedExternal(uri: string): Promise<ExternalCacheEntry | undefined> {
    let entry: ExternalCacheEntry | undefined = getCachedSync(uri);
    if (entry) {
        return entry;
    }
    return getExternalTextDocument(uri);
}

export async function getDocument(uri: string): Promise<TextDocument | undefined> {
    let cached = internalCache.get(uri);
    if (cached) {
        if (externalCache.has(uri)) {
            externalCache.delete(uri);
        }
        return cached.document;
    }
    let doc = await getExternalTextDocument(uri);
    if (doc) {
        return doc.document;
    }
    return undefined;
}

export class LineInfo {
    ruleStack: string[];
	tokens: Token[];
	line: number;

	constructor(ruleStack: string[], tokens: Token[], line: number) {
		this.line = line;
        this.tokens = tokens;
        this.ruleStack = ruleStack;
	}

	getTokenAt(char: number): Token {
		let pos = Position.create(this.line, char);
		return this.tokens.filter(t => testIn(pos, t.range))[0];
	}

	filterByScope(str: string) {
		return this.tokens.filter(t => t.inScope(str));
	}
}

export class RuleInfo {
	name: string;
	item: CompletionItem;
	uri: string;
	range: Range;

	constructor(name: string, uri: string, range: Range) {
		this.name = name;
		this.item = ItemKind.rule(name);
		this.uri = uri;
		this.range = range;
    }
    
    startToken(): Range {
        return Range.create(this.range.start, 
            Position.create(this.range.start.line, this.range.start.character + this.name.length));
    }
}

export class ExternalCacheEntry {
	rules: RuleInfo[] = [];
    includes: string[] = [];
    lines: LineInfo[];
    document: TextDocument;

    constructor(lines: LineInfo[], document: TextDocument) {
		this.lines = lines;
		this.document = document;
    }
    
    getTokenAt(pos: Position): Token {
		return this.lines[pos.line].getTokenAt(pos.character);
	}

    all(): Token[] {
		return flatten(this.lines.map(v => v.tokens));
	}
}

export class CacheEntry extends ExternalCacheEntry {
	rules: RuleInfo[] = [];
	keywords: Set<string> = new Set();
	types: Map<string, CompletionItem> = new Map();
    includes: string[] = [];
    

    clear() {
        this.rules = [];  
        this.keywords = new Set();
        this.types = new Map();
        this.includes = [];
    }
}