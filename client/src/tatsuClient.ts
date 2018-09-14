'use strict';

import * as path from 'path';
import * as vscode from 'vscode';

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient';

let client: LanguageClient;

export function activate(context: vscode.ExtensionContext) {

	context.subscriptions.push(
		vscode.languages.setLanguageConfiguration('tatsu', {
			wordPattern: /(@@?\w*)|(\w+)/
		})
	);

	// The server is implemented in node
	let serverModule = context.asAbsolutePath(
		path.join('server', 'out', 'tatsuServer.js')
	);
	// The debug options for the server
	// --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
	let debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

	// If the extension is launched in debug mode then the debug server options are used
	// Otherwise the run options are used
	let serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: debugOptions
		}
	};

	// Options to control the language client
	let clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: 'file', language: 'tatsu' }]
	};

	// Create the language client and start the client.
	client = new LanguageClient(
		'TatsuServer',
		'Tatsu Language Server',
		serverOptions,
		clientOptions
	);

	// Start the client. This will also launch the server
	client.start();
}

export async function deactivate(): Promise<void> {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
