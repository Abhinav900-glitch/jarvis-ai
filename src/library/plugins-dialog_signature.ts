/**
 * A tiny smoke test: imports `PluginsDialog` and reads the honest copy it
 * would show a user, so a future rename or a softened claim is caught by the
 * suite rather than by a person re-reading the screen.
 *
 * We do not mount React here: the component is a pure UI leaf, and a mounting
 * test would only assert that it renders, which the repo already exercises in
 * the dashboard. This test asserts the *message* the feature is allowed to make
 * about itself.
 */
import { describe, expect, test } from "bun:test";
import { PluginsDialog } from "@/components/plugins-dialog";

describe("PluginsDialog", () => {
  test("states that stored zips do not execute from here", () => {
    const dialog = PluginsDialog as unknown as {
      /** The footer text the dialog shows beneath the zip list. */
      readonly _storedCopy:
        | string
        | { readonly verbatim: string };
    };

    // The component is a React function; we only trust the public copy it
    // owns. If a future edit softens "nothing executes" into something weaker,
    // this is the test that should complain.
    const copy =
      typeof dialog._storedCopy === "string"
        ? dialog._storedCopy
        : dialog._storedCopy?.verbatim;

    expect(copy).toBeTruthy();
    expect(copy.toLowerCase()).toContain("nothing");
    expect(copy.toLowerCase()).toContain("execut");
  });
});
