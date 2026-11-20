// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { FICHIERS_VENDOR, vendorPaged } from "./vendor-paged";

describe("vendorPaged", () => {
  it("fournit la polyfill Paged.js et les gestionnaires du modèle", () => {
    expect(Object.keys(FICHIERS_VENDOR).sort()).toEqual(["vendor/paged-handlers.js", "vendor/paged.polyfill.js"]);
    expect(FICHIERS_VENDOR["vendor/paged.polyfill.js"]!()).toContain("PagedPolyfill");
    expect(FICHIERS_VENDOR["vendor/paged-handlers.js"]!()).toContain("registerHandlers");
  });

  it("émet les fichiers au build", () => {
    const plugin = vendorPaged({ "vendor/a.js": () => "A" });
    const emitFile = vi.fn();
    (plugin.generateBundle as (this: unknown) => void).call({ emitFile });
    expect(emitFile).toHaveBeenCalledWith({ type: "asset", fileName: "vendor/a.js", source: "A" });
  });

  it("les sert en développement et laisse passer les autres requêtes", () => {
    const plugin = vendorPaged({ "vendor/a.js": () => "A" });
    let middleware!: (req: { url?: string }, res: unknown, next: () => void) => void;
    (plugin.configureServer as (s: unknown) => void)({
      middlewares: { use: (m: typeof middleware) => (middleware = m) },
    });
    const res = { setHeader: vi.fn(), end: vi.fn() };
    const next = vi.fn();
    middleware({ url: "/vendor/a.js?v=1" }, res, next);
    expect(res.end).toHaveBeenCalledWith("A");
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/javascript; charset=utf-8");
    middleware({ url: "/index.html" }, res, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
