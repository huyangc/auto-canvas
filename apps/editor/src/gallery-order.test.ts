import { afterEach, describe, expect, it } from "vitest";

import {
  GALLERY_ORDER_KEY,
  GALLERY_SEED_GLOBAL,
  galleryOrderPreference,
  galleryShuffleSeed,
  rememberGalleryOrder,
} from "./gallery-order";

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[GALLERY_SEED_GLOBAL];
});

describe("the Gallery's order (#1615)", () => {
  it("opens shuffled unless the reader kept another order", () => {
    expect(galleryOrderPreference(() => null)).toBe("random");
    expect(galleryOrderPreference(() => "oldest")).toBe("oldest");
    expect(galleryOrderPreference(() => "fewest")).toBe("fewest");
    expect(galleryOrderPreference(() => "name")).toBe("name");
    expect(galleryOrderPreference(() => "name-desc")).toBe("name-desc");
    expect(galleryOrderPreference(() => "random")).toBe("random");
    expect(galleryOrderPreference(() => "sideways")).toBe("random");
    expect(
      galleryOrderPreference(() => {
        throw new Error("storage blocked");
      }),
    ).toBe("random");
  });

  it("keeps a chosen order and forgets Random, so each visit reshuffles", () => {
    const store = new Map<string, string>();
    const storage = {
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    };
    rememberGalleryOrder("parts", storage);
    expect(store.get(GALLERY_ORDER_KEY)).toBe("parts");
    rememberGalleryOrder("random", storage);
    expect(store.has(GALLERY_ORDER_KEY)).toBe(false);
  });

  it("shuffles by index.html's seed when it made one", () => {
    (globalThis as Record<string, unknown>)[GALLERY_SEED_GLOBAL] = "abc123";
    expect(galleryShuffleSeed()).toBe("abc123");
    (globalThis as Record<string, unknown>)[GALLERY_SEED_GLOBAL] =
      "Not a seed!";
    const own = galleryShuffleSeed();
    expect(own).toMatch(/^[a-z0-9]{1,16}$/u);
    expect(galleryShuffleSeed()).toBe(own);
  });
});
