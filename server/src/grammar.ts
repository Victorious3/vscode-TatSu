import fs = require("fs");
import { Range, Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { parseRawGrammar, Registry, StackElement, IToken, IGrammar } from "vscode-textmate";
import { removeAll, takeWhile, last } from "./functions";
import { documents } from "./tatsuServer";

const grammarPath = __dirname+"/../../syntaxes/tatsu.tmLanguage.json";

let registry = new Registry();

export class Token {
    scopes: string[];
    range: Range;
    uri: string;

    static createFromIToken(token: IToken, line: number, uri: string) {
        return new Token(token.scopes,
            Range.create(line, token.startIndex, line, token.endIndex), uri);
    }

    constructor(scopes: string[], range: Range, uri: string) {
        this.scopes = scopes;
        this.uri = uri;
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
        return documents.get(this.uri)!.getText(this.range);
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

export async function tokenize(uri: string): Promise<Token[][]> {
    let grammar = await getGrammar();
    let document = documents.get(uri)!; // TODO

    var ruleStack: StackElement;
    var tokens: Token[][] = [];
    for (let i = 0; i < document.lineCount; i++) {
        let line = document.getText(Range.create(i, 0, i + 1, 0));
        var r = grammar.tokenizeLine(line, ruleStack!);
	    tokens.push(r.tokens.map(v => Token.createFromIToken(v, i, uri)));
	    ruleStack = r.ruleStack;
    }
    return tokens;
}

let grammar: IGrammar | undefined;
async function getGrammar() {
    if (grammar) {
        return grammar;
    }
    let g = fs.readFileSync(grammarPath).toString();
    grammar = await registry.addGrammar(parseRawGrammar(g, grammarPath));
    return grammar;
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
