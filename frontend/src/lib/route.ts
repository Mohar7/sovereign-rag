// Hash router — three lines, no dependency.
//
// We use the location.hash because every screen can deep-link without
// the SPA needing a backend route. Subscribing components get re-rendered
// whenever the hash changes.

import { useEffect, useState } from "react";

export function getHash(): string {
  // Strip the leading "#" and return whatever comes after it.
  return typeof window === "undefined" ? "" : window.location.hash.replace(/^#/, "");
}

export function useHashRoute(): string {
  const [hash, setHash] = useState(getHash());
  useEffect(() => {
    const onChange = () => setHash(getHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}
