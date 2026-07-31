// ============================================================================
// Unit tests for src/lib/cart-store.ts (Wave 4 / C-CI-002)
// ============================================================================
import { describe, it, expect, beforeEach } from 'vitest'
import { useCartStore } from './cart-store'

describe('cart-store', () => {
  beforeEach(() => {
    // Reset store before each test
    useCartStore.setState({ items: [] })
  })

  it('starts with empty cart', () => {
    const state = useCartStore.getState()
    expect(state.items).toEqual([])
    expect(state.count()).toBe(0)
  })

  it('add adds a product to cart', () => {
    const { add } = useCartStore.getState()
    add({
      productId: 'test-product-1',
      title: 'Test Product',
      price: 1000,
      image: 'https://example.com/img.jpg',
    })
    expect(useCartStore.getState().items).toHaveLength(1)
    expect(useCartStore.getState().count()).toBe(1)
  })

  it('add increments quantity for existing product', () => {
    const { add } = useCartStore.getState()
    add({ productId: 'p1', title: 'P1', price: 500, image: '' })
    add({ productId: 'p1', title: 'P1', price: 500, image: '' })
    const state = useCartStore.getState()
    expect(state.items).toHaveLength(1)
    expect(state.items[0].quantity).toBe(2)
    expect(state.count()).toBe(2)
  })

  it('remove deletes product from cart', () => {
    const { add, remove } = useCartStore.getState()
    add({ productId: 'p1', title: 'P1', price: 500, image: '' })
    add({ productId: 'p2', title: 'P2', price: 700, image: '' })
    remove('p1')
    const state = useCartStore.getState()
    expect(state.items).toHaveLength(1)
    expect(state.items[0].productId).toBe('p2')
  })

  it('increment increases quantity', () => {
    const { add, increment } = useCartStore.getState()
    add({ productId: 'p1', title: 'P1', price: 500, image: '' })
    increment('p1')
    expect(useCartStore.getState().items[0].quantity).toBe(2)
  })

  it('decrement decreases quantity (and may remove item at 0)', () => {
    const { add, increment, decrement } = useCartStore.getState()
    add({ productId: 'p1', title: 'P1', price: 500, image: '' })
    increment('p1')  // qty = 2
    decrement('p1')  // qty = 1
    expect(useCartStore.getState().items[0].quantity).toBe(1)
  })

  it('clear empties the cart', () => {
    const { add, clear } = useCartStore.getState()
    add({ productId: 'p1', title: 'P1', price: 500, image: '' })
    add({ productId: 'p2', title: 'P2', price: 700, image: '' })
    clear()
    expect(useCartStore.getState().items).toEqual([])
    expect(useCartStore.getState().count()).toBe(0)
  })

  it('count returns total quantity (not item count)', () => {
    const { add, increment } = useCartStore.getState()
    add({ productId: 'p1', title: 'P1', price: 500, image: '' })
    increment('p1')
    increment('p1')
    add({ productId: 'p2', title: 'P2', price: 700, image: '' })
    // p1: 3, p2: 1 → total 4
    expect(useCartStore.getState().count()).toBe(4)
  })

  it('total returns sum of price * quantity', () => {
    const { add } = useCartStore.getState()
    add({ productId: 'p1', title: 'P1', price: 500, image: '' })  // 500 * 1
    add({ productId: 'p2', title: 'P2', price: 700, image: '' })  // 700 * 1
    // total = 500 + 700 = 1200
    expect(useCartStore.getState().total()).toBe(1200)
  })

  it('setQty sets exact quantity', () => {
    const { add, setQty } = useCartStore.getState()
    add({ productId: 'p1', title: 'P1', price: 500, image: '' })
    setQty('p1', 5)
    expect(useCartStore.getState().items[0].quantity).toBe(5)
  })
})
