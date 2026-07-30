import { describe, expect, it } from 'vitest'

import { applyOrder } from '@/features/admin/server/template-versions-service'

/**
 * Section and item ordering for the template version editor.
 *
 * `order` is an absolute integer on an embedded array that the service rewrites
 * wholesale, so getting this wrong does not error — it silently reshuffles a
 * checklist, and the next deployment snapshots the wrong sequence. Pure: no
 * database.
 */

interface Entry {
  id: string
  order: number
  deletedAt?: Date | null
}

function entries(...spec: Array<[id: string, order: number, deleted?: boolean]>): Entry[] {
  return spec.map(([id, order, deleted]) => ({
    id,
    order,
    deletedAt: deleted ? new Date('2026-01-01') : null,
  }))
}

/** `id:order` pairs in stored array position, so reshuffles are visible. */
function shape(result: Entry[]): string {
  return result.map((entry) => `${entry.id}:${entry.order}`).join(' ')
}

describe('applyOrder', () => {
  it('renumbers contiguously from 0 in the requested sequence', () => {
    const result = applyOrder(entries(['a', 0], ['b', 1], ['c', 2]), ['c', 'a', 'b'])

    expect(shape(result)).toBe('a:1 b:2 c:0')
  })

  it('closes gaps left by earlier deletes', () => {
    // Orders 0/5/9 arise naturally: nextOrder() uses max+1, so deleting the
    // middle of a list leaves holes that must not survive a reorder.
    const result = applyOrder(entries(['a', 0], ['b', 5], ['c', 9]), ['a', 'b', 'c'])

    expect(result.map((e) => e.order)).toEqual([0, 1, 2])
  })

  it('keeps ids the caller did not mention, after the ones it did', () => {
    // The stale-client case: someone reorders without having seen 'd', which a
    // colleague added a moment ago. 'd' must not be dragged to the front.
    const result = applyOrder(entries(['a', 0], ['b', 1], ['c', 2], ['d', 3]), ['c'])

    expect(shape(result)).toBe('a:1 b:2 c:0 d:3')
  })

  it('preserves the relative order of unmentioned ids', () => {
    const result = applyOrder(entries(['a', 0], ['b', 1], ['c', 2], ['d', 3]), ['d'])

    const byId = new Map(result.map((e) => [e.id, e.order]))
    expect(byId.get('d')).toBe(0)
    expect(byId.get('a')).toBeLessThan(byId.get('b')!)
    expect(byId.get('b')).toBeLessThan(byId.get('c')!)
  })

  it('ignores ids that are not in the list', () => {
    const result = applyOrder(entries(['a', 0], ['b', 1]), ['b', 'ghost', 'a'])

    expect(shape(result)).toBe('a:1 b:0')
  })

  it('leaves soft-deleted entries untouched and excludes them from numbering', () => {
    // A tombstone carries no meaningful order; renumbering one would make a
    // future restore land at an arbitrary position.
    const result = applyOrder(
      entries(['a', 0], ['gone', 1, true], ['b', 2]),
      ['b', 'a'],
    )

    const byId = new Map(result.map((e) => [e.id, e.order]))
    expect(byId.get('b')).toBe(0)
    expect(byId.get('a')).toBe(1)
    expect(byId.get('gone')).toBe(1)
    expect(result.find((e) => e.id === 'gone')?.deletedAt).toBeInstanceOf(Date)
  })

  it('refuses to resurrect a soft-deleted id that the caller sends', () => {
    const result = applyOrder(entries(['a', 0], ['gone', 1, true]), ['gone', 'a'])

    // 'gone' is filtered out of the requested list, so 'a' takes position 0
    // rather than being pushed behind a deleted entry.
    expect(result.find((e) => e.id === 'a')?.order).toBe(0)
    expect(result.find((e) => e.id === 'gone')?.deletedAt).toBeInstanceOf(Date)
  })

  it('is a no-op on an empty list', () => {
    expect(applyOrder([], ['a'])).toEqual([])
  })

  it('does not mutate the input', () => {
    const input = entries(['a', 0], ['b', 1])
    applyOrder(input, ['b', 'a'])

    expect(input.map((e) => e.order)).toEqual([0, 1])
  })
})
