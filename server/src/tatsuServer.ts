'use strict';

import {
	createConnection,
	TextDocuments,
	TextDocument,
	Diagnostic,
	ProposedFeatures,
	InitializeParams,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	Position,
	Range,
	DiagnosticSeverity
} from 'vscode-languageserver';

import { Token, tokenize, takeValues, Value, ValueType, rangeOver } from './grammar';
import { removeAll, takeNext, takeWhile } from './functions';

// Create a connection for the server. The connection uses Node's IPC as a transport.
// Also include all preview / proposed LSP features.
export let connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager. The text document manager
// supports full document sync only
let documents: TextDocuments = new TextDocuments();

connection.onInitialize((params: InitializeParams) => {
	return {
		capabilities: {
			textDocumentSync: documents.syncKind,
			// Tell the client that the server supports code completion
			completionProvider: {
				resolveProvider: true
			}
		}
	};
});

// connection.onInitialized(() => {});
// connection.onDidChangeConfiguration(change => {});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
	validate(change.document);
});

function testIn(pos: Position, range: Range): boolean {
	return pos.line >= range.start.line && pos.line <= range.end.line &&
		pos.character >= range.start.character && pos.character <= range.end.character;
}

class LineInfo {
	text: string;
	tokens: Token[];
	comments: Range[] = [];
	line: number;

	constructor(text: string, tokens: Token[], line: number) {
		this.text = text;
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

class RuleInfo {
	name: string;
	item: CompletionItem;

	constructor(name: string) {
		this.name = name;
		this.item = {label: name, kind: CompletionItemKind.Function};
	}
}

class CacheEntry {
	rules: RuleInfo[] = [];
	keywords: CompletionItem[] = [];
	types: CompletionItem[] = [];

	lines: LineInfo[];

	constructor(lines: LineInfo[]) {
		this.lines = lines;
	}

	getTokenAt(pos: Position): Token {
		return this.lines[pos.line].getTokenAt(pos.character);
	}

	filterByScope(str: string): Token[] {
		return this.lines.map(v => v.filterByScope(str)).reduce((f, n) => f.concat(n));
	}
}

let cachedFiles = new Map<string, CacheEntry>();

async function validate(textDocument: TextDocument): Promise<void> {
	let text = textDocument.getText();
	let tlines = text.split("\n");
	let tokens = await tokenize(tlines);

	let lines = tlines.map((v, i) => new LineInfo(v, tokens[i], i));
	let cacheEntry = new CacheEntry(lines);

	let diagnostics: Diagnostic[] = [];

	function parseDirective(name: string, args: Value[]) {
		if (name === "@@keyword") {
			let keywords = removeAll(args, v => v.type === ValueType.RAW_STRING)
				.map(v => <CompletionItem> {label: v.value, kind: CompletionItemKind.Constant});
			cacheEntry.keywords.concat(keywords);

			for (let invalid of args) {
				diagnostics.push({
					message: "Invalid keyword",
					severity: DiagnosticSeverity.Warning,
					range: invalid.range
				});
			}
		}
	}

	let directives = cacheEntry.filterByScope("meta.tatsu.directive");
	let name: Token;
	while (name = takeNext(directives, t => t.inScope("keyword.control"))) {
		takeNext(directives, t => t.inScope("separator.directive"));
		let args = takeValues(directives, diagnostics);
		parseDirective(name.text, args);

		let rest = takeWhile(directives, t => !t.inScope("keyword.control"))
			.filter(t => !t.isWhitespace());

		if (rest.length > 0) {
			diagnostics.push({
				message: "Syntax error",
				severity: DiagnosticSeverity.Error,
				range: rangeOver(rest)
			});
		}
		
	}

	cacheEntry.rules = cacheEntry
		.filterByScope("entity.name.function")
		.map(v => new RuleInfo(v.text));

	cachedFiles.set(textDocument.uri, cacheEntry);

	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}
// connection.onDidChangeWatchedFiles(_change => {});

const CONSTANT_NAMES : CompletionItem[] = [
	{label: "@name", kind: CompletionItemKind.Keyword},
	{label: "@override", kind: CompletionItemKind.Keyword},
	{label: "@@nameguard", kind: CompletionItemKind.Keyword},
	{label: "@@namechars", kind: CompletionItemKind.Keyword},
	{label: "@@grammar", kind: CompletionItemKind.Keyword},
	{label: "@@whitespace", kind: CompletionItemKind.Keyword},
	{label: "@@ignorecase", kind: CompletionItemKind.Keyword},
	{label: "@@keyword", kind: CompletionItemKind.Keyword},
	{label: "@@left_recursion", kind: CompletionItemKind.Keyword},
	{label: "@@comments", kind: CompletionItemKind.Keyword},
	{label: "@@eol_comments", kind: CompletionItemKind.Keyword}
];

// This handler provides the initial list of the completion items.
connection.onCompletion((position: TextDocumentPositionParams): CompletionItem[] => {
		let cachedFile = cachedFiles.get(position.textDocument.uri);
		if (!cachedFile) {
			return [];
		}

		let lineinfo = cachedFile.lines[position.position.line];
		let start_pos = position.position.character;
		let pos = start_pos;
		let token = lineinfo.getTokenAt(start_pos);
		
		// Check if we are inside a comment
		if (token.inScope("comment")) {
			return [];
		}

		let items: CompletionItem[] = [];
	
		while (pos > 0 && /[\w@]/.test(lineinfo.text.charAt(pos - 1))) {
			pos -= 1;
		}
		let word = lineinfo.text.substring(pos, start_pos);

		function suggestKeywords() {
			items = items.concat(cachedFile!.keywords);
		}

		if (token.inScope("constant") && !token.inScope("constant.other.end")) {
			if (token.inScope("constant.other")) {
				suggestKeywords();
			}
		} else if (token.inScope("string") && !token.inScope("string.end")) {
			// literal
			suggestKeywords();
		} else if (token.inScope("rule-body")){
			items = items.concat(cachedFile.rules.map(r => r.item));
		} else {
			if (word.startsWith("@")) {
				items = items.concat(CONSTANT_NAMES);
			}
		}
	

		return items;
	}
);

// This handler resolve additional information for the item selected in
// the completion list.
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
		return item;
	}
);

/*
connection.onDidOpenTextDocument((params) => {
	// A text document got opened in VSCode.
	// params.uri uniquely identifies the document. For documents store on disk this is a file URI.
	// params.text the initial full content of the document.
	connection.console.log(`${params.textDocument.uri} opened.`);
});
connection.onDidChangeTextDocument((params) => {
	// The content of a text document did change in VSCode.
	// params.uri uniquely identifies the document.
	// params.contentChanges describe the content changes to the document.
	connection.console.log(`${params.textDocument.uri} changed: ${JSON.stringify(params.contentChanges)}`);
});
connection.onDidCloseTextDocument((params) => {
	// A text document got closed in VSCode.
	// params.uri uniquely identifies the document.
	connection.console.log(`${params.textDocument.uri} closed.`);
});
*/

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
