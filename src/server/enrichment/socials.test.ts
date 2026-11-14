import { describe, expect, it } from "vitest";
import { classifySocialLink, collectSocials } from "./socials";

describe("classifySocialLink", () => {
  it.each([
    ["https://www.facebook.com/HotelLeBenin/", "facebook", "https://www.facebook.com/HotelLeBenin"],
    ["https://m.facebook.com/HotelLeBenin?ref=bookmarks", "facebook", "https://www.facebook.com/HotelLeBenin"],
    ["https://fr-fr.facebook.com/hotel.benin", "facebook", "https://www.facebook.com/hotel.benin"],
    ["https://www.facebook.com/profile.php?id=100064123456789&sk=about", "facebook", "https://www.facebook.com/profile.php?id=100064123456789"],
    ["https://www.facebook.com/pages/Hotel-Le-Benin/123456789", "facebook", "https://www.facebook.com/pages/Hotel-Le-Benin/123456789"],
    ["https://www.facebook.com/pg/HotelLeBenin/about/", "facebook", "https://www.facebook.com/HotelLeBenin"],
    ["https://instagram.com/hotel_le_benin/", "instagram", "https://www.instagram.com/hotel_le_benin"],
    ["https://www.linkedin.com/company/hotel-le-benin/about/", "linkedin", "https://www.linkedin.com/company/hotel-le-benin"],
    ["https://fr.linkedin.com/in/kofi-mensah-123", "linkedin", "https://www.linkedin.com/in/kofi-mensah-123"],
    ["https://twitter.com/HotelBenin", "x", "https://x.com/HotelBenin"],
    ["https://x.com/HotelBenin/", "x", "https://x.com/HotelBenin"],
    ["https://twitter.com/#!/HotelBenin", "x", "https://x.com/HotelBenin"],
    ["https://www.tiktok.com/@hotel.benin?lang=fr", "tiktok", "https://www.tiktok.com/@hotel.benin"],
    ["https://www.youtube.com/@HotelBenin", "youtube", "https://www.youtube.com/@HotelBenin"],
    ["https://www.youtube.com/channel/UC1234567890abcdef", "youtube", "https://www.youtube.com/channel/UC1234567890abcdef"],
    ["https://youtube.com/c/HotelBenin/videos", "youtube", "https://www.youtube.com/c/HotelBenin"],
    ["https://www.youtube.com/HotelBenin", "youtube", "https://www.youtube.com/HotelBenin"],
    ["https://wa.me/22890000000", "whatsapp", "https://wa.me/22890000000"],
    ["https://wa.me/+228%2090%2000%2000%2000?text=Bonjour", "whatsapp", "https://wa.me/22890000000"],
    ["https://api.whatsapp.com/send?phone=+233 24 123 4567&text=Hi", "whatsapp", "https://wa.me/233241234567"],
    ["https://web.whatsapp.com/send?phone=00228900000", "whatsapp", "https://wa.me/228900000"],
    ["whatsapp://send?phone=22890000000", "whatsapp", "https://wa.me/22890000000"],
  ])("%s → %s %s", (href, platform, url) => {
    expect(classifySocialLink(href)).toEqual({ platform, url });
  });

  it.each([
    "https://www.facebook.com/sharer/sharer.php?u=https://hotel.tg",
    "https://www.facebook.com/sharer.php?u=x",
    "https://www.facebook.com/dialog/share?app_id=1",
    "https://www.facebook.com/plugins/page.php?href=x",
    "https://www.facebook.com/tr?id=123&ev=PageView",
    "https://www.facebook.com/",
    "https://developers.facebook.com/docs",
    "https://www.instagram.com/p/Cx12345/",
    "https://www.instagram.com/explore/tags/lome/",
    "https://www.linkedin.com/shareArticle?mini=true&url=x",
    "https://www.linkedin.com/sharing/share-offsite/?url=x",
    "https://twitter.com/intent/tweet?text=hi",
    "https://twitter.com/share?url=x",
    "https://twitter.com/HotelBenin/status/123456",
    "https://www.tiktok.com/@hotel.benin/video/7123456789",
    "https://www.youtube.com/watch?v=abc123",
    "https://www.youtube.com/embed/abc123",
    "https://youtu.be/abc123",
    "https://wa.me/message/ABCDEF",
    "https://chat.whatsapp.com/InviteCode",
    "https://wa.me/123",
    "https://api.whatsapp.com/send?text=hello",
    "https://example.com/facebook.com/hotel",
    "mailto:info@hotel.tg",
    "not a url",
  ])("ignores %s", (href) => {
    expect(classifySocialLink(href)).toBeNull();
  });

  it("collectSocials keeps the first profile per network and resolves relative hrefs", () => {
    const socials = collectSocials(
      [
        "https://www.facebook.com/sharer.php?u=x",
        "https://www.facebook.com/HotelLeBenin",
        "https://www.facebook.com/AnotherPage",
        "/contact",
        "https://wa.me/22890000000",
      ],
      "https://hotel.tg/",
    );
    expect(socials).toEqual({ facebook: "https://www.facebook.com/HotelLeBenin", whatsapp: "https://wa.me/22890000000" });
  });
});
