'use strict';

import {
	createConnection,
	TextDocuments,
	Diagnostic,
	ProposedFeatures,
	InitializeParams,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	Range,
	DiagnosticSeverity,
	MarkupContent,
	TextDocument
} from 'vscode-languageserver';

import { Token, tokenize, takeValues, Value, ValueType, takeUnexpected, error } from './grammar';
import { removeAll, takeNext, ItemKind } from './functions';
import { LineInfo, CacheEntry, RuleInfo, cache, getCached, ExternalCacheEntry, getCachedExternal } from './cache';
import { parseRules, parseIncludes } from './parse';

// Create a connection for the server. The connection uses Node's IPC as a transport.
// Also include all preview / proposed LSP features.
let connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager. The text document manager
// supports full document sync only
export let documents: TextDocuments = new TextDocuments();

// vscode root directory as transfered by the client
// this is used to load textmate
export let vscode_root: string;
connection.onNotification("vscode-dir", (dir: string) => vscode_root = dir);

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

function diagnose(uri: string, diag: Diagnostic) {
	connection.sendDiagnostics({uri: uri, diagnostics: [diag]});
}

// connection.onInitialized(() => {});
// connection.onDidChangeConfiguration(change => {});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
	validate(change.document);
});

async function validate(document: TextDocument): Promise<void> {
	let tok = await tokenize(document);

	let lines = tok.map((v, i) => new LineInfo(v, i));
	let cacheEntry = new CacheEntry(lines, document.uri);

	let diagnostics: Diagnostic[] = [];
	let tokens = cacheEntry.all();

	function parseDirective(name: string, args: Value[]) {
		if (name === "@@keyword") {
			let keywords = removeAll(args, v => v.type === ValueType.RAW_STRING || v.type === ValueType.STRING)
				.map(v => v.value);
			
			keywords.forEach(k => cacheEntry.keywords.add(k));

			for (let invalid of args) {
				diagnostics.push({
					message: "Invalid keyword",
					severity: DiagnosticSeverity.Warning,
					range: invalid.range
				});
			}
		}
	}

	let directives = removeAll(tokens, t => t.inScope("meta.tatsu.directive"));
	let name: Token;
	while (name = takeNext(directives, t => t.inScope("keyword.control"))) {
		let separator = takeNext(directives, t => t.inScope("separator.directive"));
		let args = takeValues(directives, diagnostics);
		if (args.length === 0) {
			let start = separator.range.start;
			diagnostics.push(error("Argument expected", 
				Range.create(start.line, start.character + 2, start.line + 1, 0)));
		}
		parseDirective(name.text(), args);
		takeUnexpected(directives, diagnostics, t => !t.inScope("keyword.control"));
	}

	tokens.filter(t => t.inScope("entity.name.type"))
		.map(v => ItemKind.type(v.text()))
		.forEach(k => cacheEntry.types.set(k.label, k));

	cacheEntry.rules = parseRules(tokens, document.uri);

	cacheEntry.includes = parseIncludes(tokens, document.uri, (i, range) => {
		resolveInclude(cacheEntry, i).catch((err) => {
			diagnose(document.uri, error(err.message, range));
		});
	}, diagnostics);

	cache(document.uri, cacheEntry);

	connection.sendDiagnostics({ uri: document.uri, diagnostics });
}
// connection.onDidChangeWatchedFiles(_change => {});

function doc(str: string): MarkupContent {
	return {kind: "markdown", value: 
		str.replace(/[ \t]*\|/gm, "")
			.replace(/%%(.*?)%%/gm, "```tatsu\n$1\n```")
			.replace(/%(.*?)%/gm, "`$1`")
	};
}

