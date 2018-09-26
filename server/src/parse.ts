import * as path from 'path';

import Uri from 'vscode-uri';
import { Diagnostic, Range } from "vscode-languageserver";

import { Token, error, takeUnexpected } from "./grammar";
import { removeAll, takeNext, takeWhile, last } from "./functions";
import { RuleInfo } from "./cache";

export function parseIncludes(tokens: Token[], uri: string, 
    onInclude?: (i: string, range: Range) => void, diagnostics: Diagnostic[] = []): string[] {
        
	let result: string[] = [];

	function parseInclude(file: Token) {
		let p = file.text().replace(/['"]/g, "").trim();
		if (!path.isAbsolute(p)) {
			p = Uri.file(path.dirname(Uri.parse(uri).fsPath) + "/" + p).toString();
		} else {
			p = Uri.file(p).toString();
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
		let file = includes[0];
		if (!file) {
			let start = separator.range.start;
			diagnostics.push(error("File path expected", 
				Range.create(start.line, start.character + 2, start.line + 1, 0)));
			continue;
		}
		includes.splice(0, 1);
		parseInclude(file);
		takeUnexpected(includes, diagnostics, t => !t.inScope("keyword.control"));
	}
	return result;
}

export function parseRules(tokens: Token[], uri: string): RuleInfo[] {
	let result: RuleInfo[] = [];
	let rules = tokens.filter(t => t.inScope("meta.tatsu.rule-definition"));

	let rule_name: Token;
	while (rule_name = takeNext(rules, t => t.inScope("entity.name.function"))) {
		let body = takeWhile(rules, t => !t.inScope("entity.name.function"));
		let lastToken = body.length > 0 ? last(body): rule_name;
		result.push(new RuleInfo(rule_name.text(), uri, Range.create(rule_name.range.start, lastToken.range.end)));
	}
	return result;
}