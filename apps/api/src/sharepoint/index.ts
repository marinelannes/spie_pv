import type { SharePointConfig } from "../config.js";
import { FakeSharePointClient } from "./fake.js";
import { createGraphSharePointClient } from "./graph.js";
import type { SharePointClient } from "./types.js";

export function createSharePointClient(cfg: SharePointConfig): SharePointClient | null {
  switch (cfg.mode) {
    case "graph":
      return createGraphSharePointClient(cfg);
    case "fake":
      return new FakeSharePointClient(cfg.rootDir);
    case "disabled":
      return null;
  }
}
