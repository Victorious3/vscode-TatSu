import { Range } from "vscode-languageserver";

const T_STRINGLIT_BASE = "%(([^%\\\\]|\\\\.)*)%";

export const Token = {
	T_INLINE_COMMENT: /^([#][^\n]*)(?=[\n]|$)/,
	T_MULTILINE_COMMENT: /^(\(\*(.|[\r\n]+)*?\*\))/,

	T_BOOLEAN: /^(True|False)/,
	T_IDENT: /^(?!\d)(\w+)/,
	T_NUMBER: /^((0[xX](\d|[a-fA-F])+)|([-+]?(\d+\.\d*|\d*\.\d+)([Ee][-+]?\d+)?)|([-+]?\d+))/,

	T_STRING: RegExp(`^([r?])?(`+T_STRINGLIT_BASE.replace(/%/g, "\"")+` | `+T_STRINGLIT_BASE.replace(/%/g, "'"))+`)`,
	T_REGEX: RegExp(`^`+T_STRINGLIT_BASE.replace(/%/g, "/")),

	T_DIRECTIVE: /^@@(?!\d)(\w+)/,
	T_DECORATOR: /^@(?!\d)(\w+)/,
	T_INCLUDE: /^#include[^\n]*/,

	T_O_PAREN: /^\(/,
	T_C_PAREN: /^\)/,
	T_O_SQUARE: /^\[/,
	T_C_SQUARE: /^\]/,
	T_O_BRACE: /^\{/,
	T_C_BRACE: /^\}/,

	T_D_COLON: /^::/,
	T_COLON: /^:/,
	T_SKIP_TO: /^->/
};

export interface Token {
	range: Range;
	value: string | number;
	match: string;
	token: RegExp | null;
}