const CONSTANT_NAMES : CompletionItem[] = [
	{label: "#include", kind: CompletionItemKind.Keyword,
		detail: "Include directive",
		documentation: doc(`\
			|%% #include :: "file_name" %%
			|Performs a textual include of the specified file.
		`)
	},
	{label: "@name", kind: CompletionItemKind.Keyword,
		detail: "Enable keyword check",
		documentation: doc(`\
			|%% @name rule = ...; %%
			|The %@name% decorator checks that the result of a
			|grammar rule does not match a token defined
			|with %@@keyword%.
		`)
	},
	{label: "@override", kind: CompletionItemKind.Keyword,
		detail: "Redefine a rule",
		documentation: doc(`\
			|%% @override rule = ...; %%
			|A grammar rule may be redefined using the %@override% decorator.
			|
			|When combined with the %#include% directive,
			|rule overrides can be used to create a modified grammar without altering the original.
		`)
	},
	{label: "@@nameguard", kind: CompletionItemKind.Keyword,
		detail: "Toggle name guard",
		documentation: doc(`\
			|%% @@nameguard :: True %%
			|When the name guard is turned on, TatSu will check if the character
			|following a string token (%"token" or 'token'%) is not alphanumeric to
			|prevent tokens like *IN* matching when the text ahead is *INITIALIZE*.
		`)
	},
	{label: "@@namechars", kind: CompletionItemKind.Keyword,
		detail: "Additional name characters",
		documentation: doc(`
			|%% @@namechars :: "$-." %%
			|Additional characters to consider part of a name.
			|
			|See %@@nameguard%.
		`)
	},
	{label: "@@grammar", kind: CompletionItemKind.Keyword,
		detail: "Grammar name",
		documentation: doc(`
			|%% @@grammar :: TatSu %%
			|Name of the grammar. 
			|
			|This is mainly relevant for code generation
			|as it adds the grammar name as a prefix to the generated %Parser%, %Buffer% and
			|%ModelBuilderSemantics%.
		`)
	},
	{label: "@@whitespace", kind: CompletionItemKind.Keyword,
		detail: "Whitespace characters",
		documentation: doc(`
			|%% @@whitespace :: /[\t ]+/ %%
			|Whitespace characters are ignored by the parser.
		`)
	},
	{label: "@@ignorecase", kind: CompletionItemKind.Keyword,
		detail: "Toggle case sensitivity",
		documentation: doc(`
			|%% @@ignorecase :: False
			|When this is turned on, case is getting ignored by the parser.
		`)
	},
	{label: "@@keyword", kind: CompletionItemKind.Keyword,
		detail: "List of keywords",
		documentation: doc(`
			|%% @@keyword :: if else for while %%
			|List of keywords for the grammar. See %@name%.
			|
			|This directive may be used multiple times to specifiy
			|additional keywords.
		`)
	},
	{label: "@@left_recursion", kind: CompletionItemKind.Keyword,
		detail: "Toggle left recursion",
		documentation: doc(`
			|%% @@left_recursion :: True
			|If left recursion is turned off, rules such as
			|%% A = A | B; %%
			|will fail. This can be used if left recursion is not
			|desired by the grammar.
		`)
	},
	{label: "@@comments", kind: CompletionItemKind.Keyword,
		detail: "Regex for multi line comments",
		documentation: doc(`
			|%% @@comments :: /\(\*.*?\*\)/ %%
			|Comments are ignored by the parser.
		`)
	},
	{label: "@@eol_comments", kind: CompletionItemKind.Keyword,
		detail: "Regex for end of line comments",
		documentation: doc(`
			|%% @@eol_comments :: /#.*?$/ %%
			|Comments are ignored by the parser.
		`)
	},
	{label: "@@parseinfo", kind: CompletionItemKind.Keyword,
		detail: "Regex for end of line comments",
		documentation: doc(`
			|%% @@parseinfo :: False %%
			|When this is turned on, TatSu will add an additional
			|element called %parseinfo% to every AST node containing
			|additional info about the parse state.
		`)
	}
];

async function getRules(cacheEntry: CacheEntry) {
	let rules: RuleInfo[];
	try {
		rules = await resolveRules(cacheEntry);
	} catch (error) {
		rules = cacheEntry.rules;
	}
	return rules;
}

export async function resolveInclude(cacheEntry: ExternalCacheEntry, include: string, sentinel: string[] = [cacheEntry.uri]): Promise<RuleInfo[]> {
	if (sentinel.indexOf(include) !== - 1) {
		throw new Error("Circular include");
	}
	sentinel.push(include);
	let cache = await getCachedExternal(include);
	if (!cache) {
		throw new Error("Unknown file");
	}
	return resolveRules(cache, sentinel);
}

async function resolveRules(cacheEntry: ExternalCacheEntry, sentinel: string[] = [cacheEntry.uri]): Promise<RuleInfo[]> {
	let result = cacheEntry.rules;
	for (let include of cacheEntry.includes) {
		result = result.concat(await resolveInclude(cacheEntry, include, sentinel));
	}
	return result;
}

// This handler provides the initial list of the completion items.
connection.onCompletion(async (position: TextDocumentPositionParams): Promise<CompletionItem[]> => {

	let cachedFile = getCached(position.textDocument.uri);
	if (!cachedFile) {
		return [];
	}

	let lineinfo = cachedFile.lines[position.position.line];
	let start_pos = position.position.character;
	let token = lineinfo.getTokenAt(start_pos);
	
	// Check if we are inside a comment
	if (token.inScope("comment")) {
		return [];
	}

	let items: CompletionItem[] = [];

	function suggestKeywords() {
		items = items.concat(Array.from(cachedFile!.keywords)
			.map(ItemKind.keyword)
		);
	}

	function suggestKeywordStrings() {
		items = items.concat(Array.from(cachedFile!.keywords)
			.map(k => ItemKind.keyword("\"" + k + "\""))
		);
	}
	
	let rules = (await getRules(cachedFile)).map(r => r.item);
	function suggestRules() {
		items = items.concat(rules);
	}

	if (token.inScope("constant") && !token.inScope("constant.other.end")) {
		if (token.inScope("constant.other")) {
			suggestKeywords();
		}
	} else if (token.inScope("string") && !token.inScope("end")) {
		// literal
		suggestKeywords();
	} else if (token.inScope("rule-body")){
		suggestRules();
		suggestKeywordStrings();
	} else if (token.inScope("meta.tatsu.based-rule")) {
		suggestRules();
	} else if (token.inScope("meta.tatsu.type-argument")) {
		items = items.concat(Array.from(cachedFile.types.values()));
	} else if (!token.inScope("meta.tatsu.rule-definition")){
		items = items.concat(CONSTANT_NAMES);
	}

	return items;
});

// This handler resolve additional information for the item selected in
// the completion list.
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
	if (item.label.startsWith("@@") || item.label === "#include") {
		item.insertText = item.label + " :: ";
	}
	return item;
});

/*
connection.onDidOpenTextDocument((params) => {
	// A text document got opened in VSCode.
	// params.uri uniquely identifies the document. For documents store on disk this is a file URI.
	// params.text the initial full content of the document.
	connection.console.log(`${params.textDocument.uri} opened.`);
});
*/
connection.onDidChangeTextDocument((params) => {
	// The content of a text document did change in VSCode.
	// params.uri uniquely identifies the document.
	// params.contentChanges describe the content changes to the document.
	connection.console.log(`${params.textDocument.uri} changed: ${JSON.stringify(params.contentChanges)}`);
});

/*
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
