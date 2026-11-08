// DeepL's language mapping, which is where the awkward cases live: DeepL wants
// upper-case codes, splits EN/PT/ZH by region, and carries none of the Indic
// languages the translate action also serves.

import { describe, expect, test } from "bun:test";
import { deeplEndpoint, deeplSourceLang, deeplTargetLang } from "../deepl";

describe("deeplTargetLang", () => {
  test("region-splitting languages pick the right variant", () => {
    expect(deeplTargetLang("en")).toBe("EN-US");
    expect(deeplTargetLang("en-IN")).toBe("EN-US");
    expect(deeplTargetLang("en-GB")).toBe("EN-GB");
    expect(deeplTargetLang("pt-BR")).toBe("PT-BR");
    expect(deeplTargetLang("pt-PT")).toBe("PT-PT");
    expect(deeplTargetLang("zh-Hant")).toBe("ZH-HANT");
    expect(deeplTargetLang("zh-TW")).toBe("ZH-HANT");
    expect(deeplTargetLang("zh")).toBe("ZH-HANS");
  });

  test("plain codes are upper-cased", () => {
    expect(deeplTargetLang("de")).toBe("DE");
    expect(deeplTargetLang("ja-JP")).toBe("JA");
    expect(deeplTargetLang("FR")).toBe("FR");
  });

  test("languages DeepL does not carry are rejected, not guessed", () => {
    // Sarvam's territory: a wrong code here would be a 400 in production.
    expect(deeplTargetLang("hi-IN")).toBeNull();
    expect(deeplTargetLang("ta-IN")).toBeNull();
    expect(deeplTargetLang("bn-IN")).toBeNull();
    expect(deeplTargetLang("")).toBeNull();
    expect(deeplTargetLang(undefined)).toBeNull();
  });
});

describe("deeplSourceLang", () => {
  test("auto and empty mean detect", () => {
    expect(deeplSourceLang("auto")).toBeNull();
    expect(deeplSourceLang("")).toBeNull();
    expect(deeplSourceLang(null)).toBeNull();
  });

  test("regional variants collapse to the plain source code", () => {
    expect(deeplSourceLang("en-GB")).toBe("EN");
    expect(deeplSourceLang("pt-BR")).toBe("PT");
  });

  test("a source DeepL cannot read is dropped so detection handles it", () => {
    expect(deeplSourceLang("hi-IN")).toBeNull();
  });
});

describe("deeplEndpoint", () => {
  test("free keys go to the free host", () => {
    expect(deeplEndpoint("abc:fx")).toBe("https://api-free.deepl.com");
  });

  test("pro keys go to the pro host", () => {
    expect(deeplEndpoint("abc-123")).toBe("https://api.deepl.com");
  });

  test("an override wins and loses its trailing slash", () => {
    expect(deeplEndpoint("abc:fx", "https://proxy.internal/")).toBe(
      "https://proxy.internal",
    );
  });
});
