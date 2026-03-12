import { normalizeDoubaoImageSize } from './core'

describe('DoubaoImage media model helpers', () => {
    it('should map common size aliases to supported pixel sizes', () => {
        expect(normalizeDoubaoImageSize('wide')).toBe('2848x1600')
        expect(normalizeDoubaoImageSize('portrait')).toBe('1600x2848')
        expect(normalizeDoubaoImageSize('square')).toBe('2048x2048')
    })
})
