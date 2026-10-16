import type { Id } from "./types";

/** Generate a unique id for a new domain entity. */
export function newId(): Id {
  return crypto.randomUUID();
}
