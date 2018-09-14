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

const RE_STRUCTURE = XRegExp(`
	(
		@@(?<directive>.*)(\\n|$)
	)|(
		[#]include(?<include>.*)(\\n|$)
	)|(
		(?!\\d)(?<rulename>\\w+)[^=]*=[^;]*;
	)|(
		[#].*(\\n|$)
	)|(
		\\(\\*(.|\\n)*\\*\\)
	)|(.|\\n)
`, 'xgm');

// XRegExp's exec is painfully slow
const DIRECTIVE = 1
const INCLUDE = 5
const RULENAME = 8

const RE_ARGS = XRegExp("(\\s+)|(\\S+)", 'g');
const RE_KEYWORD = XRegExp("(?!\\d)(\\w+)");

interface CacheEntry {
	rules: string[];
	keywords: string[];
	lines: string[];
}

let cachedFiles = new Map<string, CacheEntry>();

async function validate(textDocument: TextDocument): Promise<void> {
	function range(start: number, end: number): Range {
		return {start: textDocument.positionAt(start), end: textDocument.positionAt(end)};
	}

	let text = textDocument.getText();

	let diagnostics: Diagnostic[] = [];
	let keywords: string[] = [];
	let rules: string[] = [];
	
	let index = 0;
	let structure: any;
	while (structure = RE_STRUCTURE.exec(text)!) {
		if (structure[DIRECTIVE]) {
			let i = index + 2;
			let s = structure[DIRECTIVE].split("::");
			let name: string = s[0];
			i += name.length;
			if (name.trim() === "keyword") {
				let args = s[1];
				let arg: any;
				while (arg = RE_ARGS.exec(args)!) {
					let argv = arg[1];
					if (argv) {
						if (RE_KEYWORD.test(argv)) {
							keywords.push(argv);
						} else {
							diagnostics.push({
								severity: DiagnosticSeverity.Error, 
								range: range(i, i + argv.length),
								message: "Invalid keyword"
							});
						}
					}
					i += arg[0].length;
				}
			}

		} else if(structure[RULENAME]) {
			rules.push(structure[RULENAME]);
		}

		index += structure.index;
	}
	// connection.console.log("Rules: " + rules.join(", "));

	let cacheEntry: CacheEntry = {
		keywords: keywords,
		rules: rules,
		lines: text.split("\n")
	};

	cachedFiles.set(textDocument.uri, cacheEntry);

	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

// connection.onDidChangeWatchedFiles(_change => {});

// This handler provides the initial list of the completion items.
connection.onCompletion((position: TextDocumentPositionParams): CompletionItem[] => {
		let cachedFile = cachedFiles.get(position.textDocument.uri);
		if (!cachedFile) {
			return [];
		}
		let line = cachedFile.lines[position.position.line];
		let start_pos = position.position.character;
		let pos = start_pos;

		let items: CompletionItem[] = [];


		while (pos > 0 && /\w/.test(line.charAt(pos - 1))) {
			pos -= 1;
		}
		let word = line.substring(pos, start_pos);
		if (word.startsWith("@")) {

		} else {
			for (let rule of cachedFile.rules) {
				if (rule.startsWith(word)) {
					items.push({label: rule, kind: CompletionItemKind.Function});
				}
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
