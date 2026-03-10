import { ARTIFACTS_PREFIX, TOOL_ARGS_PREFIX } from '../../../../src/agents'
import { secureAxiosRequest, secureFetch } from '../../../../src/httpSecurity'
import { addSingleFileToStorage } from '../../../../src/storageUtils'
import {
    DEFAULT_DOUBAO_IMAGE_MODEL,
    DoubaoImageGenerationTool,
    normalizeDoubaoImageSize,
    normalizeDoubaoOutputFormat,
    resolveDoubaoImageGenerationArgs
} from '../../../../nodes/tools/DoubaoImageGeneration/core'

jest.mock('../../../../src/httpSecurity', () => ({
    secureAxiosRequest: jest.fn(),
    secureFetch: jest.fn()
}))

jest.mock('../../../../src/storageUtils', () => ({
    addSingleFileToStorage: jest.fn()
}))

const mockedSecureAxiosRequest = secureAxiosRequest as jest.MockedFunction<typeof secureAxiosRequest>
const mockedSecureFetch = secureFetch as jest.MockedFunction<typeof secureFetch>
const mockedAddSingleFileToStorage = addSingleFileToStorage as jest.MockedFunction<typeof addSingleFileToStorage>

const createDownloadResponse = (contentType: string, body: string = 'image-bytes') =>
    ({
        ok: true,
        status: 200,
        headers: {
            get: (header: string) => (header === 'content-type' ? contentType : null)
        },
        arrayBuffer: async () => Buffer.from(body)
    } as any)

const createTool = (overrides: Partial<ConstructorParameters<typeof DoubaoImageGenerationTool>[0]> = {}) =>
    new DoubaoImageGenerationTool({
        name: 'doubao_image_generation',
        description: 'Generate an image when the user explicitly asks for one',
        apiKey: 'ark-key',
        model: DEFAULT_DOUBAO_IMAGE_MODEL,
        size: '2K',
        outputFormat: 'png',
        watermark: false,
        chatflowid: 'flow-1',
        orgId: 'org-1',
        ...overrides
    })

const parseToolResponse = (response: string) => {
    const [summaryRaw, artifactsAndArgs] = response.split(ARTIFACTS_PREFIX)
    const [artifactsRaw, argsRaw] = artifactsAndArgs.split(TOOL_ARGS_PREFIX)

    return {
        summary: JSON.parse(summaryRaw),
        artifacts: JSON.parse(artifactsRaw),
        args: JSON.parse(argsRaw)
    }
}

describe('DoubaoImageGeneration helpers', () => {
    it('normalizes jpg output format to jpeg', () => {
        expect(normalizeDoubaoOutputFormat('jpg')).toBe('jpeg')
        expect(normalizeDoubaoOutputFormat('jpeg')).toBe('jpeg')
        expect(normalizeDoubaoOutputFormat()).toBe('png')
    })

    it('normalizes doubao image size labels and legacy values to pixels', () => {
        expect(normalizeDoubaoImageSize('2K (4:3)')).toBe('2048x1536')
        expect(normalizeDoubaoImageSize('2048 x 1152')).toBe('2048x1152')
        expect(normalizeDoubaoImageSize('2K')).toBe('2048x2048')
    })

    it('resolves runtime args over node defaults', () => {
        const resolved = resolveDoubaoImageGenerationArgs(
            {
                prompt: '  future city poster  ',
                size: '1024x1024',
                outputFormat: 'jpg',
                watermark: true
            },
            {
                model: 'custom-model',
                size: '2K',
                outputFormat: 'png',
                watermark: false
            }
        )

        expect(resolved).toEqual({
            prompt: 'future city poster',
            model: 'custom-model',
            size: '1024x1024',
            outputFormat: 'jpeg',
            watermark: true
        })
    })
})

