type Address = { pathname: string; search: string; hash: string };

/** A committed React location can lag a browser navigation during a transition. */
export function isCurrentLocation(expected: Address, actual: Address = window.location) {
  return actual.pathname === expected.pathname && actual.search === expected.search && actual.hash === expected.hash;
}
