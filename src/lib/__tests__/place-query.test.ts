import { describe, expect, test } from "bun:test";
import { splitPlaceQuery } from "../place-query";

describe("splitPlaceQuery", () => {
  test("splits a trailing near clause", () => {
    expect(splitPlaceQuery("coffee near Barcelona")).toEqual({
      query: "coffee",
      near: "Barcelona",
    });
  });

  test("keeps a location with spaces in it whole", () => {
    expect(splitPlaceQuery("pharmacy near Shibuya, Tokyo")).toEqual({
      query: "pharmacy",
      near: "Shibuya, Tokyo",
    });
  });

  test("leaves `in` in the query, where Maps reads it correctly", () => {
    expect(splitPlaceQuery("ramen in Tokyo")).toEqual({ query: "ramen in Tokyo" });
  });

  test("leaves a query with no location alone", () => {
    expect(splitPlaceQuery("espresso bars")).toEqual({ query: "espresso bars" });
  });

  test("does not split a phrase that only looks like a location", () => {
    // "in a bowl" is the dish, not the address. Inventing a location here sends
    // the search somewhere the user never asked about.
    expect(splitPlaceQuery("ramen in a bowl")).toEqual({ query: "ramen in a bowl" });
  });

  test("refuses to keep a location clause with no subject", () => {
    expect(splitPlaceQuery("near Lisbon")).toEqual({ query: "near Lisbon" });
  });

  test("collapses whitespace and handles empty input", () => {
    expect(splitPlaceQuery("  coffee   near   Porto  ")).toEqual({
      query: "coffee",
      near: "Porto",
    });
    expect(splitPlaceQuery("   ")).toEqual({ query: "" });
  });
});