describe('DoubaoImageGenerationTool', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        jest.spyOn(Date, 'now').mockReturnValue(1700000000000)
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    it('stores a single generated image as an artifact', async () => {
        mockedSecureAxiosRequest.mockResolvedValue({
            data: {
                model: DEFAULT_DOUBAO_IMAGE_MODEL,
                created: 1757321139,
                data: [{ url: 'https://example.com/image-1', size: '3104x1312' }],
                usage: { generated_images: 1, output_tokens: 5, total_tokens: 10 }
            }
        } as any)
        mockedSecureFetch.mockResolvedValue(createDownloadResponse('image/png'))
        mockedAddSingleFileToStorage.mockResolvedValue({
            path: 'FILE-STORAGE::doubao_generated_image_1700000000000_1.png',
            totalSize: 0.5
        })

        const result = await createTool().call(
            {
                prompt: 'Generate a future city poster',
                size: '1024x1024',
                outputFormat: 'jpeg',
                watermark: true
            },
            undefined,
            undefined,
            { chatId: 'chat-1' }
        )

        const parsed = parseToolResponse(result)

        expect(parsed.summary).toEqual({
            provider: 'doubao-ark',
            model: DEFAULT_DOUBAO_IMAGE_MODEL,
            imageCount: 1,
            images: [{ fileName: 'doubao_generated_image_1700000000000_1.png', size: '3104x1312' }],
            usage: { generated_images: 1, output_tokens: 5, total_tokens: 10 },
            created: 1757321139
        })
        expect(parsed.artifacts).toEqual([
            {
                type: 'png',
                data: 'FILE-STORAGE::doubao_generated_image_1700000000000_1.png'
            }
        ])
        expect(parsed.args).toEqual({
            prompt: 'Generate a future city poster',
            model: DEFAULT_DOUBAO_IMAGE_MODEL,
            size: '1024x1024',
            outputFormat: 'jpeg',
            watermark: true
        })
        expect(mockedAddSingleFileToStorage).toHaveBeenCalledWith(
            'image/png',
            expect.any(Buffer),
            'doubao_generated_image_1700000000000_1.png',
            'org-1',
            'flow-1',
            'chat-1'
        )
    })

    it('stores all generated images when multiple URLs are returned', async () => {
        mockedSecureAxiosRequest.mockResolvedValue({
            data: {
                data: [
                    { url: 'https://example.com/image-1', size: '1024x1024' },
                    { url: 'https://example.com/image-2', size: '1024x1024' }
                ]
            }
        } as any)
        mockedSecureFetch.mockResolvedValueOnce(createDownloadResponse('image/png'))
        mockedSecureFetch.mockResolvedValueOnce(createDownloadResponse('image/jpeg'))
        mockedAddSingleFileToStorage.mockResolvedValueOnce({
            path: 'FILE-STORAGE::doubao_generated_image_1700000000000_1.png',
            totalSize: 0.5
        })
        mockedAddSingleFileToStorage.mockResolvedValueOnce({
            path: 'FILE-STORAGE::doubao_generated_image_1700000000000_2.jpeg',
            totalSize: 0.5
        })

        const result = await createTool().call({ prompt: 'Draw two poster concepts' }, undefined, undefined, { chatId: 'chat-1' })
        const parsed = parseToolResponse(result)

        expect(parsed.summary.imageCount).toBe(2)
        expect(parsed.artifacts).toEqual([
            { type: 'png', data: 'FILE-STORAGE::doubao_generated_image_1700000000000_1.png' },
            { type: 'jpeg', data: 'FILE-STORAGE::doubao_generated_image_1700000000000_2.jpeg' }
        ])
    })

    it('returns partial success when at least one image is stored', async () => {
        mockedSecureAxiosRequest.mockResolvedValue({
            data: {
                data: [
                    { url: 'https://example.com/image-1', size: '1024x1024' },
                    { url: 'https://example.com/image-2', size: '1024x1024' }
                ]
            }
        } as any)
        mockedSecureFetch.mockResolvedValueOnce(createDownloadResponse('image/png'))
        mockedSecureFetch.mockRejectedValueOnce(new Error('download failed'))
        mockedAddSingleFileToStorage.mockResolvedValue({
            path: 'FILE-STORAGE::doubao_generated_image_1700000000000_1.png',
            totalSize: 0.5
        })

        const result = await createTool().call({ prompt: 'Draw two avatars' }, undefined, undefined, { chatId: 'chat-1' })
        const parsed = parseToolResponse(result)

        expect(parsed.summary.imageCount).toBe(1)
        expect(parsed.summary.partialFailureCount).toBe(1)
        expect(parsed.artifacts).toHaveLength(1)
    })

    it('throws when the API returns no image data', async () => {
        mockedSecureAxiosRequest.mockResolvedValue({
            data: {
                data: []
            }
        } as any)

        await expect(createTool().call({ prompt: 'Draw a cover image' }, undefined, undefined, { chatId: 'chat-1' })).rejects.toThrow(
            'Doubao Ark image generation returned no images'
        )
    })

    it('surfaces a safe API error message', async () => {
        mockedSecureAxiosRequest.mockRejectedValue({
            response: {
                status: 400,
                data: {
                    error: {
                        message: 'Invalid request body'
                    }
                }
            }
        })

        await expect(createTool().call({ prompt: 'Draw a cover image' }, undefined, undefined, { chatId: 'chat-1' })).rejects.toThrow(
            'Invalid request body'
        )
    })

    it('surfaces a safe API error message for non-2xx resolved responses', async () => {
        mockedSecureAxiosRequest.mockResolvedValue({
            status: 400,
            data: {
                error: {
                    message: 'Invalid request body'
                }
            }
        } as any)

        await expect(createTool().call({ prompt: 'Draw a cover image' }, undefined, undefined, { chatId: 'chat-1' })).rejects.toThrow(
            'Invalid request body'
        )
    })

    it('parses stringified JSON image payloads', async () => {
        mockedSecureAxiosRequest.mockResolvedValue({
            status: 200,
            data: JSON.stringify({
                model: DEFAULT_DOUBAO_IMAGE_MODEL,
                created: 1757321139,
                data: [{ url: 'https://example.com/image-1.jpeg?signature=abc', size: '2048x2048' }],
                usage: { generated_images: 1, output_tokens: 16384, total_tokens: 16384 }
            })
        } as any)
        mockedSecureFetch.mockResolvedValue(createDownloadResponse('', 'image-bytes'))
        mockedAddSingleFileToStorage.mockResolvedValue({
            path: 'FILE-STORAGE::doubao_generated_image_1700000000000_1.jpeg',
            totalSize: 0.5
        })

        const result = await createTool().call({ prompt: 'Draw a sci-fi poster' }, undefined, undefined, { chatId: 'chat-1' })
        const parsed = parseToolResponse(result)

        expect(parsed.summary.imageCount).toBe(1)
        expect(parsed.summary.usage).toEqual({ generated_images: 1, output_tokens: 16384, total_tokens: 16384 })
        expect(parsed.artifacts).toEqual([{ type: 'jpeg', data: 'FILE-STORAGE::doubao_generated_image_1700000000000_1.jpeg' }])
    })

    it('throws when no API key is configured', async () => {
        await expect(
            createTool({ apiKey: '' }).call({ prompt: 'Draw a poster image' }, undefined, undefined, { chatId: 'chat-1' })
        ).rejects.toThrow('Doubao Ark API key is required')
    })

    it('exposes returnDirect for tool agent flows', () => {
        const tool = createTool({ returnDirect: true })

        expect(tool.returnDirect).toBe(true)
    })
})
