import { Range, Position } from "vscode-languageserver";
import { parseRawGrammar, Registry, IGrammar, StackElement, IToken } from "vscode-textmate";

import fs = require("fs");

const grammarPath = __dirname+"/../../syntaxes/tatsu.tmLanguage.json";

let registry = new Registry();

export class Token {
    scopes: string[];
    text: string;
    range: Range;

    constructor(token: IToken, text: string, line: number) {
        this.scopes = token.scopes;
        this.range = Range.create(line, token.startIndex, line, token.endIndex);
        this.text = text.substring(token.startIndex, token.endIndex);       
    }

    inScope(str: string): boolean {
        for (let scope of this.scopes) {
            if (scope.indexOf(str) !== -1) {
                return true;
            }
        }
        return false;
    }
}

export async function tokenize(lines: string[]): Promise<Token[][]> {
    let grammar = await getGrammar();

    var ruleStack: StackElement;
    var tokens: Token[][] = [];
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        var r = grammar.tokenizeLine(line, ruleStack!);
	    tokens.push(r.tokens.map(v => new Token(v, line, i)));
	    ruleStack = r.ruleStack;
    }
    return tokens;
}

async function getGrammar() {
    let grammar = fs.readFileSync(grammarPath).toString()
    return registry.addGrammar(parseRawGrammar(grammar, grammarPath))
}
