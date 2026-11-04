import { describe, expect, it } from "vitest";
import { classifySentiment } from "./sentiment";

describe("classifySentiment", () => {
  it("spots clearly positive and negative messages", () => {
    expect(classifySentiment("Love this place, best latte in town ❤️")).toBe("positive");
    expect(classifySentiment("Waited 25 minutes and the coffee was cold. Disappointed.")).toBe("negative");
    expect(classifySentiment("What time do you open on Sunday?")).toBe("neutral");
  });
  it("handles simple negation", () => {
    expect(classifySentiment("Not great today")).toBe("negative");
    expect(classifySentiment("not bad at all")).toBe("positive");
  });
});
