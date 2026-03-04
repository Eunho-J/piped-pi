import assert from "node:assert";
import { describe, it } from "node:test";
import { CombinedAutocompleteProvider } from "../src/autocomplete.js";
import { Editor, type EditorTheme, TUI } from "../src/index.js";
import { VirtualTerminal } from "./virtual-terminal.js";

const testTheme: EditorTheme = {
	borderColor: (text: string) => text,
	selectList: {
		selectedPrefix: (text: string) => text,
		selectedText: (text: string) => text,
		description: (text: string) => text,
		scrollInfo: (text: string) => text,
		noMatch: (text: string) => text,
	},
};

function createEditorWithSlashProvider(): Editor {
	const terminal = new VirtualTerminal(80, 24);
	const tui = new TUI(terminal);
	const editor = new Editor(tui, testTheme);
	editor.setAutocompleteProvider(
		new CombinedAutocompleteProvider(
			[
				{ name: "help", description: "Show help" },
				{ name: "model", description: "Switch model" },
			],
			process.cwd(),
		),
	);
	return editor;
}

describe("Editor slash autocomplete IME guard", () => {
	it("closes slash autocomplete when Hangul input is composed after slash", () => {
		const editor = createEditorWithSlashProvider();

		editor.handleInput("/");
		assert.strictEqual(editor.isShowingAutocomplete(), true);

		// Simulate IME-committed Hangul text while slash suggestions are open.
		editor.handleInput("한");

		assert.strictEqual(editor.getText(), "/한");
		assert.strictEqual(editor.isShowingAutocomplete(), false);
	});

	it("stops rendering slash suggestion overlay after Hangul composition input", () => {
		const editor = createEditorWithSlashProvider();

		editor.handleInput("/");
		const renderedWithSlashSuggestions = editor.render(80);
		assert.ok(renderedWithSlashSuggestions.length > 3);

		editor.handleInput("한");

		const renderedAfterComposition = editor.render(80);
		assert.strictEqual(editor.isShowingAutocomplete(), false);
		assert.strictEqual(renderedAfterComposition.length, 3);
		assert.ok(renderedAfterComposition.some((line) => line.includes("/한")));
	});
});
