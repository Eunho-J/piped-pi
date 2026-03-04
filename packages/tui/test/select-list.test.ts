import assert from "node:assert";
import { describe, it } from "node:test";
import { SelectList } from "../src/components/select-list.js";
import { visibleWidth } from "../src/utils.js";

const testTheme = {
	selectedPrefix: (text: string) => text,
	selectedText: (text: string) => text,
	description: (text: string) => text,
	scrollInfo: (text: string) => text,
	noMatch: (text: string) => text,
};

describe("SelectList", () => {
	it("normalizes multiline descriptions to single line", () => {
		const items = [
			{
				value: "test",
				label: "test",
				description: "Line one\nLine two\nLine three",
			},
		];

		const list = new SelectList(items, 5, testTheme);
		const rendered = list.render(100);

		assert.ok(rendered.length > 0);
		assert.ok(!rendered[0].includes("\n"));
		assert.ok(rendered[0].includes("Line one Line two Line three"));
	});

	it("keeps mixed-width slash suggestion rows within terminal width", () => {
		const items = [
			{
				value: "/한글",
				label: "/한글",
				description: "한글 IME suggestion with mixed-width 값 and ascii",
			},
			{
				value: "/slash",
				label: "/slash",
				description: "ASCII fallback description",
			},
		];

		const list = new SelectList(items, 5, testTheme);
		const width = 46;
		const rendered = list.render(width);

		assert.ok(rendered.length >= 2);
		for (const line of rendered) {
			assert.ok(visibleWidth(line) <= width, `line exceeds width ${width}: "${line}"`);
		}
	});

	it("keeps slash+hangul filtered suggestions within width", () => {
		const items = [
			{
				value: "/ㅎ한글",
				label: "/ㅎ한글",
				description: "한글 조합 중 slash suggestion overflow regression",
			},
			{
				value: "/help",
				label: "/help",
				description: "help command",
			},
		];

		const list = new SelectList(items, 5, testTheme);
		list.setFilter("/ㅎ");

		const width = 44;
		const rendered = list.render(width);

		assert.ok(rendered.length > 0);
		for (const line of rendered) {
			assert.ok(visibleWidth(line) <= width, `line exceeds width ${width}: "${line}"`);
		}
	});
});
