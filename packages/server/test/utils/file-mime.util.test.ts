import { getContentTypeFromFileName } from '../../src/utils/fileMime'

describe('getContentTypeFromFileName', () => {
    it('should resolve PowerPoint mime types', () => {
        expect(getContentTypeFromFileName('deck.ppt')).toBe('application/vnd.ms-powerpoint')
        expect(getContentTypeFromFileName('deck.pptx')).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation')
    })

    it('should return undefined for unknown extensions', () => {
        expect(getContentTypeFromFileName('deck.unknown')).toBeUndefined()
    })
})
