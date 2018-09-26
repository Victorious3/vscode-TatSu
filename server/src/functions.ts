import { CompletionItem, CompletionItemKind } from "vscode-languageserver";

export function sleep(ms: any) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Utility
export function removeAll<T>(arr: Array<T>, test: (t: T) => boolean): Array<T> {
	let match: Array<T> = [];
	for (let i = 0; i < arr.length; i++) {
		let t = arr[i];
		if (test(t)) {
			match.push(t);
            arr.splice(i, 1);
            i--;
		}
	}
	return match;
}

export function takeNext<T>(arr: Array<T>, test: (t: T) => boolean): T {
    takeWhile(arr, t => !test(t));
    return arr.splice(0, 1)[0];
}

export function takeWhile<T>(arr: Array<T>, test: (t: T) => boolean): Array<T> {
    let result: Array<T> = [];
    for (let i = 0; i < arr.length; i++) {
        let t = arr[i];
        if (test(t)) {
            result.push(t);
        } else {
            break;
        }
    }
    arr.splice(0, result.length);
    return result;
}

export function last<T>(arr: Array<T>): T {
    return arr[arr.length - 1];
}

export function flatten<T>(arr: Array<Array<T>>): Array<T> {
    return arr.reduce((f, n) => f.concat(n), []);
}

export namespace ItemKind {
	export function rule(name: string): CompletionItem {
		return {label: name, kind: CompletionItemKind.Function};
	}
	export function keyword(name: string): CompletionItem {
		return {label: name, kind: CompletionItemKind.Enum};
	}
	export function type(name: string): CompletionItem {
		return {label: name, kind: CompletionItemKind.Class};
	}
}