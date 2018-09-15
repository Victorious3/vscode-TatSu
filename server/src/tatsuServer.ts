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

import { RE_COMMENTS, RE_STRUCTURE, Argument, ArgumentType, parseArguments } from './parse';

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

function countLines(str: string) {
	return str.split("\n").length - 1;
}

function testIn(pos: Position, range: Range): boolean {
	return pos.line <= range.start.line && pos.line >= range.end.line &&
		pos.character <= range.start.character && pos.character >= range.end.character;
}

class LineInfo {
	text: string;
	comments: Range[] = [];
	line: number;

	constructor(text: string, line: number) {
		this.text = text;
		this.line = line;
	}

	isCommentAt(character: number): boolean {
		for (let comment of this.comments) {
			if (testIn(Position.create(this.line, character), comment)) {
				return true;
			}
		}
		return false;
	}
	
	charRange(start: number, end: number): Range {
		return Range.create(this.line, start, this.line, end);
	}

	addComment(start: number, end: number) {
		this.comments.push(this.charRange(start, end));
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
	let lines = text.split("\n").map((v, i) => new LineInfo(v, i));

	let diagnostics: Diagnostic[] = [];
	let keywords: CompletionItem[] = [];
	let rules: RuleInfo[] = [];

	function parseDirective(name: string, args: Argument[]) {
		if (name === "@@keyword") {
			for (let arg of args) {
				if (arg.type === ArgumentType.RAW_STRING || arg.type === ArgumentType.STRING) {
					console.log(arg.value)
					keywords.push({label: arg.value as string, kind: CompletionItemKind.Value});
				} else {
					diagnostics.push({
						message: "Invalid keyword",
						range: arg.range,
						severity: DiagnosticSeverity.Warning
					});
				}
			}
		}
	}
		
	let match: any;

	// Compute comment positions
	while (match = RE_COMMENTS.regex.exec(text)!) {
		let pos = textDocument.positionAt(match.index);

		if (match[RE_COMMENTS.multiline_comment]) {
			let nl = countLines(match[0]);
			// connection.console.log("Found multiline comment at " + pos.line + " length " + (nl + 1));
			
			if (nl === 0) {
				lines[pos.line].addComment(pos.character + 1, pos.character + match[0].length - 1);
			} else {
				// First line
				lines[pos.line].addComment(lines[pos.line].text.lastIndexOf("(*") + 1, lines[pos.line].text.length);
				// Last line
				lines[pos.line + nl].addComment(0, lines[pos.line].text.indexOf("*)") + 1);
			}
			if (nl > 2) {
				let l = nl - 1;
				while (l--) {
					let lp = pos.line + l + 1;
					// mark all lines
					lines[lp].addComment(0, lines[lp].text.length);
				}
			}

			
		} else if (match[RE_COMMENTS.inline_comment]) {
			// connection.console.log("Found inline comment at " + pos.line);
			// Find start of inline comment
			lines[pos.line].addComment(0, lines[pos.line].text.indexOf("#") + 1);
		} else if (match[RE_COMMENTS.string]) {
			
		} else {
			// Everything else
		}
	}

	// Parse structure

	while (match = RE_STRUCTURE.regex.exec(text)!) {
		let pos = textDocument.positionAt(match.index);

		if (match[RE_STRUCTURE.directive]) {
			let m: string = match[RE_STRUCTURE.directive]
			let s = m.split("::");
			let name: string = s[0];
			let args: string = s[1];

			if (!args) {
				continue;
			}

			pos = Position.create(pos.line, pos.character + m.indexOf("::") + 2 + args.search(/\S|$/));
			parseDirective(name.trim(), parseArguments(args.trimLeft(), pos));

		} else if(match[RE_STRUCTURE.rulename]) {
			let name = match[RE_STRUCTURE.rulename];
			rules.push(new RuleInfo(
				name, Range.create(pos, textDocument.positionAt(match.index + match[0].length))
			));
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
		
		// Check if we are inside a comment
		if (lineinfo.isCommentAt(start_pos)) { 
			return [];
		}

		let items: CompletionItem[] = [];
	
		while (pos > 0 && /[\w@]/.test(lineinfo.text.charAt(pos - 1))) {
			pos -= 1;
		}
		let word = lineinfo.text.substring(pos, start_pos);
		
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
