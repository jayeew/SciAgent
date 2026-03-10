import { getRunningExpressApp } from '../../src/utils/getRunningExpressApp'
import { utilGetUploadsConfig } from '../../src/utils/getUploadsConfig'

jest.mock('../../src/utils/getRunningExpressApp', () => ({
    getRunningExpressApp: jest.fn()
}))

const mockedGetRunningExpressApp = getRunningExpressApp as jest.MockedFunction<typeof getRunningExpressApp>

const createNode = (id: string, data: Record<string, any>) =>
    ({
        id,
        position: { x: 0, y: 0 },
        type: 'customNode',
        data,
        positionAbsolute: { x: 0, y: 0 },
        z: 1,
        handleBounds: { source: [], target: [] },
        width: 200,
        height: 100,
        selected: false,
        dragging: false
    } as any)

const createEdge = (source: string, target: string) =>
    ({
        source,
        target,
        sourceHandle: `${source}-output`,
        targetHandle: `${target}-input-mediaModel-BaseMediaModel`,
        type: 'buttonedge',
        id: `${source}-${target}`,
        data: { label: '' }
    } as any)

const mockChatflowLookup = (flowData: Record<string, any>) => {
    const findOneBy = jest.fn().mockResolvedValue({
        id: 'flow-1',
        flowData: JSON.stringify(flowData)
    })

    mockedGetRunningExpressApp.mockReturnValue({
        AppDataSource: {
            getRepository: jest.fn().mockReturnValue({ findOneBy })
        }
    } as any)
}

describe('utilGetUploadsConfig', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('enables image uploads when MediaConversationChain is connected to DoubaoImage', async () => {
        mockChatflowLookup({
            nodes: [
                createNode('doubao-1', {
                    name: 'doubaoImage',
                    type: 'DoubaoImage',
                    category: 'Media Models',
                    inputs: {},
                    inputParams: []
                }),
                createNode('chain-1', {
                    name: 'mediaConversationChain',
                    type: 'MediaConversationChain',
                    category: 'Chains',
                    inputs: {},
                    inputParams: []
                })
            ],
            edges: [createEdge('doubao-1', 'chain-1')]
        })

        const result = await utilGetUploadsConfig('flow-1')

        expect(result.isImageUploadAllowed).toBe(true)
        expect(result.imgUploadSizeAndTypes).toEqual([
            {
                fileTypes: ['image/gif', 'image/jpeg', 'image/png', 'image/webp'],
                maxUploadSize: 5
            }
        ])
    })

    it('keeps image uploads disabled when no connected Doubao media model exists', async () => {
        mockChatflowLookup({
            nodes: [
                createNode('model-1', {
                    name: 'someOtherMediaModel',
                    type: 'OtherMediaModel',
                    category: 'Media Models',
                    inputs: {},
                    inputParams: []
                }),
                createNode('chain-1', {
                    name: 'mediaConversationChain',
                    type: 'MediaConversationChain',
                    category: 'Chains',
                    inputs: {},
                    inputParams: []
                })
            ],
            edges: [createEdge('model-1', 'chain-1')]
        })

        const result = await utilGetUploadsConfig('flow-1')

        expect(result.isImageUploadAllowed).toBe(false)
        expect(result.imgUploadSizeAndTypes).toEqual([])
    })
})
