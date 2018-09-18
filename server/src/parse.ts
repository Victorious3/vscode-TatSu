import * as path from 'path';

import Uri from 'vscode-uri';
import { Diagnostic, Range } from "vscode-languageserver";

import { Token, Value, takeValue, error, takeUnexpected } from "./grammar";
import { removeAll, takeNext } from "./functions";
import { RuleInfo } from "./cache";

export function parseIncludes(tokens: Token[], uri: string, 
    onInclude?: (i: string, range: Range) => void, diagnostics: Diagnostic[] = []): string[] {
        
	let result: string[] = [];

	function parseInclude(file: Value) {
		let p = file.value;
		if (!path.isAbsolute(p)) {
			p = Uri.file(path.dirname(Uri.parse(uri).fsPath) + "/" + p).toString();
		} else {
			p = Uri.file(file.value).toString();
		}
        result.push(p);
        if (onInclude) {
            onInclude(p, file.range);
        }
	}

	let includes = removeAll(tokens, t => t.inScope("meta.tatsu.include"));
	let include: Token;
	while (include = takeNext(includes, t => t.inScope("keyword.control"))) {
		let separator = takeNext(includes, t => t.inScope("separator.directive"));
		let file = takeValue(includes, diagnostics);
		if (!file) {
			let start = separator.range.start;
			diagnostics.push(error("File path expected", 
				Range.create(start.line, start.character + 2, start.line + 1, 0)));
			continue;
		}
		parseInclude(file!);
		takeUnexpected(includes, diagnostics, t => !t.inScope("keyword.control"));
	}
	return result;
}

export function parseRules(tokens: Token[], uri: string): RuleInfo[] {
	return removeAll(tokens, t => t.inScope("entity.name.function"))
		.map(v => new RuleInfo(v.text(), uri, v.range));
}