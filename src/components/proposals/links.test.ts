import { describe, expect, it } from "vitest";
import { mailtoAddress, mailtoUrl, whatsappUrl } from "./links";

describe("proposal contact links", () => {
  it("builds a mailto link with encoded subject and body", () => {
    const url = mailtoUrl("contact@chez-ama.example", "Un site web pour Chez Ama", "Bonjour,\n\nÀ bientôt & merci ?");
    expect(url).toBe(
      "mailto:contact@chez-ama.example?subject=Un%20site%20web%20pour%20Chez%20Ama&body=Bonjour%2C%0A%0A%C3%80%20bient%C3%B4t%20%26%20merci%20%3F",
    );
    expect(decodeURIComponent(new URL(url).searchParams.get("body") ?? "")).toBe("Bonjour,\n\nÀ bientôt & merci ?");
  });

  it("only accepts plain addresses for mailto", () => {
    expect(mailtoAddress(" hello@ama.example ")).toBe("hello@ama.example");
    expect(mailtoAddress("a@b.example?cc=evil@x.example")).toBeNull();
    expect(mailtoAddress("not an email")).toBeNull();
    expect(mailtoAddress(null)).toBeNull();
  });

  it("builds a wa.me link from digits and encodes the text", () => {
    expect(whatsappUrl("22890123456", "Hello Chez Ama!\nSee you")).toBe("https://wa.me/22890123456?text=Hello%20Chez%20Ama!%0ASee%20you");
    expect(whatsappUrl("+228 90 12 34 56", "x")).toBe("https://wa.me/22890123456?text=x");
  });
});
