/** Zero-based page indexes follow the API's signed int32 contract. */
export function isPageIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2_147_483_647;
}
