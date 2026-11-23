import { test, expect } from "bun:test";
import { utf8ToBase64, getGitHubPagesUrl } from "../src/utils/githubUploader.js";

test("utf8ToBase64 correctly encodes plain ascii", () => {
  const input = "Hello, OpenJam!";
  const encoded = utf8ToBase64(input);
  expect(encoded).toBe(Buffer.from(input, "utf8").toString("base64"));
});

test("utf8ToBase64 correctly encodes multibyte unicode and emojis", () => {
  const input = "OpenJam 🍓🫐🍇🍒 - 録画セッション & <script>alert('hello')</script>";
  const encoded = utf8ToBase64(input);
  const expected = Buffer.from(input, "utf8").toString("base64");
  expect(encoded).toBe(expected);
});

test("utf8ToBase64 correctly encodes large strings without stack overflow", () => {
  // 100KB string
  const input = "<div>Some HTML content with unicode: 日本語と絵文字🍓</div>".repeat(2000);
  const encoded = utf8ToBase64(input);
  const expected = Buffer.from(input, "utf8").toString("base64");
  expect(encoded).toBe(expected);
});

test("getGitHubPagesUrl produces expected format", () => {
  const url = getGitHubPagesUrl("SaintPepsi", "openjam-reports", "openjam-2026-11-23.html");
  expect(url).toBe("https://saintpepsi.github.io/openjam-reports/reports/openjam-2026-11-23.html");
});
