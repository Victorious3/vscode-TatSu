import * as fs from 'fs';
import { TextDocument, Range, Position, CompletionItem } from "vscode-languageserver";
import { last, flatten } from "./functions";
import { documents } from "./tatsuServer";
import { Token, testIn, tokenize } from "./grammar";
import { ItemKind } from "./functions";
import { parseRules, parseIncludes } from './parse';
import Uri from 'vscode-uri';

let externalCache: Map<string, CachedTextDocument> = new Map();
let internalCache = new Map<string, CacheEntry>();

export function getCached(uri: string): CacheEntry | undefined {
    return internalCache.get(uri);
}

export function cache(uri: string, entry: CacheEntry) {
    internalCache.set(uri, entry);
}

async function getCachedTextDocument(uri: string): Promise<CachedTextDocument | undefined> {
    let entry = externalCache.get(uri);
    if (entry) {
        return entry;
    }

    let path = Uri.parse(uri).fsPath;
    if (!fs.existsSync(path)) {
        return undefined;
    }
    let text = fs.readFileSync(path).toString();
    let doc = new CachedTextDocument(uri, text);
    let tokens = flatten(await tokenize(doc));

    doc.rules = parseRules(tokens, uri);
    doc.includes = parseIncludes(tokens, uri);
    
    externalCache.set(uri, doc);
    return doc;
}

export async function getCachedExternal(uri: string): Promise<ExternalCacheEntry | undefined> {
    let entry: ExternalCacheEntry | undefined = getCached(uri);
    if (entry) {
        return entry;
    }
    return getCachedTextDocument(uri);
}

export async function getDocument(uri: string): Promise<TextDocument | undefined> {
    let doc = documents.get(uri);
    if (doc) {
        if (externalCache.has(uri)) {
            externalCache.delete(uri);
        }
        return doc;
    }
    return getCachedTextDocument(uri);
}

class CachedTextDocument implements TextDocument, ExternalCacheEntry {
    languageId = "source.tatsu";
    uri: string;
    version = 0;
    lineCount: number;

    content: string;
    charCount: number[];

    rules: RuleInfo[] = [];
    includes: string[] = [];

    constructor(uri: string, content: string) {
        this.uri = uri;
        this.content = content;
        this.charCount = this.content.split("\n").map(s => s.length);
        this.lineCount = this.charCount.length;
    }

    getText(range: Range): string {
        return this.content.substring(this.offsetAt(range.start), this.offsetAt(range.end));
    }

    positionAt(offset: number): Position {
        for (let i = 0; i < this.lineCount; i++) {
            if (offset < this.charCount[i]) {
                return Position.create(i, offset);
            }
            offset -= this.charCount[i];
        }
        return Position.create(this.lineCount, last(this.charCount));
    }

    offsetAt(position: Position): number { 
        let offset = 0;
        if (position.line >= this.lineCount) {
            return this.content.length - 1;
        }
        for (let i = 0; i < position.line; i++) {
            offset += this.charCount[i];
        }
        offset += position.character;
        return offset;
    }
}

export class LineInfo {
	tokens: Token[];
	comments: Range[] = [];
	line: number;

	constructor(tokens: Token[], line: number) {
		this.line = line;
		this.tokens = tokens;
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

export interface ExternalCacheEntry {
	rules: RuleInfo[];
    includes: string[];
    uri: string;
}

export class CacheEntry implements ExternalCacheEntry {
	rules: RuleInfo[] = [];
	keywords: Set<string> = new Set();
	types: Map<string, CompletionItem> = new Map();

	includes: string[] = [];
	lines: LineInfo[];
	uri: string;

	constructor(lines: LineInfo[], uri: string) {
		this.lines = lines;
		this.uri = uri;
	}

	getTokenAt(pos: Position): Token {
		return this.lines[pos.line].getTokenAt(pos.character);
	}

	all(): Token[] {
		return flatten(this.lines.map(v => v.tokens));
	}
}