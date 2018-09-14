'use strict';

import {
	createConnection,
	TextDocuments,
	TextDocument,
	Diagnostic,
	DiagnosticSeverity,
	ProposedFeatures,
	InitializeParams,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	Position,
	Range
} from 'vscode-languageserver';
import XRegExp = require('xregexp');

// Create a connection for the server. The connection uses Node's IPC as a transport.
// Also include all preview / proposed LSP features.
let connection = createConnection(ProposedFeatures.all);

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

const TEMPLATE_STRINGLIT = "(%([^%\\\\]|\\\\.)*%)";
const RE_STRING_LIT = `
	`+TEMPLATE_STRINGLIT.replace(/%/g, "\"")+` 
	| `+TEMPLATE_STRINGLIT.replace(/%/g, "'")+` 
	| `+TEMPLATE_STRINGLIT.replace(/%/g, "/")+`
`;

const RE_INLINE_COMMENT = "[#].*(\\n|$)";
const RE_MULTILINE_COMMENT = "\\(\\*(.|[\\r\\n]+)*?\\*\\)";

const RE_COMMENTS = XRegExp(`
	(?<inline_comment>`+RE_INLINE_COMMENT+`)	   |
	(?<multiline_comment>`+RE_MULTILINE_COMMENT+`) |
	(?<newline>\\n)                                | 
	(?<string>`+RE_STRING_LIT+`)
`, 'xgm');
const INLINE_COMMENT = 1;
const MULTILINE_COMMENT = 3;
const STRING = 6;

console.log(RE_COMMENTS.toString());

const RE_STRUCTURE = XRegExp(`
	(@@(?<directive>.*)(\\n|$))            |
	([#]include(?<include>.*)(\\n|$))      |
	((?!\\d)(?<rulename>\\w+)[^=]*=[^;]*;) | 
	(`+RE_INLINE_COMMENT+`)                |
	(`+RE_MULTILINE_COMMENT+`)
`, 'xgm');
const DIRECTIVE = 1;
const INCLUDE = 5;
const RULENAME = 8;

const RE_ARGS = XRegExp("(\\s+)|(\\S+)", 'g');
const RE_KEYWORD = XRegExp("(?!\\d)(\\w+)");

function countLines(str: string) {
	return str.split("\n").length - 1;
}

class Comment {
	start?: number;
	end?: number;

	constructor(start?: number, end?: number) {
		this.start = start;
		this.end = end;
	}

	test(n: number): boolean {
		if (this.start !== undefined) {
			if (n < this.start) { return false; }
		}
		if (this.end !== undefined) {
			if (n > this.end) { return false; }
		}
		return true;
	}
}

class LineInfo {
	line: string;
	comments: Comment[] = [];

	constructor(line: string) {
		this.line = line;
	}

	isCommentAt(n: number): boolean {
		for (let comment of this.comments) {
			if (comment.test(n)) {
				return true;
			}
		}
		return false;
	}
}

class RuleInfo {
	name: string;
	item: CompletionItem;
	range: Range;

	constructor(name: string, range: Range) {
		this.name = name;
		this.range = range;
		this.item = {label: name, kind: CompletionItemKind.Function};
	}
}

interface CacheEntry {
	rules: RuleInfo[];
	keywords: CompletionItem[];
	lines: LineInfo[];
}

let cachedFiles = new Map<string, CacheEntry>();

async function validate(textDocument: TextDocument): Promise<void> {
	let text = textDocument.getText();
	let lines = text.split("\n").map(l => new LineInfo(l));

	let diagnostics: Diagnostic[] = [];
	let keywords: CompletionItem[] = [];
	let rules: RuleInfo[] = [];
	
	let match: any;
	while (match = RE_STRUCTURE.exec(text)!) {
		let pos = textDocument.positionAt(match.index);

		if (match[DIRECTIVE]) {
			let i = pos.character + 2;
			let s = match[DIRECTIVE].split("::");
			let name: string = s[0];
			i += name.length;
			if (name.trim() === "keyword") {
				let args = s[1];
				let arg: any;
				while (arg = RE_ARGS.exec(args)!) {
					let argv = arg[1];
					if (argv) {
						if (RE_KEYWORD.test(argv)) {
							keywords.push({label: argv, kind: CompletionItemKind.Constant});
						} else {
							diagnostics.push({
								severity: DiagnosticSeverity.Error, 
								range: {
									start: Position.create(pos.line, i),
									end: Position.create(pos.line, i + argv.length)
								},
								message: "Invalid keyword"
							});
						}
					}
					i += arg[0].length;
				}
			}

		} else if(match[RULENAME]) {
			let name = match[RULENAME];
			rules.push(new RuleInfo(
				name, Range.create(pos, textDocument.positionAt(match.index + match[0].length))
			));
		}
	}

	// Compute comment positions
	while (match = RE_COMMENTS.exec(text)!) {
		let pos = textDocument.positionAt(match.index);

		if (match[MULTILINE_COMMENT]) {
			let nl = countLines(match[0]);
			// connection.console.log("Found multiline comment at " + pos.line + " length " + (nl + 1));
			
			if (nl === 0) {
				lines[pos.line].comments.push(new Comment(pos.character + 1, pos.character + match[0].length - 1));
			} else {
				// First line
				lines[pos.line].comments.push(new Comment(lines[pos.line].line.lastIndexOf("(*") + 1));
				// Last line
				lines[pos.line + nl].comments.push(new Comment(0, lines[pos.line].line.indexOf("*)") + 1));
			}
			if (nl > 2) {
				let l = nl - 1;
				while (l--) {
					// mark all lines
					lines[pos.line + l + 1].comments.push(new Comment(0));
				}
			}

			
		} else if (match[INLINE_COMMENT]) {
			// connection.console.log("Found inline comment at " + pos.line);
			// Find start of inline comment
			lines[pos.line].comments.push(new Comment(lines[pos.line].line.indexOf("#") + 1));
		} else if (match[STRING]) {
			
		}
	}

	let cacheEntry: CacheEntry = {
		keywords: keywords,
		rules: rules,
		lines: lines
	};

	cachedFiles.set(textDocument.uri, cacheEntry);

	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

// connection.onDidChangeWatchedFiles(_change => {});

const CONSTANT_NAMES : CompletionItem[] = [
	{label: "@name", kind: CompletionItemKind.Keyword},
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
		
		// Check if we are inside a comment
		if (lineinfo.isCommentAt(start_pos)) { 
			return [];
		}

		let items: CompletionItem[] = [];
	
		while (pos > 0 && /[\w@]/.test(lineinfo.line.charAt(pos - 1))) {
			pos -= 1;
		}
		let word = lineinfo.line.substring(pos, start_pos);
		
		connection.console.log("Autocompletion for: " + word);

		if (word.startsWith("@")) {
			items = items.concat(CONSTANT_NAMES);
		} else {
			for (let rule of cachedFile.rules) {
				items.push(rule.item);
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
