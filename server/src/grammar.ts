import * as fs from 'fs';
import { Range, Diagnostic, DiagnosticSeverity, TextDocument, Position} from 'vscode-languageserver';
import { removeAll, takeWhile, last, sleep } from './functions';
import { vscode_root } from './tatsuServer';
import { LineInfo, ExternalCacheEntry } from './cache';
let equal = require('array-equal');

/**
 * Returns a node module installed with VSCode
 */
let first = true;
async function getCoreNodeModule(moduleName: string) {
    if (first) {
        let tries = 0;
        while (!vscode_root && tries++ < 5) {
            await sleep(200);
        }
        if (!vscode_root) {
            throw new Error("vscode path not set, aborting!");
        }

        let addPath = require("app-module-path").addPath;
        addPath(`${vscode_root}/node_modules.asar/`);
        addPath(`${vscode_root}/node_modules/`);
        first = false;
    }
    
    return require(moduleName);
}

const grammarPath = __dirname+"/../../syntaxes/tatsu.tmLanguage.json";

let grammar: any;
async function getGrammar() {
    if (grammar) {
        return grammar;
    }

    let tm = await getCoreNodeModule('vscode-textmate');
    let registry = new tm.Registry();
    let g = fs.readFileSync(grammarPath).toString();
    grammar = await registry.addGrammar(tm.parseRawGrammar(g, grammarPath));
    return grammar;
}

export function testIn(pos: Position, range: Range): boolean {
	return pos.line >= range.start.line && pos.line <= range.end.line &&
		pos.character >= range.start.character && pos.character <= range.end.character;
}

export class Token {
    scopes: string[];
    range: Range;
    document: TextDocument;

    static create(token: any, line: number, document: TextDocument) {
        return new Token(token.scopes,
            Range.create(line, token.startIndex, line, token.endIndex), document);
    }

    constructor(scopes: string[], range: Range, document: TextDocument) {
        this.scopes = scopes;
        this.document = document;
        this.range = range;
    }

    inScope(str: string): boolean {
        for (let scope of this.scopes) {
            if (scope.indexOf(str) !== -1) {
                return true;
            }
        }
        return false;
    }

    text(): string {
        return this.document.getText(this.range);
    }

    isWhitespace(): boolean {
        let text = this.text();
        return text.match("\\s*")![0].length === text.length;
    }

    isLiteral(): boolean {
        return this.inScope("constant") || this.inScope("string");
    }
    
    isPunctuation(): boolean {
        return this.inScope("punctuation");
    }
}

export enum ValueType {
    CONSTANT, RAW_STRING, STRING, NUMBER
}

export class Value {
    type: ValueType;
    value: string;
    range: Range;
    
    constructor(type: ValueType, value: string, range: Range) {
        this.type = type; this.value = value; this.range = range;
    }
}

export async function tokenize(document: TextDocument): Promise<LineInfo[]> {
    let grammar = await getGrammar();

    let ruleStack: any;
    let lines: LineInfo[] = [];
    for (let i = 0; i < document.lineCount; i++) {
        let line = document.getText(Range.create(i, 0, i + 1, 0));
        let r = grammar.tokenizeLine(line, ruleStack!);
	    lines.push(new LineInfo(ruleStack, r.tokens.map((v: any) => Token.create(v, i, document)), i));
	    ruleStack = r.ruleStack;
    }
    return lines;
}

export async function reTokenize(range: Range, lines: number, entry: ExternalCacheEntry) {
    let grammar = await getGrammar();
    let doc = entry.document;

    function reTokenizeLine(i: number) {
        let line = doc.getText(Range.create(i, 0, i + 1, 0));
        let r = grammar.tokenizeLine(line, ruleStack!);
        let li = new LineInfo(ruleStack, r.tokens.map((v: any) => Token.create(v, i, doc)), i);
        ruleStack = r.ruleStack;
        return li;
    }

    // Remove affected lines
    entry.lines.splice(range.start.line, range.end.line - range.start.line + 1);

    let firstLine = entry.lines[range.start.line - 1];
    let ruleStack: any = firstLine ? firstLine.ruleStack : undefined;

    let i = range.start.line;
    for (;i <= range.start.line + lines; i++) {
        entry.lines.splice(i, 0, reTokenizeLine(i));
    }

    // From here on we update all lines until the rule stack doesn't change anymore
    while (i < doc.lineCount) {
        let line = entry.lines[i - 1];
        if (line && equal(line.ruleStack, ruleStack)) { // and end up in the same state again
            break; // we can stop parsing
        }

        entry.lines[i] = reTokenizeLine(i);
        i++; // next line
    }
}

export function rangeOver(tokens: Token[]): Range {
    return Range.create(tokens[0].range.start, last(tokens).range.end);
}

export function takeValues(tokens: Token[], diagnostics: Diagnostic[]): Value[] {
    let result: Value[] = [];
    let arg: Value | null;
    while ((arg = takeValue(tokens, diagnostics)) !== null) {
        result.push(arg);
    }
    return result;
}

export function takeValue(tokens: Token[], diagnostics: Diagnostic[]): Value | null {
    takeWhile(tokens, t => t.isWhitespace());
    if (tokens.length === 0 || !tokens[0].isLiteral()) { return null; }
    let first = tokens.splice(0, 1)[0];
    let value: Value;

    if (first.inScope("string.unquoted")) {
        value = new Value(ValueType.RAW_STRING, first.text(), first.range);
    } else if (first.inScope("constant.other")) {
        value = takeValue(tokens, diagnostics)!;
        value.type = ValueType.CONSTANT;
        value.range.start = first.range.start;
        if (tokens.length > 0) {
            value.range.end = tokens.splice(0, 1)[0].range.end;
        }
    } else if (first.inScope("string")) {
        let content = takeWhile(tokens, v => !v.inScope("end"));
        let text = content.map(v => v.text()).reduce((first, next) => first + next, "");
        let next = tokens.splice(0, 1)[0];
        value = new Value(
            ValueType.STRING, text, 
            Range.create(first.range.start, 
                next ? next.range.end : 
                content.length > 0 ? last(content).range.end : 
                first.range.end));
    } else {
        value = new Value(ValueType.NUMBER, first.text(), first.range);
    }

    if (value.range.end.line > value.range.start.line) {
        diagnostics.push({
            message: "Syntax error: Literals can't span multiple lines",
            severity: DiagnosticSeverity.Error,
            range: value.range
        });
        return null;
    }

    return value;
}

export function error(message: string, range: Range): Diagnostic {
    return {
        message: message,
        severity: DiagnosticSeverity.Error,
        range: range
    };
}
export function warning(message: string, range: Range): Diagnostic {
    return {
        message: message,
        severity: DiagnosticSeverity.Warning,
        range: range
    };
}

export function takeUnexpected(tokens: Token[], diagnostics: Diagnostic[], test: (t: Token) => boolean) {
    let rest = takeWhile(tokens, test);
    removeAll(rest, t => t.isWhitespace());

    if (rest.length > 0) {
        diagnostics.push(error("Syntax error: Unexpected Token", rangeOver(rest)));
    }
}
