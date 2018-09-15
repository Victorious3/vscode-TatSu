import { Position, Range } from "vscode-languageserver";
import XRegExp = require("xregexp");

function findGroup(regex: RegExp, name: string): number {
	return (regex as any).xregexp.captureNames.indexOf(name) + 1;
}

const T_STRINGLIT_BASE = "%(([^%\\\\]|\\\\.)*)%";

const T_STRING_LIT = `
	((?<double_quote>`+T_STRINGLIT_BASE.replace(/%/g, "\"")+`)
	| (?<single_quote>`+T_STRINGLIT_BASE.replace(/%/g, "'")+`)
	| (?<regex_slash>`+T_STRINGLIT_BASE.replace(/%/g, "/")+`))
`;

export namespace RE_STRING_LIT {
	export const regex = XRegExp("^" + T_STRING_LIT, "xm");
	
	export const double_quote 	= findGroup(regex, "double_quote");
	export const single_quote 	= findGroup(regex, "single_quote");
	export const regex_slash 	= findGroup(regex, "regex_slash");
}

const RE_INLINE_COMMENT = "([#][^\\n]*$)";
const RE_MULTILINE_COMMENT = "(\\(\\*(.|[\\r\\n]+)*?\\*\\))";

const RE_BOOLEAN = "^(True|False)";
const RE_RAW_STRING = "^(?!\\d)(\\w+)";
const RE_NUMBER = "^((0[xX](\\d|[a-fA-F])+)|([-+]?(\\d+\\.\\d*|\\d*\\.\\d+)([Ee][-+]?\\d+)?)|([-+]?\\d+))";

export namespace RE_COMMENTS {
	export const regex = XRegExp(`
		(?<inline_comment>`+RE_INLINE_COMMENT+`)	   |
		(?<multiline_comment>`+RE_MULTILINE_COMMENT+`) |
		(?<string>`+T_STRING_LIT+`)                    | 
		(?<fallback> ([^\"'/\\(#]|\((?!\*))* )
	`, 'xgm');

	export const inline_comment 	= findGroup(regex, "inline_comment");
	export const multiline_comment 	= findGroup(regex, "multiline_comment");
	export const string 			= findGroup(regex, "string");
	export const fallback 			= findGroup(regex, "fallback");
}

export namespace RE_STRUCTURE {
	export const regex = XRegExp(`
		(?<directive>@@[^:\\n]*::[^\\n]*$)  |
		([#]include(?<include>[^\\n]*)$)    |
		(
			(?<decorator>(@[^\\n@]*)*)
			(?!\\d)(?<rulename>\\w+)[^=]*=
			(
				`+T_STRING_LIT+` | [^"/';]*
			)*;
		)
		#(?<invalid>[^\s]+)
	`, 'xgm');

	export const directive 	= findGroup(regex, "directive");
	export const include 	= findGroup(regex, "include");
	export const decorator  = findGroup(regex, "decorator");
	export const rulename 	= findGroup(regex, "rulename");
	export const invalid 	= findGroup(regex, "invalid");

}

console.log("RE_STRUCTURE", RE_STRUCTURE.regex, RE_STRUCTURE.directive, RE_STRUCTURE.include, RE_STRUCTURE.rulename, RE_STRUCTURE.invalid);

export enum ArgumentType {
	RAW_STRING, STRING, NUMBER, REGEX, BOOLEAN
}

export class Argument {
	type: ArgumentType;
	value: string | number;
	range: Range;

	constructor(type: ArgumentType, value: string | number) {
		this.type = type;
		this.value = value;
		this.range = Range.create(0, 0, 0, 0);
	}
}

export function parseArguments(str: string, pos: Position): Argument[] {
	let args: Argument[] = [];
	let arg: Argument | null;
	do {
		[str, pos, arg] = parseArgument(str, pos);
		if (arg !== null) { args.push(arg); }
	} while (arg !== null && str.length > 0);

	return args;
}

function parseArgument(str: string, pos: Position): [string, Position, Argument | null] {
	let argument: Argument | null = null;
	let match = str.match(RE_STRING_LIT.regex);
	let len: number = 0;
	if (match) {
		if (match[RE_STRING_LIT.double_quote]) {
			argument = new Argument(ArgumentType.STRING, match[RE_STRING_LIT.double_quote]);
		} else if (match[RE_STRING_LIT.single_quote]) {
			argument = new Argument(ArgumentType.STRING, match[RE_STRING_LIT.single_quote]);
		} else {
			argument = new Argument(ArgumentType.REGEX, match[RE_STRING_LIT.regex_slash]);
		}
	} else if (match = str.match(RE_BOOLEAN)) {
		argument = new Argument(ArgumentType.BOOLEAN, match[0]);
	} else if (match = str.match(RE_NUMBER)) {
		argument = new Argument(ArgumentType.NUMBER, match[0]);
	} else if (match = str.match(RE_RAW_STRING)) {
		argument = new Argument(ArgumentType.RAW_STRING, match[0]);
	} else {
		return [str, pos, argument];
	}

	len = match[0].length;
	let nstr = str.substring(len);
	let endPos = Position.create(pos.line, pos.character + len);
	argument!.range = Range.create(Position.create(pos.line, pos.character + match.index!), endPos);
	return [nstr.trimLeft(), Position.create(pos.line, endPos.character + nstr.search(/\S|$/)), argument];
}