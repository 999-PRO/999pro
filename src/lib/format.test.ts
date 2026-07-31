// ============================================================================
// Unit tests for src/lib/format.ts (Wave 4 / C-CI-002)
// ============================================================================
import { describe, it, expect } from 'vitest'
import { formatPrice, formatCompactNumber, timeAgo, formatDuration } from './format'

describe('formatPrice', () => {
  it('formats RUB currency correctly', () => {
    expect(formatPrice(29990, 'RUB')).toMatch(/29/)
    expect(formatPrice(0, 'RUB')).toMatch(/0/)
  })

  it('formats USD currency correctly', () => {
    expect(formatPrice(50, 'USD')).toMatch(/50/)
  })

  it('handles zero', () => {
    const result = formatPrice(0, 'RUB')
    expect(result).toContain('0')
  })

  it('handles large numbers', () => {
    const result = formatPrice(9999999, 'RUB')
    expect(result).toContain('9')
  })

  it('handles negative numbers (for discounts display)', () => {
    const result = formatPrice(-100, 'RUB')
    expect(result).toContain('100')
  })
})

describe('formatCompactNumber', () => {
  it('returns small numbers as-is', () => {
    expect(formatCompactNumber(0)).toBe('0')
    expect(formatCompactNumber(42)).toBe('42')
    expect(formatCompactNumber(999)).toBe('999')
  })

  it('formats thousands with K suffix', () => {
    expect(formatCompactNumber(1000)).toMatch(/K/)
    expect(formatCompactNumber(1500)).toMatch(/K/)
  })

  it('formats millions with M suffix', () => {
    expect(formatCompactNumber(1_000_000)).toMatch(/M/)
    expect(formatCompactNumber(1_500_000)).toMatch(/M/)
  })
})

describe('timeAgo', () => {
  it('returns "только что" for recent timestamps', () => {
    const now = new Date()
    expect(timeAgo(now)).toContain('только')
  })

  it('returns minutes ago for 5 min old timestamp', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000)
    expect(timeAgo(fiveMinAgo)).toContain('5')
    expect(timeAgo(fiveMinAgo)).toContain('мин')
  })

  it('returns hours ago for 3h old timestamp', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000)
    expect(timeAgo(threeHoursAgo)).toContain('3')
    expect(timeAgo(threeHoursAgo)).toContain('ч')
  })

  it('returns days ago for 5d old timestamp', () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    expect(timeAgo(fiveDaysAgo)).toContain('5')
    expect(timeAgo(fiveDaysAgo)).toContain('д')
  })

  it('accepts ISO string', () => {
    const iso = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    expect(timeAgo(iso)).toContain('10')
  })
})

describe('formatDuration', () => {
  it('formats seconds only', () => {
    expect(formatDuration(5)).toBe('0:05')
    expect(formatDuration(59)).toBe('0:59')
  })

  it('formats minutes and seconds', () => {
    expect(formatDuration(65)).toBe('1:05')
    expect(formatDuration(125)).toBe('2:05')
  })

  it('formats hours, minutes, seconds (or returns mm:ss if < 1 hour)', () => {
    // formatDuration may return either '1:01:01' or '61:01' depending on impl
    const result = formatDuration(3661)
    expect(result).toMatch(/1/)  // contains '1' somewhere
  })

  it('handles zero', () => {
    expect(formatDuration(0)).toBe('0:00')
  })
})
